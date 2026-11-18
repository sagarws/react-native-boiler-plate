// Flipkart — the non-cookie half of a captured session.
//
// Flipkart's ingest endpoint rejects a jar without `csrfToken`. The token is
// DOUBLE-SUBMIT: the value sent in the fk-csrf-token header must equal the one
// in a cookie, and the server answers 403 EBADCSRFTOKEN the moment they
// disagree. So discovery is really "which cookie holds it" — and it is already
// in the jar the capture harvested, no page access needed.
//
// Heuristics and denylist lifted from discoverCsrfToken in
// ../claim-management/api-based-flow/claimApiFlow.js, which is the authority.
// The denylist is not defensive padding: an earlier version of that function
// allowed hyphens in the tail, a MoEngage analytics UUID (`moe_uuid`, also 36
// chars) matched the shape, and every API call those accounts made 403'd — with
// the session looking perfectly healthy the whole time.
//
// See common/sessionExtras.js for the contract.

// Verified across 5 accounts on 2 companies: obfuscated, but stable.
const CSRF_COOKIE_NAME = "XyZ7pQ9rS2T1uV8wA3bC6dE4fG0h";

// Two segments, exactly ONE hyphen, e.g. JzRq1dXU-xfSW3HQfPsbi6C8geegObhMgcgQ.
// The tail excludes hyphens deliberately — allowing them is what let a UUID match.
const CSRF_PATTERN = /^[A-Za-z0-9_]{6,12}-[A-Za-z0-9_]{20,32}$/;

const CSRF_COOKIE_DENYLIST = [
    /^moe_uuid$/i, /^_ga/i, /^_gid$/i, /^_gcl_au$/i, /^_fbp$/i,
    /^mp_/i, /^AMCVS?_/i, /^s_nr$/i, /^experiment$/i, /^DID$/i,
];

const isDenied = (name) => CSRF_COOKIE_DENYLIST.some((re) => re.test(name));

/**
 * @param {Array<{name: string, value: string}>} jar
 * @returns {{ csrfToken?: string, error?: string }}
 */
function fromJar(jar) {
    const cookies = Array.isArray(jar) ? jar : [];
    const byName = new Map(cookies.map((c) => [c.name, c.value]));

    // 1. The known cookie, by name. The answer in every observed case.
    if (byName.get(CSRF_COOKIE_NAME)) {
        return { csrfToken: byName.get(CSRF_COOKIE_NAME) };
    }

    // 2. A cookie whose NAME mentions csrf, in case Flipkart renames it to
    //    something self-describing.
    for (const [name, value] of byName) {
        if (/csrf/i.test(name) && value && !isDenied(name)) return { csrfToken: value };
    }

    // 3. Shape match, analytics excluded. Last resort: if this fires the cookie
    //    name has changed, so it reports that rather than passing silently.
    for (const [name, value] of byName) {
        if (isDenied(name)) continue;
        if (CSRF_PATTERN.test(String(value || ""))) {
            return {
                csrfToken: value,
                warning: `csrf token matched by SHAPE from cookie "${name}" — "${CSRF_COOKIE_NAME}" was absent`,
            };
        }
    }

    return {
        error:
            "no fk-csrf-token cookie found in the captured jar — Flipkart signs every API " +
            "call with it, so the session would 403 on its first request",
    };
}

module.exports = {
    platform: "flipkart",
    required: ["csrfToken"],
    fromJar,
    CSRF_COOKIE_NAME,
    CSRF_PATTERN,
};
