/**
 * Ask the marketplace whether this jar is signed in.
 *
 * @returns {Promise<true|false|null>}
 *   true   the marketplace answered as it does for a signed-in seller
 *   false  it did not — the jar is anonymous or expired
 *   null   no probe for this platform, or the probe itself could not run
 *          (offline, timeout). Deliberately distinct from false: refusing a
 *          real session because the network hiccuped is its own failure.
 */
export function probePlatformSession(platform: any, jar: any, extra?: {}): Promise<true | false | null>;
/** Platforms whose jar can be validated without a browser page. */
export function probablePlatforms(): string[];
export namespace PROBES {
    function snapdeal(): typeof import("../platforms/snapdeal/common/sessionStore.js").probeSession;
    function meesho(): typeof import("../platforms/meesho/common/sessionStore.js").probeSession;
    function nykaa(): typeof import("../platforms/nykaa/common/sessionStore.js").probeSession;
    function flipkart(): typeof import("../platforms/flipkart/common/sessionStore.js").probeSession;
    function myntra(): typeof import("../platforms/myntra/common/sessionStore.js").probeSession;
    function delhivery(): typeof import("../platforms/delhivery/common/sessionStore.js").probeSession;
    function xbees(): typeof import("../platforms/xbees/common/sessionStore.js").probeSession;
}
