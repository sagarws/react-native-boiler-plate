export function isSessionSaveEnabled(): boolean;
export function saveSession({ credentialId, username, jar, userId, pobIds, stores, ip, source, }: {
    credentialId: any;
    username: any;
    jar: any;
    userId: any;
    pobIds: any;
    stores?: any[];
    ip?: any;
    source?: string;
}): Promise<boolean>;
export function reuseSessionRecord(page: any, record: any, { username, landingUrl }?: {}): Promise<{
    userId: any;
    pobIds: any;
    stores: any;
}>;
export function loadSession({ credentialId, username }: {
    credentialId: any;
    username: any;
}): Promise<any>;
export function clearSession({ credentialId, username }: {
    credentialId: any;
    username: any;
}, reason?: string): Promise<boolean>;
export function harvestCookies(page: any): Promise<any>;
export function hydrateCookies(page: any, jar: any): Promise<number>;
export function probeSessionInPage(page: any, record: any): Promise<boolean>;
export function tryReuseSession(page: any, { credentialId, username, landingUrl }: {
    credentialId: any;
    username: any;
    landingUrl: any;
}): Promise<{
    userId: any;
    pobIds: any;
    stores: any;
}>;
export function clearPageAuthState(page: any): Promise<void>;
export const SESSION_FIELD: "ajioSession";
