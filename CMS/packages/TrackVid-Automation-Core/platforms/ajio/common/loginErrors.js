// Shared AJIO login-failure detection.
//
// Every AJIO script submits the Reliance SSO form and then waits for the OAuth
// redirect back to seller.ajio.com. When that redirect never happens we have to
// work out WHY from whatever the SSO page rendered, because the distinction
// drives a real side effect: a credential problem flips is_verified=false on the
// credential (so later runs skip it), while a timeout/captcha must NOT.
//
// AJIO surfaces login errors in three different places:
//   1. #uap-flash                      — page-level flash message
//   2. .field-error                    — inline per-field validation
//   3. .uap-toast--error .uap-toast__body  — toast popup, e.g.
//      "Your account is locked. Please reset your password to enable login."
//
// (3) is the account-lockout AJIO shows after repeated wrong-password attempts.
// It is a CREDENTIAL failure — the login can never succeed until the seller
// resets the password — so it must be classified as `password_changed`, not as
// a transient `login_error`.

/** Text of an AJIO login error, or "" when the page shows none. */
const READ_LOGIN_ERROR = () => {
    const txt = (el) => (el ? (el.getAttribute?.("content") || el.textContent || "").trim() : "");

    // 1. page-level flash
    const flashTxt = txt(document.querySelector("#uap-flash"));

    // 2. inline field errors
    const fieldErr = Array.from(document.querySelectorAll(".field-error"))
        .map((e) => e.innerText.trim())
        .filter(Boolean)
        .join("; ");

    // 3. error toast — the account-locked popup lives here. Match the toast body
    //    first, then fall back to any alert-role container carrying error text.
    const toastErr = Array.from(
        document.querySelectorAll(".uap-toast--error .uap-toast__body, .uap-toast--error")
    )
        .map((e) => (e.innerText || "").trim())
        .filter(Boolean)
        .join("; ");

    return flashTxt || fieldErr || toastErr || "";
};

/**
 * Does this error text mean the CREDENTIAL is bad (as opposed to a timeout,
 * captcha or network blip)?
 *
 * These patterns are deliberately anchored to a credential noun rather than
 * matching bare words. The earlier version tested /wrong/ on its own, which
 * classified AJIO's generic "Something went wrong. Please try again." as a bad
 * password — harmless when it only picked a log label, but not now that a match
 * flips is_verified=false on a seller's working credential.
 *
 * Err toward under-matching: a missed lockout costs one wasted run, while a
 * false positive disables a good credential until someone re-verifies it by hand.
 */
const BAD_CREDENTIAL_PATTERNS = [
    /account\s+is\s+locked/i,                     // "Your account is locked."
    /reset\s+your\s+password/i,                   // "...reset your password to enable login."
    /(invalid|incorrect|wrong|bad)\s+(user\s*name|user\s*id|e-?mail|password|credential)/i,
    /(user\s*name|user\s*id|e-?mail|password|credential)s?\s+(is|are|was)?\s*(invalid|incorrect|wrong)/i,
    // Same idea as the line above but tolerating words between the noun and the
    // verdict — AJIO's toast reads "The password you entered is incorrect.",
    // where "you entered" sits in the middle. Bounded to 40 chars and stopped at
    // sentence punctuation so it can't reach across into an unrelated sentence.
    /\b(user\s*name|user\s*id|e-?mail|password|credential)s?\b[^.!?]{0,40}\b(is|are|was|were)\s+(incorrect|invalid|wrong)\b/i,
    /user\s*name\s+or\s+password/i,               // "Invalid username or password"
    /authentication\s+failed/i,
];

/**
 * Machine error codes AJIO puts in the same toast instead of a sentence, e.g.
 *   <div class="uap-toast__body">PASSWORD_RESET_REQUIRED</div>
 *
 * These need their own list because the prose patterns above all require
 * whitespace between words — "PASSWORD_RESET_REQUIRED" matches none of them.
 * Add new codes here as AJIO surfaces them; matching is separator-insensitive,
 * so PASSWORD-RESET-REQUIRED and "password reset required" hit the same entry.
 */
const BAD_CREDENTIAL_CODES = [
    "PASSWORD_RESET_REQUIRED",
    "PASSWORD_EXPIRED",
    "INVALID_CREDENTIALS",
    "INVALID_USERNAME_OR_PASSWORD",
    "INVALID_PASSWORD",
    "INCORRECT_PASSWORD",
    "BAD_CREDENTIALS",
    "ACCOUNT_LOCKED",
    "ACCOUNT_DISABLED",
    "ACCOUNT_BLOCKED",
    "USER_BLOCKED",
    "AUTHENTICATION_FAILED",
    "AUTH_FAILED",
];

/** Collapse any separator run to a single underscore so codes match regardless
 *  of how they are punctuated, and the trailing "×" from the toast's close
 *  button cannot break the match. */
const normalizeCode = (s) =>
    `_${String(s || "").toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_`;

function isBadCredentials(reasonText) {
    const text = String(reasonText || "");

    if (BAD_CREDENTIAL_PATTERNS.some((re) => re.test(text))) return true;

    // Bounded by underscores on both sides so a code only matches as a whole
    // token — LOGIN_ACCOUNT_LOCKED_WARNING still matches ACCOUNT_LOCKED, but a
    // longer unrelated word containing it as a fragment does not.
    const normalized = normalizeCode(text);

    return BAD_CREDENTIAL_CODES.some((code) => normalized.includes(`_${code}_`));
}

/** Read whatever login error the SSO page is currently showing ("" if none). */
async function readAjioLoginError(page) {
    return page.evaluate(READ_LOGIN_ERROR).catch(() => "");
}

/** Thrown by ajio/common/login.js when AJIO rejects the credential outright. */
class AjioCredentialError extends Error {
    constructor(message, { username, reasonText } = {}) {
        super(message);
        this.name = "AjioCredentialError";
        this.reason = "password_changed";
        this.username = username;
        this.reasonText = reasonText;
    }
}

/**
 * Wait for the login to resolve one way or the other.
 *
 * Races the success signal (redirect to seller.ajio.com) against the failure
 * signal (an error toast/flash appearing). Without the race we would sit out the
 * full 45s timeout even though the locked-account toast already told us at ~2s
 * that this login can never succeed — for an 8-account company that is minutes
 * of dead waiting per run.
 *
 * @param {object} [options]
 * @param {boolean} [options.detectOtp=false] also resolve, with `otp: true`,
 *          when the SSO shows its one-time-code challenge instead of redirecting.
 * @returns {Promise<{ok: true}|{ok: false, otp?: true, reasonText: string, isBadCreds: boolean, timedOut: boolean}>}
 *          Never throws — callers decide what a failure means for their flow.
 */
async function waitForAjioLoginOutcome(page, { timeoutMs = 45000, pollMs = 500, detectOtp = false } = {}) {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
        // Success: OAuth bounced us back to the seller portal.
        const onPortal = await page
            .evaluate(() => location.hostname.includes("seller.ajio.com"))
            .catch(() => false);
        if (onPortal) return { ok: true };

        // Opt-in: the SSO is asking for a one-time code (`form#mfaForm`). Checked
        // BEFORE the error read, because a refused code re-renders this page with
        // an error toast that must never be classified as a bad password.
        // Callers that do not pass `detectOtp` behave exactly as before.
        if (detectOtp) {
            const onMfa = await page
                .evaluate(() => Boolean(document.querySelector("#mfaForm")))
                .catch(() => false);
            if (onMfa) {
                return {
                    ok: false,
                    otp: true,
                    reasonText: "AJIO asked for a one-time code",
                    isBadCreds: false,
                    timedOut: false,
                };
            }
        }

        // Failure: the page is telling us why. Only stop early for a credential
        // error — transient text ("something went wrong") deserves the full wait.
        const reasonText = await readAjioLoginError(page);
        if (reasonText && isBadCredentials(reasonText)) {
            return { ok: false, reasonText, isBadCreds: true, timedOut: false };
        }

        await new Promise((r) => setTimeout(r, pollMs));
    }

    // Timed out — do a final read so a late-rendering error is still classified.
    const reasonText = await readAjioLoginError(page);
    return {
        ok: false,
        reasonText,
        isBadCreds: isBadCredentials(reasonText),
        timedOut: true,
    };
}

module.exports = {
    readAjioLoginError,
    isBadCredentials,
    waitForAjioLoginOutcome,
    AjioCredentialError,
};
