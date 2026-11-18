/**
 * Errors shared by the platform claim API flows.
 */
/**
 * A 401/403 from a platform API. Carries code "AUTH_EXPIRED" so callers can
 * re-login and retry once instead of failing the claim.
 */
export function authError(step: any, status: any, body: any): Error;
