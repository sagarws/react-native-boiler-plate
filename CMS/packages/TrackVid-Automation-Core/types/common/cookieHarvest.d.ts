/**
 * Read every cookie a logged-in browser holds, not just the ones for the page
 * it happens to be showing.
 *
 * WHY THIS IS NOT `page.cookies()`. That returns cookies for the page's current
 * URL, or for URLs you name. Naming them means guessing, and a portal that
 * federates its login across hosts sets the cookies that matter on hosts the
 * final page never mentions — Nykaa's Desk portal is served from
 * dispute.nykaa.com but its session and CSRF cookies come from Zoho. Miss one
 * host and the jar looks healthy: every GET succeeds, because reads are not
 * guarded, and the first write comes back 401 as though the session were dead.
 *
 * CDP's `Network.getAllCookies` returns the whole store — every domain, HttpOnly
 * included — so there is nothing left to guess at. AJIO's session store already
 * does this for the same reason; this is that approach with the domain filter
 * made explicit, so a second platform did not need a second copy.
 */
/**
 * Every cookie in the browser profile.
 *
 * Falls back to `page.cookies()` if CDP is unavailable — a narrower answer is
 * better than none, and the caller logs which it got.
 *
 * @param {object} page a Puppeteer page
 * @returns {Promise<Array<{name: string, value: string, domain: string}>>}
 */
export function harvestAllCookies(page: object, { logger }?: {
    logger?: Console;
}): Promise<Array<{
    name: string;
    value: string;
    domain: string;
}>>;
/**
 * Flatten cookies into the `{ name: value }` jar the HTTP flows send.
 *
 * ORDERING MATTERS, because a flat jar has one slot per name and several hosts
 * can use the same name. Cookies whose domain matches `preferDomains` are
 * applied LAST, so the origin actually being called wins a collision rather
 * than whichever host happened to come back first.
 *
 * @param {Array} cookies from `harvestAllCookies`
 * @param {object} [options]
 * @param {string[]} [options.domains]        keep only these domain substrings; omit to keep all
 * @param {string[]} [options.preferDomains]  applied last, so they win name collisions
 */
export function toJar(cookies: any[], { domains, preferDomains }?: {
    domains?: string[];
    preferDomains?: string[];
}): {};
/**
 * Put a stored jar of whole cookie records back into a browser.
 *
 * FOR THE PLATFORMS WHOSE JAR IS RECORDS, not a `{name: value}` bag — AJIO
 * (Akamai) and Tata CliQ (Cloudflare), whose gatekeeper cookies are HttpOnly
 * and domain-scoped, so only the full record rehydrates them.
 *
 * IT IS A WHITELIST, NOT A PASSTHROUGH, and every line of it is a bug that has
 * already happened once:
 *
 *   1. `expires: -1` from getAllCookies means "session cookie". Handed back,
 *      Chrome reads it as a Unix timestamp in Dec 1969 and drops the cookie as
 *      expired the instant it is set. AJIO's `bff_session` IS a session cookie,
 *      so every reuse silently lost the one that mattered, hit the API
 *      unauthenticated, and signed in again.
 *   2. `sameSite: ""` or an unknown value makes the call throw for the entire
 *      batch — one malformed record and the jar lands empty.
 *   3. `partitionKey` comes back from newer Chrome as an OBJECT, and handing it
 *      back fails to deserialise: "Failed to deserialize
 *      params.partitionKey.topLevelSite". That is what rejected Tata CliQ's
 *      `cf_clearance` — Cloudflare's clearance token, the one cookie whose
 *      absence turns the next request into a challenge page.
 *
 * So fields are copied in deliberately and everything else is left behind: a
 * cookie store gains fields between Chrome versions, and a passthrough breaks
 * again each time one arrives.
 *
 * CDP rather than `page.setCookie`, in one batch, because HttpOnly cookies
 * cannot be set any other way.
 *
 * @param {object} page a Puppeteer page
 * @param {Array} jar whole cookie records, as `harvestAllCookies` returns them
 * @param {object} [options]
 * @param {string} [options.label] what to call this platform in a warning
 * @returns {Promise<number>} how many cookies were set
 */
export function hydrateCookies(page: object, jar: any[], { label, logger }?: {
    label?: string;
}): Promise<number>;
