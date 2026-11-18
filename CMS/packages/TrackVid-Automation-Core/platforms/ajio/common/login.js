const path = require("path");
const fs = require("fs");
const {
	waitForAjioLoginOutcome,
	AjioCredentialError,
} = require("./loginErrors");
const { unverifyAjioCredential } = require("./unverifyCredential");
const { answerAjioMfa } = require("./mfa");
// Session cache — same store the master-data flow writes to. Reuse is opt-in
// via AJIO_SESSION_SAVE=true; when off, everything below no-ops and the SSO
// login runs unchanged. See scripts/masterDataImport/utils/ajioSessionStore.js.
const {
	isSessionSaveEnabled: isAjioSessionSaveEnabled,
	tryReuseSession: tryReuseAjioSession,
	harvestCookies: harvestAjioCookies,
	saveSession: saveAjioSession,
	clearPageAuthState: clearAjioPageAuthState,
} = require("./sessionStore");
const { getUserId: getAjioUserId, getPobIds: getAjioPobIds } = require("../master-import/api-based-flow/apiReportFlow");

async function handleDialog(page) {
	// Check if a dialog is already being handled to prevent duplicate event listeners
	if (page._hasDialogHandler) return;
	page._hasDialogHandler = true; // Custom flag to track listener addition

	page.on("dialog", async (dialog) => {
		console.log(`⚠️ Alert detected: ${dialog.message()}`);
		try {
			if (dialog.message().includes("Leave site?")) {
				console.log("✅ Handling 'Leave Site?' dialog...");

				// Check if the "Leave Site" button exists and click it
				const leaveButtonExists = await page.evaluate(() => {
					const leaveButton = Array.from(document.querySelectorAll("button")).find((btn) =>
						btn.innerText.includes("Leave Site")
					);
					if (leaveButton) {
						leaveButton.click(); // Click if found
						return true;
					}
					return false;
				});

				if (leaveButtonExists) {
					console.log("✅ 'Leave Site' button clicked.");
				} else {
					await dialog.dismiss(); // If no button found, dismiss normally
					console.log("✅ 'Leave site?' alert dismissed.");
				}
			} else {
				await dialog.accept(); // Accept other dialogs
				console.log("✅ Alert accepted.");
			}
		} catch (error) {
			console.error("🚨 Error handling dialog:", error.message);
		}
	});
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Optional post-login modal: if a visible dialog contains "Transaction Confirmation",
 * click "Review Later" inside that dialog only. Polls until maxWaitMs; does not throw.
 */
async function tryDismissTransactionConfirmationPopup(page, options = {}) {
	const maxWaitMs = options.maxWaitMs ?? 12000;
	const pollIntervalMs = options.pollIntervalMs ?? 400;
	const context = options.context ? ` (${options.context})` : "";
	const deadline = Date.now() + maxWaitMs;

	try {
		while (Date.now() < deadline) {
			const result = await page.evaluate(() => {
				const isVisible = (el) => {
					if (!el) return false;
					const style = window.getComputedStyle(el);
					if (style.display === "none" || style.visibility === "hidden") return false;
					const rect = el.getBoundingClientRect();
					return rect.width > 0 && rect.height > 0;
				};

				// Prefer topmost stacked modal (later in DOM is often on top for MUI)
				const dialogs = Array.from(document.querySelectorAll('[role="dialog"]')).reverse();

				for (const dialog of dialogs) {
					if (!isVisible(dialog)) continue;
					const text = dialog.innerText || "";
					if (!text.includes("Transaction Confirmation")) continue;

					const buttons = Array.from(dialog.querySelectorAll("button"));
					const reviewLater = buttons.find((b) => {
						if (!b.innerText) return false;
						const label = b.innerText.replace(/\s+/g, " ").trim();
						return label === "Review Later";
					});
					if (reviewLater) {
						reviewLater.click();
						return { clicked: true, sawDialog: true };
					}
					return { clicked: false, sawDialog: true };
				}
				return { clicked: false, sawDialog: false };
			});

			if (result.sawDialog && !result.clicked) {
				console.warn(`⚠️ Transaction Confirmation visible${context} but 'Review Later' not clickable yet`);
			}

			if (result.clicked) {
				console.log(`✅ 'Review Later' clicked on Transaction Confirmation dialog${context}.`);
				await sleep(2500);
				return true;
			}

			await new Promise((r) => setTimeout(r, pollIntervalMs));
		}

		console.log(`✅ No Transaction Confirmation popup within wait window${context}. Continuing...`);
		return false;
	} catch (err) {
		console.warn(`⚠️ Error while handling Transaction Confirmation popup${context}:`, err.message);
		return false;
	}
}

/**
 * Dismiss the "AJIO Announcement" popup (e.g. "Mandatory Update: CCTV Video Sharing")
 * that AJIO now shows on login. Polls because it can appear with a delay, and
 * clicks the OK button (or the dialog's Close icon as a fallback). Never throws.
 * Returns true if a popup was dismissed.
 */
async function tryDismissAjioAnnouncementPopup(page, options = {}) {
	const maxWaitMs = options.maxWaitMs ?? 8000;
	const pollIntervalMs = options.pollIntervalMs ?? 400;
	const context = options.context ? ` (${options.context})` : "";
	const deadline = Date.now() + maxWaitMs;

	try {
		while (Date.now() < deadline) {
			const result = await page.evaluate(() => {
				const isVisible = (el) => {
					if (!el) return false;
					const style = window.getComputedStyle(el);
					if (style.display === "none" || style.visibility === "hidden") return false;
					const rect = el.getBoundingClientRect();
					return rect.width > 0 && rect.height > 0;
				};
				// Topmost stacked dialog first.
				const dialogs = Array.from(document.querySelectorAll('[role="dialog"]')).reverse();
				for (const dialog of dialogs) {
					if (!isVisible(dialog)) continue;
					const text = dialog.innerText || "";
					if (!text.includes("AJIO Announcement")) continue;

					const buttons = Array.from(dialog.querySelectorAll("button"));
					const okBtn = buttons.find(
						(b) => b.innerText && b.innerText.replace(/\s+/g, " ").trim() === "OK"
					);
					const closeBtn = dialog.querySelector('button[aria-label="Close"]');
					const target = okBtn || closeBtn;
					if (target) {
						target.click();
						return { clicked: true, sawDialog: true };
					}
					return { clicked: false, sawDialog: true };
				}
				return { clicked: false, sawDialog: false };
			});

			if (result.clicked) {
				console.log(`✅ AJIO Announcement popup dismissed${context}.`);
				await sleep(1500);
				return true;
			}
			await new Promise((r) => setTimeout(r, pollIntervalMs));
		}
		return false;
	} catch (err) {
		console.warn(`⚠️ Error while handling AJIO Announcement popup${context}:`, err.message);
		return false;
	}
}

/**
 * Dismiss the "Seller Agreements" onboarding interstitial that AJIO now shows on login
 * (route /vmsui/sellers/onBoarding/agreements). Each pending agreement renders a screen
 * with a disabled "Accept" + an enabled "Skip"; clicking Skip opens a "Skip Seller
 * Agreement" confirmation dialog with an "Agree" button. There can be MORE THAN ONE
 * pending agreement, so we loop: Skip -> Agree until no Skip button remains. Never throws.
 * Returns the number of agreements skipped.
 */
async function tryDismissSellerAgreementsPopup(page, options = {}) {
	// Only sellers with PENDING agreements see this screen. For everyone else this must be a
	// near no-op: we detect the screen first and return immediately if it isn't there, so the
	// normal post-login flow is never delayed or interfered with.
	const detectWaitMs = options.detectWaitMs ?? 4000; // short window for the post-login redirect/render
	const pollIntervalMs = options.pollIntervalMs ?? 400;
	const maxAgreements = options.maxAgreements ?? 10; // safety cap
	const context = options.context ? ` (${options.context})` : "";

	// Is the Seller Agreements interstitial actually on screen right now?
	// Signature: the /onBoarding/agreements route, OR a visible "Seller Agreements" heading
	// together with a visible, enabled "Skip" button. Both guards avoid clicking a stray
	// "Skip" that might exist elsewhere in the app.
	const isAgreementsScreen = () =>
		page.evaluate(() => {
			if (/onBoarding\/agreements/i.test(location.href)) return true;
			const isVisible = (el) => {
				if (!el) return false;
				const s = window.getComputedStyle(el);
				if (s.display === "none" || s.visibility === "hidden") return false;
				const r = el.getBoundingClientRect();
				return r.width > 0 && r.height > 0;
			};
			const hasHeading = Array.from(document.querySelectorAll("h1,h2,h3,h4,p,div,span"))
				.some((el) => isVisible(el) && (el.innerText || "").trim() === "Seller Agreements");
			const hasSkip = Array.from(document.querySelectorAll("button"))
				.some((b) => isVisible(b) && !b.disabled && (b.innerText || "").replace(/\s+/g, " ").trim() === "Skip");
			return hasHeading && hasSkip;
		}).catch(() => false);

	// Click a visible, enabled button whose trimmed text exactly equals `label`.
	const clickButtonByText = (label) =>
		page.evaluate((label) => {
			const isVisible = (el) => {
				if (!el) return false;
				const s = window.getComputedStyle(el);
				if (s.display === "none" || s.visibility === "hidden") return false;
				const r = el.getBoundingClientRect();
				return r.width > 0 && r.height > 0;
			};
			const btn = Array.from(document.querySelectorAll("button")).find(
				(b) => isVisible(b) && !b.disabled && (b.innerText || "").replace(/\s+/g, " ").trim() === label
			);
			if (btn) { btn.click(); return true; }
			return false;
		}, label);

	try {
		// --- Detection: bail out fast for sellers who don't have the interstitial. ---
		let present = false;
		const detectDeadline = Date.now() + detectWaitMs;
		while (Date.now() < detectDeadline) {
			if (await isAgreementsScreen()) { present = true; break; }
			await new Promise((r) => setTimeout(r, pollIntervalMs));
		}
		if (!present) {
			// No pending agreements — do nothing, continue the normal flow.
			return 0;
		}

		// --- Handling: only reached when the screen is confirmed present. ---
		let skipped = 0;
		while (skipped < maxAgreements) {
			if (!(await isAgreementsScreen())) break; // gone → all agreements cleared
			if (!(await clickButtonByText("Skip"))) break; // scoped: only clicks Skip on this screen

			// Confirmation dialog -> click "Agree".
			await sleep(600);
			let agreed = false;
			const agreeDeadline = Date.now() + 6000;
			while (Date.now() < agreeDeadline) {
				if (await clickButtonByText("Agree")) { agreed = true; break; }
				await new Promise((r) => setTimeout(r, 300));
			}
			skipped++;
			console.log(`✅ Seller Agreement skipped${context} (#${skipped}, Agree ${agreed ? "clicked" : "not found"}).`);
			await sleep(1500); // let the next agreement (or the dashboard) render
		}
		console.log(`✅ Seller Agreements handled${context}: ${skipped} skipped.`);
		return skipped;
	} catch (err) {
		console.warn(`⚠️ Error while handling Seller Agreements popup${context}:`, err.message);
		return 0;
	}
}

/**
 * page.goto that survives ONE net::ERR_ABORTED.
 *
 * ERR_ABORTED does not mean the URL is unreachable — it means the page cancelled our navigation
 * by starting its own. The AJIO SPA does exactly that when its auth state is cleared underneath it
 * (session-reuse probe rejected -> cookies + storage wiped -> the live dashboard 401s and redirects
 * itself), aborting the SSO page.goto fired microseconds later. The aborting navigation has landed
 * by the time we retry, so a single retry clears it. Any other navigation error is rethrown as-is.
 */
async function gotoWithAbortRetry(page, url, gotoOptions = { waitUntil: "networkidle2" }, attempts = 2) {
	for (let i = 1; i <= attempts; i++) {
		try {
			return await page.goto(url, gotoOptions);
		} catch (err) {
			const aborted = /ERR_ABORTED/i.test(err.message || "");
			if (!aborted || i === attempts) throw err;
			console.warn(`↩️ Navigation to ${url} was aborted by the page (attempt ${i}/${attempts}) — retrying`);
			await sleep(1000);
		}
	}
}

/**
 * Returns { ok: true } on a completed login (fresh SSO or reused session) and
 * { ok: false, error, reason } when it did not complete. It still THROWS AjioCredentialError for a
 * rejected credential. Callers that pass a throwaway `failedUsers` array (the claim scripts) must
 * check the returned result — otherwise a swallowed failure reads as a successful login.
 */
const login = async (page, user, TEMP_FILE_PATH, failedUsers, numberOfObject, options = {}) => {
	try {
		const {
			loginUrl = "https://seller.ajio.com/ajiocommerce/",
			username,
			password,
		} = user[0];
		// Never log the credential object itself — it carries the plaintext password and the
		// cached ajioSession jar, and this line ran for every AWB before the claim scripts moved
		// to one login per run.
		console.log("🔑 Starting login process for user:", {
			username,
			accountType: user[0].accountType,
			_id: user[0]._id,
		});
		console.log("🚀 ~ :47 ~ runDemoScript ~ loginUrl-->", loginUrl);

		// Set download behavior
		const client = await page.createCDPSession();
		await client.send("Page.setDownloadBehavior", {
			behavior: "allow",
			downloadPath: TEMP_FILE_PATH,
		});

		// -------------------------------------------------------------------
		// Optional session reuse (AJIO_SESSION_SAVE=true).
		// -------------------------------------------------------------------
		// Same shape the master-data script uses — see
		// scripts/masterDataImport/utils/ajioSessionStore.js. Wiring it here means
		// EVERY caller of login() (auto-claim, ticket fetch, ticket download,
		// return-delivered claim) picks up session reuse without touching those
		// files. If reuse succeeds, we return early and the caller finds the page
		// already logged in — no SSO form, no credential submit, no OAuth callback.
		// If reuse fails for any reason, we clear the hydrated cookies and fall
		// through to the normal SSO flow below.
		let reusedAjioSession = null;
		if (isAjioSessionSaveEnabled()) {
			try {
				reusedAjioSession = await tryReuseAjioSession(page, {
					credentialId: user[0]._id || user[0].credentialId,
					username,
				});
			} catch (reuseErr) {
				console.warn(`⚠️ AJIO session reuse threw — falling through to fresh SSO login: ${reuseErr.message}`);
				try { await clearAjioPageAuthState(page); } catch (_) { /* best-effort */ }
				reusedAjioSession = null;
			}
			if (reusedAjioSession) {
				console.log(`♻️ Reused cached AJIO session for ${username} — skipping SSO login`);
				// Same post-login policy as the SSO path: API-flow callers pass
				// skipPostLoginPopups:true and don't want us clicking anything.
				if (!options.skipPostLoginPopups) {
					await tryDismissSellerAgreementsPopup(page, { context: "after reuse" });
					await tryDismissAjioAnnouncementPopup(page, { context: "after reuse" });
					await tryDismissTransactionConfirmationPopup(page);
				} else {
					console.log("⚡ skipPostLoginPopups — API flow, not dismissing popups.");
				}
				return { ok: true, reused: true }; // Caller sees the page as logged in, exactly as after a fresh SSO.
			}
		}

		console.log("🌐 Navigating to AJIO login...");
		await gotoWithAbortRetry(page, loginUrl, { waitUntil: "networkidle2" });

		// ============================================================
		// AJIO login moved to Reliance Retail OAuth SSO (2026-07).
		// The old in-page modal `form#ui-form` is GONE. seller.ajio.com now
		// redirects to sellers.relianceretail.com/auth/oauth/authorize, which
		// renders `form#loginForm` (#username / #password / #submitBtn). On success
		// it OAuth-callbacks back to seller.ajio.com/malekith/auth/ns_vms/callback.
		// ============================================================

		// The unauth landing either shows a login launcher (#ui-btn) OR auto-redirects
		// straight to the SSO form. Wait for whichever appears, then land on the SSO form.
		console.log("🔓 Opening AJIO / Reliance SSO login...");
		// The landing shows a "Log in" launcher; clicking it redirects to the Reliance
		// authorize page (fresh state/nonce/PKCE each time). Click by #ui-btn, else by
		// visible "Log in" text. Skip the click if a build auto-redirects (form already up).
		if (!(await page.$("#loginForm #username"))) {
			await page.evaluate(() => {
				const el =
					document.querySelector("#ui-btn") ||
					Array.from(document.querySelectorAll("a,button")).find(
						(n) => n.offsetParent !== null && /log\s*in/i.test((n.textContent || "").replace(/\s+/g, " ").trim())
					);
				if (el) el.click();
			});
		}
		try {
			await page.waitForSelector("#loginForm #username", { visible: true, timeout: 60000 });
		} catch (formErr) {
			// The Reliance SSO username field never appeared. This usually means AJIO returned a
			// challenge / OTP / verification / block page instead of the login form (common when a
			// specific account logs in from an unfamiliar server IP). Capture what's actually on the
			// page so the real cause is visible instead of a generic timeout.
			try {
				const info = await page.evaluate(() => ({
					url: location.href,
					title: document.title,
					text: (document.body && document.body.innerText ? document.body.innerText : "").slice(0, 500),
				}));
				const dir = path.join(__dirname, "../scripts/loginFailures");
				fs.mkdirSync(dir, { recursive: true });
				const shot = path.join(dir, `login-fail-${username ? username.split("@")[0] : "user"}-${Date.now()}.png`);
				await page.screenshot({ path: shot, fullPage: true }).catch(() => {});
				console.error(`❌ Login form (#username) did not appear for ${username}. AJIO page → url=${info.url} | title="${info.title}"`);
				console.error(`   page text: ${info.text}`);
				console.error(`   📸 screenshot saved: ${shot}`);
			} catch (_) { /* best-effort diagnostics */ }
			throw new Error(`Login form did not appear within 60s for ${username} — AJIO likely showed a challenge/verification/block page (see screenshot + page text above).`);
		}

		await handleDialog(page);

		// **Enter credentials on the Reliance SSO form** (ids are stable on the
		// authorize page: #username / #password / #submitBtn).
		console.log("📝 Filling in credentials...");
		await page.type("#username", username, { delay: 80 });

		await page.waitForSelector("#password", { visible: true });
		await page.type("#password", password, { delay: 80 });

		await new Promise((resolve) => setTimeout(resolve, 800));

		// Stamped before the submit: an OTP mail older than this belongs to an
		// earlier sign-in, and its code is already retired.
		const otpRequestedAt = new Date();

		console.log("🔑 Submitting login...");
		await page.click("#submitBtn");

		// **Verify** — success = OAuth completes and redirects back to seller.ajio.com.
		// Failure = we stay on the SSO authorize page (bad creds / blocked). Detect by
		// hostname rather than a brittle error selector.
		console.log("🔍 Verifying login result...");
		// Races the redirect against an error toast/flash so a locked-account popup
		// fails in seconds instead of burning the full 45s. See ./loginErrors.js.
		let outcome = await waitForAjioLoginOutcome(page, { timeoutMs: 45000, pollMs: 500, detectOtp: true });

		// Some accounts are challenged with a one-time code instead of being
		// redirected. Answer it from the mailbox (see ./mfa.js) and judge the
		// result by the same branches below. `fetchOtp` undefined → the server's
		// own mailbox; a caller passes its own (the desktop app does).
		if (outcome.otp) {
			const answered = await answerAjioMfa(page, username, {
				fetchOtp: options.fetchOtp,
				since: otpRequestedAt,
				mailDelayMs: options.otpMailDelayMs,
				resends: options.otpResends,
				mailTimeoutMs: options.otpWaitMs,
				portalUrl: loginUrl,
			});
			outcome = answered.ok
				? { ok: true }
				: { ok: false, otp: true, reasonText: answered.reasonText, isBadCreds: false, timedOut: false };
		}

		if (outcome.ok) {
			console.log("✅ Login successful!");

			// Persist the fresh session for the next run. Best-effort — a save
			// failure here must not fail a login that just succeeded. Guarded by
			// AJIO_SESSION_SAVE inside saveAjioSession, so no-ops when off.
			// Runs BEFORE popup dismissal so the harvested jar reflects the
			// post-SSO-callback state (which is what future reuse will replay);
			// popup clicks after login do not mutate the auth cookies.
			if (isAjioSessionSaveEnabled()) {
				try {
					const sellerUserId = await getAjioUserId(page);
					if (sellerUserId) {
						const { pobIds, stores } = await getAjioPobIds(page, sellerUserId);
						if (Array.isArray(pobIds) && pobIds.length > 0) {
							const jar = await harvestAjioCookies(page);
							await saveAjioSession({
								credentialId: user[0]._id || user[0].credentialId,
								username,
								jar,
								userId: sellerUserId,
								pobIds,
								stores,
								source: "auto-claim",
							});
						}
					}
				} catch (saveErr) {
					console.warn(`⚠️ AJIO session save from claim flow failed — continuing without cache: ${saveErr.message}`);
				}
			}
		} else {
			const { reasonText, isBadCreds } = outcome;
			console.warn(`🔒 Login not completed for ${username}: ${reasonText || "still on SSO page"}`);
			failedUsers.push({
				...user,
				error: reasonText || "Login failed (SSO)",
				reason: isBadCreds ? "password_changed" : "login_error",
				numberOfObject,
			});

			if (isBadCreds) {
				// Credential is bad (wrong password, or AJIO locked the account after
				// repeated attempts). Flip is_verified=false so later runs skip it, then
				// THROW — callers that pass a throwaway failedUsers array (the claim
				// scripts do) would otherwise treat this as a successful login.
				// credentialContext is optional: no companyId → we only throw.
				const ctx = options.credentialContext;
				if (ctx?.companyId) {
					await unverifyAjioCredential(
						{ companyId: ctx.companyId, username, trackVidEmail: ctx.trackVidEmail },
						ctx.logger
					);
				}
				throw new AjioCredentialError(
					`AJIO rejected credentials for ${username}: ${reasonText || "login failed"}`,
					{ username, reasonText }
				);
			}

			// Non-credential failure — skip to next user (caller owns/closes the context).
			// `otp` marks an unanswered one-time-code challenge; `reason` stays
			// "login_error" so existing consumers classify it as before.
			return {
				ok: false,
				error: reasonText || "Login failed (SSO)",
				reason: "login_error",
				...(outcome.otp ? { otp: true } : {}),
			};
		}

		// Pure API flows (e.g. the auto-claim script) never click the UI — they call same-origin
		// APIs that work even with a popup on screen. Such callers pass skipPostLoginPopups:true to
		// skip the (slow) dismissals + settle; they just need localStorage to hydrate, which
		// getUserId polls for. This also makes those flows immune to future AJIO popups.
		if (options.skipPostLoginPopups) {
			console.log("⚡ skipPostLoginPopups — API flow, not dismissing popups.");
		} else {
			// 🚨 Seller Agreements onboarding interstitial (Skip -> Agree; may be several).
			// Runs FIRST — it renders before the dashboard and blocks everything else.
			await tryDismissSellerAgreementsPopup(page, { context: "after login" });

			// 🚨 AJIO Announcement popup (polls; appears on login with a delay)
			await tryDismissAjioAnnouncementPopup(page, { context: "after login" });

			// Optional Transaction Confirmation (scoped to dialog + polling)
			await tryDismissTransactionConfirmationPopup(page);

			// Give the shell time to settle (dropdowns, overlays) before Returns / POB flow
			console.log("⏳ Post-login UI settle before automation continues...");
			await sleep(2000);
		}

		return { ok: true };
	} catch (error) {
		// A rejected credential must reach the caller — this catch exists to absorb
		// incidental automation errors, and swallowing it here would let the claim
		// scripts carry on as if the login had worked.
		if (error instanceof AjioCredentialError) throw error;
		console.error("🚨 Automation failed:", error.message);
		failedUsers.push(user);
		// failedUsers is a throwaway array in the claim scripts, so it cannot be the only signal:
		// report the failure in the return value too.
		return { ok: false, error: error.message, reason: "automation_error" };
	}
};

module.exports = { login, gotoWithAbortRetry, tryDismissTransactionConfirmationPopup, tryDismissAjioAnnouncementPopup, tryDismissSellerAgreementsPopup };
