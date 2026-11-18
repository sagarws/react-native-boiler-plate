/** Read whatever login error the SSO page is currently showing ("" if none). */
export function readAjioLoginError(page: any): Promise<any>;
export function isBadCredentials(reasonText: any): boolean;
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
export function waitForAjioLoginOutcome(page: any, { timeoutMs, pollMs, detectOtp }?: {
    timeoutMs?: number;
    pollMs?: number;
    detectOtp?: boolean;
}): Promise<{
    ok: true;
} | {
    ok: false;
    otp?: true;
    reasonText: string;
    isBadCreds: boolean;
    timedOut: boolean;
}>;
/** Thrown by ajio/common/login.js when AJIO rejects the credential outright. */
export class AjioCredentialError extends Error {
    constructor(message: any, { username, reasonText }?: {});
    reason: string;
    username: any;
    reasonText: any;
}
