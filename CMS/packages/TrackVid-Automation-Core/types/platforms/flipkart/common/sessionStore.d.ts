export function isSessionCacheEnabled(): boolean;
export function saveSession({ credentialId, username, jar, csrfToken, ip, source, }: {
    credentialId: any;
    username: any;
    jar: any;
    csrfToken: any;
    ip?: any;
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
    csrfToken: any;
    sellerId: any;
}>;
export const SESSION_FIELD: "flipkartSession";
