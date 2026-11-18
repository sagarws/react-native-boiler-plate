/**
 * Errors shared by the platform claim API flows.
 */

/**
 * A 401/403 from a platform API. Carries code "AUTH_EXPIRED" so callers can
 * re-login and retry once instead of failing the claim.
 */
function authError(step, status, body) {
	const err = new Error(
		`${step}: session expired (HTTP ${status}) ${String(body || "").slice(0, 200)}`
	);
	err.code = "AUTH_EXPIRED";
	return err;
}

module.exports = { authError };
