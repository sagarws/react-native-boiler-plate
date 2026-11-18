export namespace IDENTITY_CHECKS {
    namespace ajio {
        function request(record: any): {
            method: string;
            url: string;
            headers: {
                cookie: string;
                Referer?: any;
                accept: string;
                "accept-language": string;
                "user-agent": string;
                "sec-ch-ua": string;
                "sec-ch-ua-mobile": string;
                "sec-ch-ua-platform": string;
                "sec-fetch-dest": string;
                "sec-fetch-mode": string;
                "sec-fetch-site": string;
            };
        };
        function read(status: any, body: any): {
            ok: boolean;
            who?: undefined;
        } | {
            ok: boolean;
            who: string;
        };
    }
    namespace meesho {
        export function request_1(record: any): {
            method: string;
            url: string;
            data: {
                supplierId: number;
            };
            headers: {
                cookie: string;
                "browser-id"?: string;
                "content-type": string;
                origin: string;
                "client-type": string;
                "client-package-version": string;
                identifier: string;
                "supplier-id": string;
                Referer?: any;
                accept: string;
                "accept-language": string;
                "user-agent": string;
                "sec-ch-ua": string;
                "sec-ch-ua-mobile": string;
                "sec-ch-ua-platform": string;
                "sec-fetch-dest": string;
                "sec-fetch-mode": string;
                "sec-fetch-site": string;
            };
        };
        export { request_1 as request };
        export function read_1(status: any, body: any): {
            ok: boolean;
        };
        export { read_1 as read };
    }
    namespace snapdeal {
        export function request_2(record: any): {
            method: string;
            url: string;
            headers: {
                "x-requested-with": string;
                cookie: string;
                Referer?: any;
                accept: string;
                "accept-language": string;
                "user-agent": string;
                "sec-ch-ua": string;
                "sec-ch-ua-mobile": string;
                "sec-ch-ua-platform": string;
                "sec-fetch-dest": string;
                "sec-fetch-mode": string;
                "sec-fetch-site": string;
            };
        };
        export { request_2 as request };
        export function read_2(status: any, body: any): {
            ok: boolean;
            who?: undefined;
        } | {
            ok: boolean;
            who: string;
        };
        export { read_2 as read };
    }
    namespace nykaa {
        export function request_3(record: any): {
            method: string;
            url: string;
            headers: {
                "x-requested-with": string;
                cookie: string;
                Referer?: any;
                accept: string;
                "accept-language": string;
                "user-agent": string;
                "sec-ch-ua": string;
                "sec-ch-ua-mobile": string;
                "sec-ch-ua-platform": string;
                "sec-fetch-dest": string;
                "sec-fetch-mode": string;
                "sec-fetch-site": string;
            };
        };
        export { request_3 as request };
        export function read_3(status: any, body: any): {
            ok: boolean;
            who?: undefined;
        } | {
            ok: boolean;
            who: string;
        };
        export { read_3 as read };
    }
    namespace flipkart {
        export function request_4(record: any): {
            method: string;
            url: string;
            headers: {
                accept: string;
                "x-requested-with": string;
                "fk-csrf-token": string;
                cookie: string;
                Referer?: any;
                "accept-language": string;
                "user-agent": string;
                "sec-ch-ua": string;
                "sec-ch-ua-mobile": string;
                "sec-ch-ua-platform": string;
                "sec-fetch-dest": string;
                "sec-fetch-mode": string;
                "sec-fetch-site": string;
            };
        };
        export { request_4 as request };
        export function read_4(status: any, body: any): {
            ok: boolean;
            who?: undefined;
        } | {
            ok: boolean;
            who: string;
        };
        export { read_4 as read };
    }
    namespace myntra {
        export function request_5(record: any): {
            method: string;
            url: string;
            headers: {
                accept: string;
                origin: string;
                "sec-fetch-site": string;
                "x-myntra-app-name": string;
                "x-myntra-knuth": string;
                "x-requested-with": string;
                cookie: string;
                Referer?: any;
                "accept-language": string;
                "user-agent": string;
                "sec-ch-ua": string;
                "sec-ch-ua-mobile": string;
                "sec-ch-ua-platform": string;
                "sec-fetch-dest": string;
                "sec-fetch-mode": string;
            };
        };
        export { request_5 as request };
        export function read_5(status: any, body: any): {
            ok: boolean;
            who?: undefined;
        } | {
            ok: boolean;
            who: string;
        };
        export { read_5 as read };
    }
    namespace delhivery {
        export function request_6(record: any): {
            method: string;
            url: string;
            headers: {
                accept: string;
                "accept-language": string;
                "user-agent": string;
                origin: string;
                Referer: string;
                authorization: string;
            };
        };
        export { request_6 as request };
        export function read_6(status: any, body: any): {
            ok: boolean;
            who?: undefined;
        } | {
            ok: boolean;
            who: string;
        };
        export { read_6 as read };
    }
}
/** Platforms this module can ask, lowercase. */
export const IDENTITY_PLATFORMS: string[];
/**
 * Platforms where SIGNING IN AGAIN is the check.
 *
 * Xbees has no cookie jar and no browser step: its session is a bearer token
 * obtained by posting credentials to one endpoint. For a platform like that,
 * asking "is this token still good?" and then signing in when the answer is no
 * is two calls to learn what one call would have settled — and the one call
 * leaves a FRESH token behind either way, where the probe leaves an old one
 * that is a little closer to expiry.
 *
 * So the caller renews instead, and the verdict is whether the login worked.
 *
 * Deliberately NOT Delhivery, which is the same shape. Delhivery has a captured
 * identity endpoint, and its sign-in is the one an operator may have to watch —
 * a check that quietly triggers logins is a check nobody can run casually.
 *
 * This is a DECLARATION, not an implementation: the consumers own sign-in, and
 * this package must not start driving one from a health check.
 */
export const RENEW_ON_CHECK: string[];
/** Is signing in again the right way to check this platform? */
export function renewsOnCheck(platform: any): boolean;
/** Is there an identity endpoint for this platform? */
export function hasIdentityCheck(platform: any): boolean;
/**
 * Ask the marketplace who this session belongs to.
 *
 * @param {string} platform
 * @param {object} record  the stored session — `{ jar, ...extras }`
 * @param {{ logger?: object }} [options]
 * @returns {Promise<{ok: true|false|null, who: string|null, detail: string, status: number|null}>}
 */
export function checkSessionIdentity(platform: string, record: object, { logger }?: {
    logger?: object;
}): Promise<{
    ok: true | false | null;
    who: string | null;
    detail: string;
    status: number | null;
}>;
