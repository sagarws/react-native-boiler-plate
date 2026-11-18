export function isSessionCacheEnabled(): boolean;
export function saveSession({ credentialId, username, accessToken, refreshToken, accessExpiresIn, idToken, tokenType, realm, tenantId, hqClientId, clientId, source, }: {
    credentialId: any;
    username: any;
    accessToken: any;
    refreshToken: any;
    accessExpiresIn: any;
    idToken?: any;
    tokenType?: string;
    realm: any;
    tenantId?: any;
    hqClientId?: any;
    clientId?: string;
    source?: string;
}): Promise<boolean>;
export function saveHqClientId({ credentialId, username }: {
    credentialId: any;
    username: any;
}, hqClientId: any): Promise<boolean>;
export function loadSession({ credentialId, username }: {
    credentialId: any;
    username: any;
}): Promise<any>;
export function clearSession({ credentialId, username }: {
    credentialId: any;
    username: any;
}, reason?: string): Promise<boolean>;
export function probeSession(record: any): Promise<boolean>;
export function refreshAccessToken(record: any): Promise<{
    accessToken: any;
    refreshToken: any;
    accessExpiresIn: any;
    idToken: any;
    tokenType: any;
}>;
export function getUsableSession(cacheKey: any): Promise<{
    accessToken: any;
    refreshToken: any;
    tokenType: any;
    realm: any;
    tenantId: any;
    hqClientId: any;
    clientId: any;
    idToken: any;
}>;
export const SESSION_FIELD: "delhiverySession";
export const AUTH_HOST: "https://ucp-auth.delhivery.com";
export const APP_AUTH_HOST: "https://ucp-app-auth.delhivery.com";
export const GATEWAY_HOST: "https://ucp-app-gateway.delhivery.com";
export function TOKEN_URL(realm: any): string;
export const PROBE_URL: "https://ucp-app-auth.delhivery.com/p/api/account/profile";
export const REFRESH_BEFORE_EXPIRY_SEC: 60;
