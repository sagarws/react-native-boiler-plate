/**
 * Recognising "the credential itself is wrong" as distinct from "the request failed".
 *
 * Callers use this to decide whether to mark a credential unverified and stop,
 * rather than retry. Delhivery and Xbees shipped identical copies; both are
 * OAuth-style logins that answer invalid_grant.
 */
export const INVALID_CREDENTIALS_PREFIX: "INVALID_CREDENTIALS:";
export function isInvalidCredentialsError(err: any): boolean;
