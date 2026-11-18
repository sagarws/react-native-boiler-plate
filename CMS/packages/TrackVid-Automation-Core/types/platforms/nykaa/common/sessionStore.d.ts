export function isSessionCacheEnabled(): boolean;
export function saveSession({ credentialId, username, jar, portalId, userId, source }: {
    credentialId: any;
    username: any;
    jar: any;
    portalId?: any;
    userId?: any;
    source?: string;
}): Promise<boolean>;
export function loadSession({ credentialId, username }: {
    credentialId: any;
    username: any;
}): Promise<any>;
export function clearSession({ credentialId, username }: {
    credentialId: any;
    username: any;
}, reason?: string): Promise<boolean>;
export function probeSession(record: any): Promise<boolean>;
export function getUsableSession({ credentialId, username }: {
    credentialId: any;
    username: any;
}): Promise<{
    jar: any;
    portalId: any;
    userId: any;
}>;
import { cookieHeader } from "../../../common/sessionHelpers";
/**
 * Can this jar do more than read?
 *
 * The distinction the old code missed. A session that answers /portal/api/me
 * with a 200 has proved only that it can READ — reads are not CSRF-guarded — so
 * probing is not enough to decide a session is worth keeping for a claim.
 */
export function canWrite(jar: any): boolean;
/**
 * The CSRF cookie in this jar, or null.
 *
 * Explicit names first, then a shape-based fallback so a rename costs a log
 * line rather than another failed batch: any cookie that looks like a CSRF
 * token and is not an IAM one, longest value first (the Desk token is 128 hex
 * characters; IAM's is a 36-character UUID).
 *
 * @returns {{name: string, value: string}|null}
 */
export function resolveCsrfCookie(jar: any): {
    name: string;
    value: string;
} | null;
export const CSRF_COOKIE_CANDIDATES: string[];
export const IAM_CSRF_CANDIDATES: string[];
export const SESSION_FIELD: "nykaaSession";
export const ORIGIN: "https://dispute.nykaa.com";
export { cookieHeader };
