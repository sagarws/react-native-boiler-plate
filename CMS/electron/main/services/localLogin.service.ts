import { createRequire } from "node:module";
import type { HarvestedCookie } from "@shared/types/platformSession";
import { fail, ok, type Result } from "@shared/types/result";
import { credentialSecret } from "./credentialSecret.service";
import { credentialFor } from "./company.service";
import { fetchFlipkartOtp } from "./flipkartOtp.service";
import { fetchSnapdealOtp } from "./snapdealOtp.service";
import { fetchCloudflareOtp, fetchTataCliqOtp } from "./tatacliqOtp.service";
import { OTP_WAIT_MS, pollMailedOtp } from "./otpSource";
import { prepareCoreWithBrowser } from "../automations/common/prepareCore";
import { isCredentialRefusal, recordCredentialVerdict } from "./credentialVerdict.service";
import { platformSkipped } from "./platformSkip.store";
import { logger } from "./logger";

/**
 * Signs in to a marketplace FROM THIS MACHINE, using the platform's own login.
 *
 * The login itself is `@trackvid/automation-core` — the same
 * `login<Platform>Api` the automation server runs, carrying every portal quirk
 * it has accumulated. Nothing about the sign-in is reimplemented here; this
 * file only supplies the three things the desktop differs on:
 *
 *   1. the browser        a pinned Chrome-for-Testing this app installed,
 *                         rather than puppeteer's bundled Chromium
 *   2. no database        the login must not try to persist the jar; this app
 *                         has no Mongo and must never hold its credentials
 *   3. the password       fetched per sign-in from the backend, never cached
 *
 * The captured jar is returned to the caller, which ships it to the backend.
 */

const load = createRequire(import.meta.url);

const core = <T>(subpath: string): T => load(`@trackvid/automation-core/${subpath}`) as T;

interface RenewModule {
	renewPlatformSession: (
		platform: string,
		credentials: { username: string; password?: string; _id?: string },
		options?: Record<string, unknown>,
	) => Promise<{
		platform: string;
		username: string;
		jar: Record<string, string> | HarvestedCookie[];
		tokens: {
			accessToken: string | null;
			refreshToken: string | null;
			realm: string | null;
		} | null;
		extra: Record<string, unknown> | null;
		cookieNames: string[];
		durationMs: number;
	}>;
	canRenew: (platform: string) => boolean;
}

interface OperatorSignInModule {
	canOperatorSignIn: (platform: string) => boolean;
	operatorSignIn: (
		platform: string,
		credentials: { username: string; _id?: string; accountType?: string },
		options?: { timeoutMs?: number; onProgress?: (message: string) => void },
	) => Promise<{
		jar: Record<string, string> | HarvestedCookie[];
		tokens: {
			accessToken: string | null;
			refreshToken: string | null;
			realm: string | null;
		} | null;
		extra: Record<string, unknown> | null;
		cookieNames: string[];
		durationMs: number;
	}>;
}

export interface LocalLoginResult {
	jar: Record<string, string> | HarvestedCookie[];
	tokens: { accessToken: string | null; refreshToken: string | null; realm: string | null } | null;
	extra: Record<string, unknown> | null;
	cookieNames: string[];
	durationMs: number;
}

/** TEMPORARY — see `holdOnOtpFailureMs` in `loginOptionsFor`. */
const OTP_FAILURE_HOLD_MS = 5;

/** Wait before reading a Snapdeal OTP mail, so the fresh code has landed. */
const OTP_MAIL_DELAY_MS = 20_000;

/** "Resend OTP" clicks allowed after Snapdeal refuses a mailed code. */
const OTP_RESENDS = 2;

/**
 * Per-platform overrides for a desktop session capture.
 *
 * Empty for every platform with no auto-login gotcha here. The two that have
 * one both have the same one: their core login defaults `fetchOtp` to reading
 * Gmail out of the SERVER's environment, which a desktop machine does not have.
 * Left alone, Flipkart inherits the server's poll budgets too (90s × 2 ×
 * 2-attempt retry ≈ 6–10 min per credential) and blocks the whole "Update now"
 * queue on one stuck sign-in.
 *
 * Both are pointed at this app's own source instead: the mailbox configured on
 * this machine when there is one, and TrackVid's relay when there is not.
 */
export const OTP_FETCHERS: Record<
	string,
	(username: string, since?: Date, timeoutMs?: number) => Promise<string | null>
> = {
	flipkart: fetchFlipkartOtp,
	tatacliq: fetchTataCliqOtp,
	// Snapdeal challenges some accounts. Its core login falls back to the
	// operator modal when no code is read, so this only ever makes an
	// unattended sign-in possible — it cannot make an attended one worse.
	snapdeal: fetchSnapdealOtp,
	// AJIO challenges SOME accounts ("Verify your identity" on the Reliance SSO)
	// and mails the code. The core login only reads this when the challenge
	// actually appears, so an unchallenged account never waits for a mail.
	ajio: (username, since, timeoutMs) => pollMailedOtp("ajio", username, since, timeoutMs),
};

/**
 * Further login options a platform takes beside its `fetchOtp`.
 *
 * Tata CliQ's seller zone is sometimes behind Cloudflare Access, which mails a
 * SECOND code to a different inbox (the credential's Cloudflare email); the core
 * login reads it through `fetchCloudflareOtp`. A table, so adding one is an entry
 * here rather than a branch in loginOptionsFor.
 */
const EXTRA_LOGIN_OPTIONS: Record<string, Record<string, unknown>> = {
	tatacliq: { fetchCloudflareOtp },
};

/**
 * Platforms whose login ALWAYS asks for a code — no per-account switch exists,
 * so "OTP is on" is simply true for every account.
 */
const ALWAYS_OTP = new Set(["tatacliq"]);

/** Did this sign-in ask the mailbox for a code and get nothing back? */
interface OtpWatch {
	asked: boolean;
	missed: boolean;
}

/**
 * @param expectsOtp what the credential says about its own sign-in — see
 *        `isOtpBased`. NULL means nobody has said, which is read as "attempt
 *        it": the behaviour every sign-in had before the field existed.
 * @param watch     filled in by the fetcher, so the caller can tell "no code
 *        ever arrived" apart from every other way a sign-in fails.
 */
const loginOptionsFor = (
	platform: string,
	expectsOtp: boolean | null,
	watch: OtpWatch,
): Record<string, unknown> => {
	const source = OTP_FETCHERS[platform];

	if (!source) return {};

	const fetchOtp = async (username: string, since?: Date, timeoutMs?: number): Promise<string | null> => {
		watch.asked = true;

		const code = await source(username, since, timeoutMs);

		watch.missed = !code;

		return code;
	};

	// Told plainly that this account is not challenged, the login does not wait
	// for a code it will never be sent. Snapdeal and Flipkart only — the two
	// where it varies by account; Tata CliQ always raises one, so nothing here
	// can turn that off.
	if (expectsOtp === false) return { operatorFallback: false, maxAttempts: 1, ...EXTRA_LOGIN_OPTIONS[platform] };

	return {
		...EXTRA_LOGIN_OPTIONS[platform],
		// This app's own source — the local mailbox first, TrackVid second —
		// rather than the core's default IMAP read, which needs an environment only
		// the automation server has. That default is what dev hid: the core loads
		// .env there, so the server's mailbox answered; the packaged app has none.
		fetchOtp,
		// Up to twenty minutes for the code (see OTP_WAIT_MS). Each fetcher waits
		// that long by itself; Tata CliQ's login also keeps its own deadline, so it
		// is told the same number.
		otpWaitMs: OTP_WAIT_MS,
		// No manual fallback: the whole point of auto-login is that the operator
		// did not want to sign in by hand. If the code does not arrive, mark this
		// credential failed and let the next one start.
		operatorFallback: false,
		// Single attempt, not two. The API login reopens the browser on an
		// OTP-stuck failure; here that would double the wall time for a credential
		// that already told us it needs manual intervention.
		maxAttempts: 1,
		// TEMPORARY, for chasing the intermittent Snapdeal OTP refusal: the browser
		// stays open this long after an OTP failure so the page can be inspected.
		// Only Snapdeal's login reads it. Remove once the cause is found.
		holdOnOtpFailureMs: OTP_FAILURE_HOLD_MS,
		// Snapdeal and AJIO (others ignore them). Reading the mailbox the moment
		// the OTP page shows could pick up the PREVIOUS sign-in's code, so wait
		// for the new mail first; and if the portal still refuses the code, click
		// "Resend OTP" / "Resend code", wait again and try the new one — at most twice.
		otpMailDelayMs: OTP_MAIL_DELAY_MS,
		otpResends: OTP_RESENDS,
	};
};

export const loginLocally = async (
	platform: string,
	username: string,
	credentialId: string,
	onProgress?: (message: string) => void,
): Promise<Result<LocalLoginResult>> => {
	const { renewPlatformSession, canRenew } = core<RenewModule>("common/renewSession");

	if (!canRenew(platform)) {
		return fail("VALIDATION_ERROR", `No sign-in is defined for ${platform}`);
	}

	const secret = await credentialSecret(platform, username);

	if (!secret.success) return secret;

	try {
		// The policy is per platform, and this is a sign-in for one.
		await prepareCoreWithBrowser(onProgress, platform);
	} catch (error) {
		logger.error("Could not prepare the browser", error);

		return fail(
			"INTERNAL_ERROR",
			`Could not prepare the browser this sign-in needs: ${error instanceof Error ? error.message : String(error)}`,
		);
	}

	onProgress?.(`Signing in to ${platform}…`);

	const stored = await credentialFor(platform, username);
	const isOtpBased = stored?.isOtpBased ?? null;
	const otpWatch: OtpWatch = { asked: false, missed: false };

	try {
		const result = await renewPlatformSession(
			platform,
			{
				username,
				password: secret.data.password,
				_id: credentialId,
				// Tata CliQ's Cloudflare Access inbox, when the login has one —
				// the core falls back to its default otherwise.
				...(stored?.cloudflareEmail ? { cloudflareEmail: stored.cloudflareEmail } : {}),
			},
			// A "heartbeat" budget for the whole capture: the operator is watching
			// this browser and cannot wait ten minutes for one credential to fail.
			// Options are undefined on every platform except Flipkart (the only one
			// whose login has an OTP challenge), so the core's own defaults apply
			// everywhere else — which is what the server has always used.
			loginOptionsFor(platform, isOtpBased, otpWatch),
		);

		logger.info(
			`Signed in to ${platform} as ${username} on this machine (${result.cookieNames.length} cookies, ${result.durationMs}ms)`,
		);

		/*
		 * IT WORKED, SO THE CREDENTIAL IS GOOD.
		 *
		 * Written on success as well as on refusal, and that is not symmetry for
		 * its own sake: a password corrected at the marketplace, or an account the
		 * seller un-suspended, would otherwise stay marked unverified for ever —
		 * skipped by every automation, with nothing left that could ever change its
		 * mind.
		 */
		void recordCredentialVerdict(platform, username, true);

		return ok({
			jar: result.jar,
			tokens: result.tokens,
			extra: result.extra,
			cookieNames: result.cookieNames,
			durationMs: result.durationMs,
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		const code = (error as { code?: string })?.code;

		logger.error(`Local ${platform} sign-in failed`, { code, message });

		/*
		 * THE MARKETPLACE REFUSED THE PASSWORD, so say so where it is read.
		 *
		 * The Login update signed in to three Snapdeal accounts, was told "Invalid
		 * Username or Password" each time, and the Login page went on showing all
		 * three as Verified — nothing on this path wrote the flag. Every automation
		 * kept using passwords the marketplace had already refused.
		 *
		 * ONLY A CREDENTIAL REFUSAL. A timeout, a captcha, a portal 5xx or an OTP
		 * challenge says nothing about the password, and marking an account
		 * unverified on one of those would take a WORKING login out of every
		 * automation until somebody noticed.
		 */
		if (isCredentialRefusal(message, code, platform)) {
			void recordCredentialVerdict(platform, username, false);
		}

		/*
		 * OTP IS ON AND NO CODE CAME — taken out of the automations too.
		 *
		 * The exception to "an OTP challenge says nothing about the password",
		 * asked for deliberately: an account whose codes never reach the mailbox
		 * (a forward that stopped, a portal mailing somewhere else) fails every
		 * run, twenty minutes at a time, and holds the queue each night. Marked
		 * unverified, every automation skips it until someone signs it in by hand
		 * and presses Verify.
		 *
		 * Only when the account is KNOWN to use a code (its OTP switch is on, or
		 * the platform always asks), the fetcher was actually asked and came back
		 * empty, and the operator did not Skip it — a skip also ends the wait
		 * empty, and is a person's decision, not the login's.
		 */
		const expectsCode = ALWAYS_OTP.has(platform) || isOtpBased === true;

		if (
			expectsCode &&
			otpWatch.asked &&
			otpWatch.missed &&
			!platformSkipped("session-refresh", platform)
		) {
			logger.warn(
				`[otp] ${platform} · ${username}: OTP is on and no code arrived — marking the login unverified`,
			);
			void recordCredentialVerdict(platform, username, false);

			return fail(
				"INTERNAL_ERROR",
				"No one-time code arrived in the mailbox, so this login was marked Unverified and " +
					"automations will skip it. Sign in by hand (switch Sign-in to Manual), then press Verify.",
			);
		}

		// The logins phrase their own failures for an operator — a bad password, a
		// portal that did not render, an OTP challenge. Pass them through rather
		// than wrapping them in something generic.
		return fail("INTERNAL_ERROR", message);
	}
};

/**
 * Must this platform's MANUAL sign-in run in the real browser, instead of the
 * app's own window? True where the portal refuses the app's Chromium outright
 * (Myntra, behind Akamai) — see the core's `common/operatorSignIn`.
 */
export const needsRealBrowserForManualSignIn = (platform: string): boolean =>
	core<OperatorSignInModule>("common/operatorSignIn").canOperatorSignIn(platform);

/**
 * A sign-in the OPERATOR types, in the same real Chrome the automated sign-in
 * drives — so a manual and an automatic capture send identical headers from the
 * same browser. No password is fetched: the operator types it.
 */
export const operatorLoginLocally = async (
	platform: string,
	username: string,
	credentialId: string,
	onProgress?: (message: string) => void,
): Promise<Result<LocalLoginResult>> => {
	try {
		await prepareCoreWithBrowser(onProgress, platform);
	} catch (error) {
		logger.error("Could not prepare the browser", error);

		return fail(
			"INTERNAL_ERROR",
			`Could not prepare the browser this sign-in needs: ${error instanceof Error ? error.message : String(error)}`,
		);
	}

	// The account type picks the answer to Myntra's first-login "Select
	// Relationship Type" modal, which the sign-in dismisses before closing Chrome.
	// Without it the core defaults to Partner Seller — wrong for a Vendor account.
	// The automated sign-in has always passed it; so does this.
	const accountType = (await credentialFor(platform, username))?.accountType ?? "";

	try {
		const result = await core<OperatorSignInModule>("common/operatorSignIn").operatorSignIn(
			platform,
			{ username, _id: credentialId, ...(accountType ? { accountType } : {}) },
			{ ...(onProgress ? { onProgress } : {}) },
		);

		logger.info(
			`Operator signed in to ${platform} as ${username} in Chrome (${result.cookieNames.length} cookies, ${result.durationMs}ms)`,
		);

		return ok({
			jar: result.jar,
			tokens: result.tokens,
			extra: result.extra,
			cookieNames: result.cookieNames,
			durationMs: result.durationMs,
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		const code = (error as { code?: string })?.code;

		logger.warn(`Operator ${platform} sign-in for ${username} did not finish: ${message}`);

		// Closing the window is the operator's way to stop — the same answer the
		// app's own capture window gives when it is closed.
		return fail(code === "OPERATOR_CANCELLED" ? "VALIDATION_ERROR" : "INTERNAL_ERROR", message);
	}
};
