/**
 * Rebuilding a platform's login context from a session that is already stored.
 *
 * Only `loginSnapdealApi` takes a `session` option. The other six ignore the
 * second argument entirely, so a caller handing them a perfectly good jar got a
 * full browser sign-in anyway — the desktop app opened Chrome for every claim
 * while the session sat unused in the company document.
 *
 * What a login returns is not just a jar. Meesho needs supplier ids discovered
 * during sign-in, Flipkart a csrf token, Nykaa a portal id, Delhivery and Xbees
 * OAuth tokens. Every one of those is ALREADY on the stored record — the ingest
 * endpoints require them — so the context can be rebuilt without signing in.
 *
 * This is the same move the Meesho master import makes inline; here it is once,
 * for every platform, as a map rather than seven copies.
 *
 * INCOMPLETE MEANS NULL. A context missing a field the API calls need is worse
 * than no context: it fails several calls later, somewhere that reads like a
 * different bug. A null sends the caller to a real login, which always works.
 */

const nonEmpty = (value) =>
    typeof value === "string" ? value.trim() !== "" : value !== undefined && value !== null;

const hasJar = (record) => {
    const jar = record?.jar;

    if (!jar) return false;

    return Array.isArray(jar) ? jar.length > 0 : Object.keys(jar).length > 0;
};

/**
 * Per platform: the fields the login's return value carries beyond the jar, and
 * how to shape them. `required` is what the API calls cannot work without.
 */
const { platformKey } = require("./platforms.js");

const CONTEXTS = {
    /**
     * AJIO can never be rebuilt from a record alone.
     *
     * Its calls go through a logged-in browser PAGE — Akamai wants the
     * browser's own HttpOnly `bff_session` and real TLS fingerprint — so the
     * reuse decision belongs to `platforms/ajio/common/sessionStore`'s
     * `reuseSessionRecord`, which hydrates the jar into a page and probes it
     * there. Declared here rather than left out so the caller's log says WHY
     * instead of "unknown platform", which reads like a missing case.
     */
    ajio: {
        required: [],
        build: () => null,
        // Not "this session is unusable" — "this session cannot be judged from
        // here". See `isPageProbed`.
        pageProbed: true,
    },
    // Returns a bare jar, not a context — Myntra's API helpers take the jar
    // itself (`apiHeaders(jar)`).
    myntra: {
        required: [],
        build: (record) => record.jar,
    },
    // NOT a bare jar, although it looks like Myntra's. Snapdeal's calls read
    // `ctx.jar` (`apiHeaders(ctx)`), and both of its logins — fresh and
    // `getUsableSession` — return `{ jar, sellerId }`. Handing back the jar
    // itself made `ctx.jar` undefined, so every call from a reused session went
    // out with an EMPTY cookie header: the probe (which reads `record.jar`)
    // passed, and then globalSearch answered HTTP 800 for every AWB.
    snapdeal: {
        required: [],
        build: (record) => ({ jar: record.jar, sellerId: record.sellerId ?? null }),
    },
    // The jar is enough. It used to demand `supplierId`, and a session that
    // lacked one — which was every session, because the capture read it from a
    // response that never carried it — was declared incomplete and replaced by
    // a browser sign-in that stored null again.
    //
    // The ids are still needed on every call; they are now READ when missing
    // (claimApiFlow's ensureSupplierIdentity, one HTTP call), so cookies that
    // work are used instead of thrown away.
    meesho: {
        required: [],
        build: (record) => ({
            jar: record.jar,
            supplierId: record.supplierId,
            supplierIdentifier: record.supplierIdentifier ?? null,
        }),
    },
    /**
     * Tata CliQ can never be rebuilt from a record alone — the same as AJIO,
     * and for the same two reasons. Its calls go through a logged-in browser
     * PAGE (Cloudflare wants a real browser; the slave pick is server-side
     * session state), so the reuse decision belongs to
     * `platforms/tatacliq/common/sessionStore`'s `reuseSessionRecord`, which
     * hydrates the jar into a page and probes it there. Declared rather than
     * left out so a caller's log says WHY instead of "unknown platform".
     */
    tatacliq: {
        required: [],
        build: () => null,
        pageProbed: true,
    },
    flipkart: {
        required: ["csrfToken"],
        build: (record) => ({
            jar: record.jar,
            csrfToken: record.csrfToken,
            sellerId: record.sellerId ?? null,
        }),
    },
    nykaa: {
        required: ["portalId"],
        build: (record) => ({
            jar: record.jar,
            portalId: record.portalId,
            userId: record.userId ?? null,
        }),
    },
    // Token platforms: no cookie jar at all, so `hasJar` is not the test —
    // the access token is.
    delhivery: {
        required: ["accessToken"],
        jarless: true,
        build: (record) => ({
            accessToken: record.accessToken,
            accessExpiresAt: record.accessExpiresAt ?? null,
            refreshToken: record.refreshToken ?? null,
            tokenType: record.tokenType || "Bearer",
            idToken: record.idToken ?? null,
            realm: record.realm ?? null,
            tenantId: record.tenantId ?? null,
            hqClientId: record.hqClientId ?? null,
            clientId: record.clientId ?? null,
        }),
    },
    xbees: {
        required: ["accessToken"],
        jarless: true,
        build: (record) => ({
            accessToken: record.accessToken,
            accessExpiresAt: record.accessExpiresAt ?? null,
            refreshToken: record.refreshToken ?? null,
            tokenType: record.tokenType || "Bearer",
            idToken: record.idToken ?? null,
            realm: record.realm ?? null,
            clientId: record.clientId ?? null,
        }),
    },
};

/**
 * The context a claim runner can use instead of signing in, or null.
 *
 * @param {string} platform  platform key, any casing
 * @param {object} record    the stored session, as the ingest wrote it
 * @returns {*|null} whatever that platform's login would have returned
 */
function claimContextFromSession(platform, record) {
    const spec = CONTEXTS[platformKey(platform)];

    if (!spec || !record) return null;
    if (!spec.jarless && !hasJar(record)) return null;
    if (!spec.required.every((field) => nonEmpty(record[field]))) return null;

    return spec.build(record);
}

/** Which fields a stored session is missing before it could replace a login. */
function missingContextFields(platform, record) {
    const key = platformKey(platform);
    const spec = CONTEXTS[key];

    if (!spec) return ["unknown platform"];

    // AJIO's and Tata CliQ's builds always decline — their sessions can only be
    // judged inside a page — so say that rather than listing fields that are
    // all present.
    if (key === "ajio") return ["nothing — AJIO is probed inside the browser page instead"];
    if (key === "tatacliq") {
        return ["nothing — Tata CliQ is probed inside the browser page instead"];
    }

    const missing = spec.required.filter((field) => !nonEmpty(record?.[field]));

    if (!spec.jarless && !hasJar(record)) missing.unshift("jar");

    return missing;
}

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
function isPageProbed(platform) {
    return CONTEXTS[platformKey(platform)]?.pageProbed === true;
}

module.exports = { claimContextFromSession, missingContextFields, isPageProbed, CONTEXTS };
