/**
 * Mint a fresh session for one credential.
 *
 * `forceFresh` is always true: renewing is the act of replacing a session, so
 * reusing a cached one answers a different question. The login persists the
 * result through the platform's own session store, exactly as it does mid-batch
 * — this returns a summary for the caller to report, not the source of truth.
 *
 * @param {string} platform
 * @param {{ username: string, password?: string, _id?: any }} credentials
 * @param {object} [options] merged over the platform defaults
 * @returns {Promise<{ platform, username, jar, tokens, extra, cookieNames, durationMs }>}
 */
export function renewPlatformSession(platform: string, credentials: {
    username: string;
    password?: string;
    _id?: any;
}, options?: object): Promise<{
    platform: any;
    username: any;
    jar: any;
    tokens: any;
    extra: any;
    cookieNames: any;
    durationMs: any;
}>;
/** Is a scripted renewal available for this platform at all? */
export function canRenew(platform: any): boolean;
/** Platforms this module can renew. */
export function renewablePlatforms(): string[];
export namespace LOGINS {
    function ajio(): typeof import("../platforms/ajio/common/renewSession.js").loginAjioApi;
    function myntra(): (credentials: any, { forceFresh }?: {
        forceFresh?: boolean;
    }) => Promise<any>;
    function snapdeal(): typeof import("../platforms/snapdeal/claim-management/api-based-flow/claimApiFlow.js").loginSnapdealApi;
    function meesho(): typeof import("../platforms/meesho/claim-management/api-based-flow/claimApiFlow.js").loginMeeshoApi;
    function flipkart(): typeof import("../platforms/flipkart/claim-management/api-based-flow/claimApiFlow.js").loginFlipkartApi;
    function tatacliq(): typeof import("../platforms/tatacliq/common/renewSession.js").loginTataCliqApi;
    function nykaa(): typeof import("../platforms/nykaa/claim-management/api-based-flow/claimApiFlow.js").loginNykaaApi;
    function delhivery(): typeof import("../platforms/delhivery/claim-management/api-based-flow/claimApiFlow.js").loginDelhiveryApi;
    function xbees(): typeof import("../platforms/xbees/claim-management/api-based-flow/claimApiFlow.js").loginXbeesApi;
}
/** Platforms whose session is OAuth tokens rather than a cookie jar. */
export const TOKEN_PLATFORMS: Set<string>;
export function normalise(platform: any, result: any): {
    jar: any;
    tokens: {
        accessToken: any;
        refreshToken: any;
        realm: any;
    };
    extra: any;
} | {
    jar: any;
    tokens: any;
    extra: {
        slaves?: any;
        portalId?: any;
        supplierIdentifier?: any;
        supplierId?: any;
        stores?: any;
        pobIds?: any;
        userId?: any;
        csrfToken?: any;
        sellerId?: any;
    };
};
