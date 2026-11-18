// -----------------------------------------------------------------------------
// Snapdeal login error classification
// -----------------------------------------------------------------------------
// Distinguish TRUE bad-credential errors (login form still visible after
// submit → password changed / account disabled) from transient issues
// (selector timeout, captcha, network error, portal 5xx). Only the former
// should unverify the credential — the rest are worth retrying.
//
// The Puppeteer login (snapdealAutoClaim/utils.js:snapdealLogin) throws an
// error message prefixed with "INVALID_CREDENTIALS:" exactly when it sees
// the login form still on screen after the submit + reload retry. Every
// other failure surfaces with a different message. So the check here is a
// substring match on that prefix — same rule the existing
// snapdealMasterDataImport/script.js already uses when it decides whether
// to add a config to `password_changed`.
// -----------------------------------------------------------------------------

const INVALID_CREDENTIALS_PREFIX = "INVALID_CREDENTIALS:";

function isInvalidCredentialsError(err) {
    if (!err) return false;
    // Explicit tag on the error object wins if present (future-proofing for
    // API-based login paths that classify with err.code).
    if (typeof err.code === "string" && err.code === "INVALID_CREDENTIALS") return true;
    const msg = typeof err.message === "string" ? err.message : String(err);
    return msg.includes(INVALID_CREDENTIALS_PREFIX);
}

module.exports = {
    isInvalidCredentialsError,
    INVALID_CREDENTIALS_PREFIX,
};
