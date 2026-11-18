/**
 * The context a claim runner can use instead of signing in, or null.
 *
 * @param {string} platform  platform key, any casing
 * @param {object} record    the stored session, as the ingest wrote it
 * @returns {*|null} whatever that platform's login would have returned
 */
export function claimContextFromSession(platform: string, record: object): any | null;
/** Which fields a stored session is missing before it could replace a login. */
export function missingContextFields(platform: any, record: any): any;
/**
 * Is this platform's session judged INSIDE a browser page rather than here?
 *
 * AJIO and Tata CliQ sit behind Akamai and Cloudflare, and every call they make
 * is a `fetch` from within a logged-in page. There is no jar-plus-token context
 * that could stand in for a login, so `claimContextFromSession` always declines
 * for them — and a caller that reads that as "the stored session is no good"
 * says the wrong thing. It is the runner that opens the page, rehydrates the
 * cookies and asks the portal.
 *
 * This exists because one such caller DID say the wrong thing: the desktop
 * logged "will sign in — the stored session is missing nothing — Tata CliQ is
 * probed inside the browser page instead", and then reused the session without
 * signing in. The sentence contradicted itself and contradicted what happened.
 */
export function isPageProbed(platform: any): boolean;
export namespace CONTEXTS {
    namespace ajio {
        let required: any[];
        function build(): any;
        let pageProbed: boolean;
    }
    namespace myntra {
        let required_1: any[];
        export { required_1 as required };
        export function build_1(record: any): any;
        export { build_1 as build };
    }
    namespace snapdeal {
        let required_2: any[];
        export { required_2 as required };
        export function build_2(record: any): {
            jar: any;
            sellerId: any;
        };
        export { build_2 as build };
    }
    namespace meesho {
        let required_3: any[];
        export { required_3 as required };
        export function build_3(record: any): {
            jar: any;
            supplierId: any;
            supplierIdentifier: any;
        };
        export { build_3 as build };
    }
    namespace tatacliq {
        let required_4: any[];
        export { required_4 as required };
        export function build_4(): any;
        export { build_4 as build };
        let pageProbed_1: boolean;
        export { pageProbed_1 as pageProbed };
    }
    namespace flipkart {
        let required_5: string[];
        export { required_5 as required };
        export function build_5(record: any): {
            jar: any;
            csrfToken: any;
            sellerId: any;
        };
        export { build_5 as build };
    }
    namespace nykaa {
        let required_6: string[];
        export { required_6 as required };
        export function build_6(record: any): {
            jar: any;
            portalId: any;
            userId: any;
        };
        export { build_6 as build };
    }
    namespace delhivery {
        let required_7: string[];
        export { required_7 as required };
        export let jarless: boolean;
        export function build_7(record: any): {
            accessToken: any;
            accessExpiresAt: any;
            refreshToken: any;
            tokenType: any;
            idToken: any;
            realm: any;
            tenantId: any;
            hqClientId: any;
            clientId: any;
        };
        export { build_7 as build };
    }
    namespace xbees {
        let required_8: string[];
        export { required_8 as required };
        let jarless_1: boolean;
        export { jarless_1 as jarless };
        export function build_8(record: any): {
            accessToken: any;
            accessExpiresAt: any;
            refreshToken: any;
            tokenType: any;
            idToken: any;
            realm: any;
            clientId: any;
        };
        export { build_8 as build };
    }
}
