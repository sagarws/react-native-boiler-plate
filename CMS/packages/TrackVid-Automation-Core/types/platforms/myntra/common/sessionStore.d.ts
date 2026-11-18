export function isSessionCacheEnabled(): boolean;
export function saveSession({ credentialId, username, jar, ip, proxySession, source }: {
    credentialId: any;
    username: any;
    jar: any;
    ip?: any;
    proxySession?: any;
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
export function probeSession(input: any): Promise<boolean>;
export function getUsableSession({ credentialId, username, currentIp }: {
    credentialId: any;
    username: any;
    currentIp?: any;
}): Promise<any>;
export const SESSION_FIELD: "myntraSession";
