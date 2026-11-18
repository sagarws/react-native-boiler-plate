// meeshoLogin (utils.js) throws error messages starting with "LOGIN_FAILED_"
// when the login form's own error banner shows post-submit. Everything else
// (selector timeout, captcha, network) is transient — those must NOT unverify
// the credential.

const INVALID_CREDENTIALS_PREFIX = "LOGIN_FAILED_";

function isInvalidCredentialsError(err) {
    if (!err) return false;
    if (typeof err.code === "string" && err.code === "INVALID_CREDENTIALS") return true;
    const msg = typeof err.message === "string" ? err.message : String(err);
    return msg.startsWith(INVALID_CREDENTIALS_PREFIX);
}

module.exports = { isInvalidCredentialsError, INVALID_CREDENTIALS_PREFIX };
