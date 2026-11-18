export function isSessionCacheEnabled(): boolean;
export function saveSession({ credentialId, username, jar, supplierId, supplierIdentifier, source }: {
    credentialId: any;
    username: any;
    jar: any;
    supplierId?: any;
    supplierIdentifier?: any;
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
    supplierId: any;
    supplierIdentifier: any;
}>;
import { cookieHeader } from "../../../common/sessionHelpers";
export const SESSION_FIELD: "meeshoSession";
export const ORIGIN: "https://supplier.meesho.com";
export { cookieHeader };
