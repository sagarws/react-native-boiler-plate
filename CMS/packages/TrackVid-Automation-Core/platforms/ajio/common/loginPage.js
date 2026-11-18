/**
 * Sign a Puppeteer page in to AJIO, and LEAVE IT SIGNED IN.
 *
 * This is the login every AJIO master-import flow needs, because both of them
 * keep using the page afterwards: the API flow calls AJIO's download endpoint
 * from inside it (Akamai wants the browser's own HttpOnly bff_session and TLS
 * fingerprint), and the script flow clicks View → Export on it.
 *
 * It is deliberately NOT `loginAjioApi` from ./renewSession. That one owns its
 * browser and closes it in a `finally`, returning only the harvested jar — the
 * right shape for capturing a session, the wrong one for running a job. A
 * caller handed a jar and no page cannot do either flow's work; wiring a master
 * import to it produced "AJIO login returned no page" on every run.
 *
 * Lifted out of the automation server's master-import runner, where it lived
 * inline, so the desktop app drives the identical sequence. A second copy would
 * drift the first time Reliance changes a selector.
 *
 * AJIO login moved to Reliance Retail OAuth SSO (2026-07). The old in-page
 * modal `form#ui-form` is GONE — seller.ajio.com redirects to
 * sellers.relianceretail.com/auth/oauth/authorize, which renders
 * `form#loginForm` (#username / #password / #submitBtn) and on success
 * OAuth-callbacks back to seller.ajio.com.
 */

const { waitForAjioLoginOutcome } = require("./loginErrors");
const { answerAjioMfa } = require("./mfa");

const DEFAULT_LOGIN_URL = "https://seller.ajio.com/ajiocommerce/";

/**
 * @param {object} page          a live Puppeteer page
 * @param {object} credentials   { username, password, loginUrl? }
 * @param {object} [options]
 * @param {object} [options.logger]   anything with debug/info/warn
 * @param {number} [options.timeoutMs] how long to wait for the SSO outcome
 * @param {Function|null} [options.fetchOtp] where a one-time code is read when
 *        the account is challenged — undefined → the server's mailbox, null → none.
 *        See ./mfa.js. `otpMailDelayMs`, `otpResends` and `otpWaitMs` go with it.
 * @returns {Promise<{ ok: true }>} the page is signed in and still open
 * @throws  an Error tagged `code = "INVALID_CREDENTIALS"` when AJIO says the
 *          credentials are wrong, so a caller can mark the credential rather
 *          than retrying it forever.
 */
async function loginAjioPage(
    page,
    credentials,
    { logger = console, timeoutMs = 45000, fetchOtp, otpMailDelayMs, otpResends, otpWaitMs } = {}
) {
    const { username, password } = credentials || {};
    const loginUrl =
        typeof credentials?.loginUrl === "string" && credentials.loginUrl.trim()
            ? credentials.loginUrl.trim()
            : DEFAULT_LOGIN_URL;

    if (!username || !password) {
        throw new Error("loginAjioPage: username and password are required");
    }

    logger.info?.(`🌐 Navigating to AJIO: ${loginUrl}`);
    await page.goto(loginUrl, { waitUntil: "networkidle2" });

    // The landing shows a "Log in" launcher; clicking it redirects to the
    // Reliance authorize page (fresh state/nonce/PKCE each time). Click #ui-btn,
    // else the visible "Log in" text. Skipped when a build auto-redirects and
    // the form is already up.
    logger.debug?.("🔓 Opening AJIO / Reliance SSO login...");

    if (!(await page.$("#loginForm #username"))) {
        await page.evaluate(() => {
            const el =
                document.querySelector("#ui-btn") ||
                Array.from(document.querySelectorAll("a,button")).find(
                    (n) =>
                        n.offsetParent !== null &&
                        /log\s*in/i.test((n.textContent || "").replace(/\s+/g, " ").trim())
                );
            if (el) el.click();
        });
    }

    await page.waitForSelector("#loginForm #username", { visible: true, timeout: 60000 });

    logger.debug?.("📝 Filling in credentials...");
    await page.type("#username", username, { delay: 80 });
    await page.waitForSelector("#password", { visible: true });
    await page.type("#password", password, { delay: 80 });

    // The form rejects a submit that lands too soon after the last keystroke.
    await new Promise((resolve) => setTimeout(resolve, 800));

    // An OTP mail older than this belongs to an earlier sign-in.
    const otpRequestedAt = new Date();

    logger.debug?.("🔑 Submitting login...");
    await page.click("#submitBtn");

    // Success = OAuth redirects back to seller.ajio.com. Failure = still on the
    // authorize page. Raced against an error toast so a locked account fails in
    // seconds rather than burning the full timeout.
    logger.debug?.("🔍 Verifying login result...");

    const outcome = await waitForAjioLoginOutcome(page, { timeoutMs, pollMs: 500, detectOtp: true });

    if (outcome.otp) {
        const answered = await answerAjioMfa(page, username, {
            fetchOtp,
            since: otpRequestedAt,
            mailDelayMs: otpMailDelayMs,
            resends: otpResends,
            mailTimeoutMs: otpWaitMs,
            portalUrl: loginUrl,
            logger,
        });

        if (answered.ok) {
            logger.info?.("✅ AJIO login successful (one-time code answered)");

            return { ok: true };
        }

        const error = new Error(answered.reasonText);

        error.code = "OTP_REQUIRED";
        throw error;
    }

    if (outcome.ok) {
        logger.info?.("✅ AJIO login successful");

        return { ok: true };
    }

    const reason = outcome.reasonText || "still on the SSO page";
    const error = new Error(`AJIO login failed: ${reason}`);

    // Tagged so the caller can tell "this password is wrong" from "the portal
    // was slow" — one warrants marking the credential, the other a retry.
    if (outcome.isBadCreds) error.code = "INVALID_CREDENTIALS";

    throw error;
}

module.exports = { loginAjioPage, DEFAULT_LOGIN_URL };
