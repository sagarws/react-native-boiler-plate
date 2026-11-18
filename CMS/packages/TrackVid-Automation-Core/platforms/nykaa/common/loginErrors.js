// Nykaa's loginNykaa (utils.js) throws:
//   "Nykaa login failed: <Zoho error>"  → invalid credentials
//   "Nykaa login blocked: <BLOCKER>"    → CAPTCHA / MFA / OTP (transient — user action needed)
// Only the "login failed" branch is a credential-change signal.

const INVALID_PREFIX = "Nykaa login failed:";
const BLOCKED_PREFIX = "Nykaa login blocked:";

function isInvalidCredentialsError(err) {
    if (!err) return false;
    if (typeof err.code === "string" && err.code === "INVALID_CREDENTIALS") return true;
    const msg = typeof err.message === "string" ? err.message : String(err);
    return msg.startsWith(INVALID_PREFIX);
}
function isLoginBlockedError(err) {
    if (!err) return false;
    const msg = typeof err.message === "string" ? err.message : String(err);
    return msg.startsWith(BLOCKED_PREFIX);
}

module.exports = { isInvalidCredentialsError, isLoginBlockedError, INVALID_PREFIX, BLOCKED_PREFIX };
