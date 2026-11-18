// -----------------------------------------------------------------------------
// Is this jar actually signed in?
// -----------------------------------------------------------------------------
// Counting cookies does not answer that question, and assuming it does is how a
// non-session gets stored as a session.
//
// A marketplace's PUBLIC landing page sets plenty of cookies — analytics, CDN,
// bot-detection, a CSRF seed. Snapdeal's seller-onboarding page alone sets more
// than the three a "looks like a session" heuristic asks for. So an operator who
// opens the sign-in window, does not sign in, and closes it produces a jar that
// passes every count-based check, is accepted by an ingest endpoint that only
// guards `Object.keys(jar).length === 0`, and is stored as a live session. The
// card then reads Active and every automation using it fails somewhere else.
//
// Each platform already knows how to settle this — its session store has a
// liveness probe that asks the marketplace a question only a signed-in session
// can answer (Snapdeal's `/getLoggedInSeller`, and so on). Those probes exist to
// validate a CACHED session before reuse; they are just as good at validating a
// freshly captured one, and using them means there is one definition of
// "signed in" per platform rather than two.
// -----------------------------------------------------------------------------

// Static requires — a bundler cannot follow a computed one. See CLAUDE.md.
const { platformKey } = require("./platforms.js");

const PROBES = {
    snapdeal: () => require("../platforms/snapdeal/common/sessionStore.js").probeSession,
    meesho: () => require("../platforms/meesho/common/sessionStore.js").probeSession,
    nykaa: () => require("../platforms/nykaa/common/sessionStore.js").probeSession,
    flipkart: () => require("../platforms/flipkart/common/sessionStore.js").probeSession,
    myntra: () => require("../platforms/myntra/common/sessionStore.js").probeSession,
    delhivery: () => require("../platforms/delhivery/common/sessionStore.js").probeSession,
    xbees: () => require("../platforms/xbees/common/sessionStore.js").probeSession,
    // AJIO is absent on purpose: its probe is `probeSessionInPage(page, record)`
    // and needs a live browser page, which a caller holding only a jar does not
    // have. Callers get `null` — "cannot tell" — rather than a false verdict.
};

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
async function probePlatformSession(platform, jar, extra = {}) {
    const key = platformKey(platform);
    const load = PROBES[key];

    if (!load) return null;

    let probe;
    try {
        probe = load();
    } catch (err) {
        console.warn(`⚠️ [probeSession] ${key} probe unavailable: ${err.message}`);
        return null;
    }
    if (typeof probe !== "function") return null;

    try {
        // The stores probe a stored RECORD, whose shape is `{ jar, ...extras }`.
        return (await probe({ jar, ...extra })) === true;
    } catch (err) {
        console.warn(`⚠️ [probeSession] ${key} probe could not run: ${err.message}`);
        return null;
    }
}

/** Platforms whose jar can be validated without a browser page. */
function probablePlatforms() {
    return Object.keys(PROBES);
}

module.exports = { probePlatformSession, probablePlatforms, PROBES };
