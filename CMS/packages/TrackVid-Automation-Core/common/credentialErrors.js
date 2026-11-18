/**
 * Recognising "the credential itself is wrong" as distinct from "the request failed".
 *
 * Callers use this to decide whether to mark a credential unverified and stop,
 * rather than retry. Delhivery and Xbees shipped identical copies; both are
 * OAuth-style logins that answer invalid_grant.
 */

const INVALID_CREDENTIALS_PREFIX = "INVALID_CREDENTIALS:";

function isInvalidCredentialsError(err) {
	if (!err) return false;
	if (typeof err.code === "string" && err.code === "INVALID_CREDENTIALS") return true;
	const msg = typeof err.message === "string" ? err.message : String(err);
	if (msg.includes(INVALID_CREDENTIALS_PREFIX)) return true;
	if (/invalid_grant/i.test(msg) && /Invalid user credentials/i.test(msg)) return true;
	return false;
}

module.exports = { INVALID_CREDENTIALS_PREFIX, isInvalidCredentialsError };
