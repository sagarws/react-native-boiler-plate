export function isSessionCacheEnabled(): boolean;
export function saveSession({ credentialId, username, jar, source, }: {
    credentialId: any;
    username: any;
    jar: any;
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
    sellerId: any;
}>;
import { cookieHeader } from "../../../common/sessionHelpers";
export const SESSION_FIELD: "snapdealSession";
export const ORIGIN: "https://seller.snapdeal.com";
export { cookieHeader };
