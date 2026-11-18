export function isSessionCacheEnabled(): boolean;
export function saveSession({ credentialId, username, accessToken, refreshToken, accessExpiresIn, idToken, tokenType, realm, clientId, source, }: {
    credentialId: any;
    username: any;
    accessToken: any;
    refreshToken: any;
    accessExpiresIn: any;
    idToken?: any;
    tokenType?: string;
    realm?: string;
    clientId?: string;
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
export function refreshAccessToken(record: any): Promise<{
    accessToken: any;
    refreshToken: any;
    accessExpiresIn: any;
    idToken: any;
    tokenType: any;
}>;
export function probeSession(record: any): Promise<boolean>;
export function getUsableSession(cacheKey: any): Promise<{
    accessToken: any;
    refreshToken: any;
    tokenType: any;
    realm: any;
    clientId: any;
    idToken: any;
}>;
export const SESSION_FIELD: "xbeesSession";
export const AUTH_HOST: "https://auth.xbees.in";
export const AUTH_SERVICE_HOST: "https://authservice.xbees.in";
export const CLIENT_SHIP_HOST: "https://clientshipupdatesapi.xbees.in";
export const XBM_MASTER_HOST: "https://xbmasterapi.xbees.in";
export const DEFAULT_REALM: "xpressbees";
export const DEFAULT_CLIENT_ID: "client-portal-ui";
export function TOKEN_URL(realm: any): string;
export const PROBE_URL: "https://authservice.xbees.in/token?clients=b2cxpress,fms-service";
export const REFRESH_BEFORE_EXPIRY_SEC: 60;
