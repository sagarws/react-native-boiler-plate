// -----------------------------------------------------------------------------
// Renew one credential's marketplace session — the proven path
// -----------------------------------------------------------------------------
// This is what Trackvid-Monitor's "Renew" button ultimately runs, and what the
// eight `/<platform>/renew-session` handlers in Automated-Scripts each
// re-implemented separately. One method here, so there is one answer.
//
// The whole job is already solved per platform by that platform's own
// `login<Platform>Api`: it drives a real browser, clears the marketing landing
// page, clicks whatever launcher the portal hides its form behind, survives the
// SSO redirect chain, harvests the jar, and persists it through the platform's
// session store. Those functions are years of accumulated portal quirks. Nothing
// should reimplement them — this module only picks the right one and normalises
// what it hands back.
//
// The return shapes genuinely differ and always have: Myntra answers with a bare
// cookie map, Snapdeal with `{ jar, sellerId }`, the rest with a context object
// carrying `.jar`. Callers were each unwrapping that by hand, which is precisely
// how a caller ends up storing a context object where a jar belongs.
//
// Requires a browser driver (puppeteer / selenium), so this runs on the
// automation server. A consumer without one reaches it over HTTP instead —
// Trackvid-CMS calls POST /cms/renew-session, which lands here.
// -----------------------------------------------------------------------------

/**
 * Platform → the login that mints a fresh session for it.
 *
 * Required lazily and individually. A consumer that renews Snapdeal must not
 * pay for Myntra's Selenium stack, and on a machine missing one platform's
 * driver the others still work.
 */
const { platformKey } = require("./platforms.js");

const LOGINS = {
    // AJIO's own login takes an already-open page rather than credentials, so
    // it gets a wrapper that owns a browser — see that file for why.
    ajio: () => require("../platforms/ajio/common/renewSession.js").loginAjioApi,
    myntra: () => require("../platforms/myntra/claim-management/api-based-flow/claimApiFlow.js").loginMyntraApi,
    snapdeal: () => require("../platforms/snapdeal/claim-management/api-based-flow/claimApiFlow.js").loginSnapdealApi,
    meesho: () => require("../platforms/meesho/claim-management/api-based-flow/claimApiFlow.js").loginMeeshoApi,
    flipkart: () => require("../platforms/flipkart/claim-management/api-based-flow/claimApiFlow.js").loginFlipkartApi,
    // Like AJIO's, a wrapper that owns a browser: the Tata CliQ login takes an
    // already-open page because every call after it runs in one.
    tatacliq: () => require("../platforms/tatacliq/common/renewSession.js").loginTataCliqApi,
    nykaa: () => require("../platforms/nykaa/claim-management/api-based-flow/claimApiFlow.js").loginNykaaApi,
    delhivery: () => require("../platforms/delhivery/claim-management/api-based-flow/claimApiFlow.js").loginDelhiveryApi,
    xbees: () => require("../platforms/xbees/claim-management/api-based-flow/claimApiFlow.js").loginXbeesApi,
};

/** Per-platform options the proven handlers pass. Flipkart retries its login. */
const LOGIN_OPTIONS = {
    flipkart: { maxAttempts: 2 },
};

/** Platforms whose session is OAuth tokens rather than a cookie jar. */
const TOKEN_PLATFORMS = new Set(["delhivery", "xbees"]);

const normalise = (platform, result) => {
    if (!result) return { jar: {}, tokens: null, extra: null };

    // Myntra hands back the cookie map itself; everything else wraps it.
    if (TOKEN_PLATFORMS.has(platform)) {
        return {
            jar: result.jar || {},
            tokens: {
                accessToken: result.accessToken || null,
                refreshToken: result.refreshToken || null,
                realm: result.realm || null,
            },
            extra: null,
        };
    }
    if (result.jar) {
        return {
            // AJIO answers with an ARRAY of whole cookies (its ingest wants
            // them that way); the rest answer with a name→value map. Passed
            // through as-is — shaping is the caller's job, and the platform
            // registry's jarFormat says which each endpoint wants.
            jar: result.jar,
            tokens: null,
            // EVERY non-cookie field the login discovered, because dropping one
            // does not fail — it produces a session that looks captured and is
            // unusable, and the next run signs in again to rediscover the same
            // value. Meesho's supplierId was missing from this list: its login
            // fetched it, this threw it away, and every Meesho claim opened a
            // second browser purely to fetch it again.
            //
            // Anything a platform's ingest or claim context requires belongs
            // here. See common/claimContext.js for what each one needs.
            extra: {
                ...(result.sellerId ? { sellerId: result.sellerId } : {}),
                ...(result.csrfToken ? { csrfToken: result.csrfToken } : {}),
                // AJIO: read from the signed-in page and required by its ingest.
                ...(result.userId ? { userId: result.userId } : {}),
                ...(result.pobIds ? { pobIds: result.pobIds } : {}),
                ...(result.stores ? { stores: result.stores } : {}),
                // Meesho: from the supplier boot config. Required by the claim
                // context AND by the master import's report request.
                ...(result.supplierId ? { supplierId: result.supplierId } : {}),
                ...(result.supplierIdentifier
                    ? { supplierIdentifier: result.supplierIdentifier }
                    : {}),
                // Nykaa: every portal API URL is built from it, and the claim
                // context refuses a record without it — same bug, same cost.
                ...(result.portalId ? { portalId: result.portalId } : {}),
                // Tata CliQ: a return is visible only to the slave that owns
                // it, and the pick is server-side session state — so a session
                // stored without this list is one that searches nothing.
                ...(result.slaves ? { slaves: result.slaves } : {}),
            },
        };
    }
    return { jar: result, tokens: null, extra: null };
};

/** Is a scripted renewal available for this platform at all? */
function canRenew(platform) {
    return Boolean(LOGINS[platformKey(platform)]);
}

/** Platforms this module can renew. */
function renewablePlatforms() {
    return Object.keys(LOGINS);
}

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
async function renewPlatformSession(platform, credentials, options = {}) {
    const key = platformKey(platform);
    const load = LOGINS[key];

    if (!load) {
        const err = new Error(`No session renewal is defined for platform "${platform}"`);
        err.code = "PLATFORM_NOT_RENEWABLE";
        throw err;
    }
    if (!credentials || !credentials.username) {
        const err = new Error("credentials.username is required to renew a session");
        err.code = "VALIDATION_ERROR";
        throw err;
    }

    const login = load();
    const started = Date.now();
    const result = await login(credentials, {
        forceFresh: true,
        ...(LOGIN_OPTIONS[key] || {}),
        ...options,
    });

    const { jar, tokens, extra } = normalise(key, result);

    return {
        platform: key,
        username: credentials.username,
        jar,
        tokens,
        extra,
        // AJIO's jar is an ARRAY of whole cookies; Object.keys on it gave
        // "0", "1", "2"… instead of names, which is no help to anyone reading
        // a failed capture.
        cookieNames: Array.isArray(jar)
            ? jar.map((cookie) => cookie && cookie.name).filter(Boolean)
            : Object.keys(jar || {}),
        durationMs: Date.now() - started,
    };
}

module.exports = {
    renewPlatformSession,
    canRenew,
    renewablePlatforms,
    LOGINS,
    TOKEN_PLATFORMS,
    // Exported for tests: dropping a field here is silent, and the cost is a
    // second sign-in per claim.
    normalise,
};
