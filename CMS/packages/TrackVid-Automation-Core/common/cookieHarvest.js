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
async function harvestAllCookies(page, { logger = console } = {}) {
    try {
        const client = await page.createCDPSession();
        const { cookies } = await client.send("Network.getAllCookies");

        // Best-effort: leaving a session attached to a page that is about to be
        // closed is harmless, but detaching is tidier and cannot fail the read.
        await client.detach().catch(() => {});

        if (Array.isArray(cookies)) return cookies;
    } catch (err) {
        logger.warn?.(`⚠️ [cookieHarvest] CDP harvest failed (${err.message}) — falling back to page.cookies()`);
    }

    try {
        return await page.cookies();
    } catch (_) {
        return [];
    }
}

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
function toJar(cookies, { domains = null, preferDomains = [] } = {}) {
    const matches = (cookie, needles) =>
        needles.some((needle) => String(cookie.domain || "").toLowerCase().includes(needle.toLowerCase()));

    const kept = (cookies || []).filter(
        (cookie) => cookie && cookie.name && (!domains || matches(cookie, domains))
    );

    const jar = {};

    for (const cookie of kept) {
        if (matches(cookie, preferDomains)) continue;
        jar[cookie.name] = cookie.value;
    }

    for (const cookie of kept) {
        if (!matches(cookie, preferDomains)) continue;
        jar[cookie.name] = cookie.value;
    }

    return jar;
}

/**
 * `sameSite` from `getAllCookies` is "Strict" | "Lax" | "None" — or absent.
 * Anything else makes `setCookies` reject the WHOLE batch.
 */
const VALID_SAME_SITE = new Set(["Strict", "Lax", "None"]);

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
async function hydrateCookies(page, jar, { label = "cookieHarvest", logger = console } = {}) {
    if (!Array.isArray(jar) || jar.length === 0) return 0;

    const params = jar
        .filter((cookie) => cookie && cookie.name && cookie.value != null)
        .map((cookie) => {
            const out = {
                name: cookie.name,
                value: String(cookie.value),
                domain: cookie.domain,
                path: cookie.path || "/",
                secure: !!cookie.secure,
                httpOnly: !!cookie.httpOnly,
            };

            if (typeof cookie.sameSite === "string" && VALID_SAME_SITE.has(cookie.sameSite)) {
                out.sameSite = cookie.sameSite;
            }

            if (typeof cookie.expires === "number" && cookie.expires > 0) {
                out.expires = cookie.expires;
            }

            return out;
        });

    try {
        const client = await page.createCDPSession();

        await client.send("Network.setCookies", { cookies: params });
        await client.detach().catch(() => {});

        return params.length;
    } catch (err) {
        logger.warn?.(
            `⚠️ [${label}] cookie hydrate via CDP failed (${err.message}) — falling back to page.setCookie()`
        );

        let restored = 0;

        for (const cookie of params) {
            try {
                // The SANITISED record, not the stored one: the fallback used to
                // pass the raw cookie and so reproduced the very failures the
                // whitelist above exists to prevent.
                await page.setCookie(cookie);
                restored++;
            } catch (cookieErr) {
                // One rejected cookie is not a failed hydrate — the probe that
                // follows decides whether what landed is enough.
                logger.log?.(`    ↩️ [${label}] cookie "${cookie.name}" rejected: ${cookieErr.message}`);
            }
        }

        return restored;
    }
}

module.exports = { harvestAllCookies, toJar, hydrateCookies };
