// -----------------------------------------------------------------------------
// Tata CliQ session cache — persist the post-login cookie jar per credential
// -----------------------------------------------------------------------------
// Mirrors platforms/ajio/common/sessionStore.js, not Flipkart's or Myntra's,
// and the reason is the same one that shapes the whole platform: every Tata
// CliQ call runs INSIDE a logged-in page. sellerzone.tatacliq.com is behind
// Cloudflare, and the slave pick is server-side session state — so a jar is
// only useful if it can be rehydrated into a real browser.
//
// Stored on the credential itself, beside `ajioSession` / `flipkartSession`:
//
//   companies.settings.eCommercePlatformLoginInfo[<tatacliq>].info[<cred>].tatacliqSession = {
//       jar:       [{ name, value, domain, path, ... puppeteer cookie shape }],
//       slaves:    [{ id, name, code }],   // the slave list, so reuse skips the sweep
//       savedAt:   "2026-09-17T08:03:40.001Z",
//       expiresAt: "2026-09-18T07:03:40.001Z",
//       ip:        null,
//       source:    "claim" | "renew-endpoint" | "cms-desktop",
//   }
//
// FULL COOKIE RECORDS, not a {name:value} bag. Cloudflare's own cookies
// (`cf_clearance`, `__cf_bm`) are HttpOnly, domain-scoped and short-lived; a
// name and value alone lands on the wrong scope and the first request fails the
// challenge. Same reasoning as AJIO's Akamai cookies — see cookieHarvest, which
// is where the CDP read lives so a second platform did not need a second copy.
//
// WHY REUSE MATTERS MORE HERE THAN ANYWHERE ELSE. Signing in costs an emailed
// OTP. Every other platform's fresh login is slow; this one's needs a code out
// of a mailbox, which is the difference between a run that recovers on its own
// and a run that waits for a person. A session worth reusing must be reused.
//
// Disable reuse with TATACLIQ_SESSION_CACHE=false. The lifetime is not
// env-tunable — see TATACLIQ_SESSION_EXPIRY_HOURS in common/constants.js.
// -----------------------------------------------------------------------------

const { TATACLIQ_SESSION_EXPIRY_HOURS } = require("../../../common/constants");
const { companiesCollection, makeBuildMatchers } = require("../../../common/sessionHelpers");
const { isSessionPersistenceEnabled } = require("../../../common/sessionPersistence.js");
const { harvestAllCookies, hydrateCookies } = require("../../../common/cookieHarvest");
const { ORIGIN, parseSlaveList } = require("./slaveSync");

const SESSION_FIELD = "tatacliqSession";
const PLATFORM_REGEX = { $regex: "^tatacliq$", $options: "i" };
const buildMatchers = makeBuildMatchers(PLATFORM_REGEX);

/** The hosts whose cookies make up a Tata CliQ session. */
const COOKIE_DOMAINS = ["sellerzone.tatacliq.com", ".tatacliq.com"];

/** A jar with nothing in it is not a session. */
const MIN_COOKIES = 1;

function isSessionCacheEnabled() {
    // A process with no database access can never persist, and no environment
    // variable may override that. See common/sessionPersistence.js.
    if (!isSessionPersistenceEnabled()) return false;

    return process.env.TATACLIQ_SESSION_CACHE !== "false";
}

function isUsableRecord(record) {
    return !!(record && Array.isArray(record.jar) && record.jar.length >= MIN_COOKIES);
}

function computeExpiry() {
    return new Date(Date.now() + TATACLIQ_SESSION_EXPIRY_HOURS * 60 * 60 * 1000);
}

// ---------------------------
// 🍪 Harvest / hydrate
// ---------------------------

/**
 * Every Tata CliQ cookie the browser holds, in Puppeteer's own shape.
 *
 * Read through CDP (see cookieHarvest) rather than `page.cookies()`, so the
 * HttpOnly Cloudflare cookies come too. Kept as full records, which is what
 * `hydrateCookies` needs to put a Cloudflare cookie back.
 */
async function harvestCookies(page, { logger = console } = {}) {
    const all = await harvestAllCookies(page, { logger });

    return (all || []).filter(
        (cookie) =>
            cookie &&
            cookie.name &&
            COOKIE_DOMAINS.some((domain) =>
                String(cookie.domain || "").toLowerCase().includes(domain.replace(/^\./, ""))
            )
    );
}

/**
 * Put a stored jar back into a browser.
 *
 * THE SHARED ONE, not a loop over `page.setCookie`. This file had that loop,
 * and it dropped `cf_clearance` on every single reuse:
 *
 *     cookie "cf_clearance" rejected: Protocol error (Network.deleteCookies):
 *     Failed to deserialize params.partitionKey.topLevelSite
 *
 * Newer Chrome returns `partitionKey` as an object and handing it straight back
 * fails to deserialise. Of all the cookies to lose, that is the worst one: it
 * is Cloudflare's clearance token, so the session came back looking alive with
 * the one cookie missing that stops the next request being a challenge page.
 * The shared helper copies fields in deliberately instead, and carries AJIO's
 * other two hard-won rules with it (`expires: -1`, a malformed `sameSite`).
 *
 * @returns {Promise<number>} how many cookies landed. Zero means the jar could
 *          not be restored at all, which the caller treats as no session.
 */
function hydrateTataCliqCookies(page, jar) {
    return hydrateCookies(page, jar, { label: "tatacliq/sessionStore" });
}

// ---------------------------
// 💾 Save / load / clear
// ---------------------------

/**
 * Store the session this page is signed in with. Never throws — a cache write
 * that fails must not fail the login that just succeeded, least of all one that
 * spent an OTP.
 */
async function saveSession({ credentialId, username, jar, slaves = [], ip = null, source = "claim" }) {
    if (!isSessionCacheEnabled()) return false;

    if (!isUsableRecord({ jar })) {
        console.warn(
            `⚠️ [tatacliq/sessionStore] Refusing to cache an empty jar for ${username}`
        );

        return false;
    }

    const matcher = buildMatchers({ credentialId, username });

    if (!matcher) return false;

    const expiresAt = computeExpiry();
    const record = {
        jar,
        // Carried with the session so a reused one does not re-sweep the slave
        // list. It is the same answer, and the sweep is a call per query.
        slaves,
        savedAt: new Date().toISOString(),
        expiresAt: expiresAt.toISOString(),
        ip,
        source,
    };

    try {
        const col = await companiesCollection();
        const res = await col.updateMany(
            matcher.query,
            { $set: { [`settings.eCommercePlatformLoginInfo.$[p].info.$[c].${SESSION_FIELD}`]: record } },
            { arrayFilters: matcher.arrayFilters }
        );

        if (res.modifiedCount > 0) {
            const hrs = ((expiresAt.getTime() - Date.now()) / 3600000).toFixed(1);

            console.log(
                `💾 [tatacliq/sessionStore] Cached session for ${username} ` +
                `(${jar.length} cookies, ${slaves.length} slaves, valid ~${hrs}h)`
            );

            return true;
        }

        console.warn(`⚠️ [tatacliq/sessionStore] No credential matched ${matcher.label} — session not cached`);

        return false;
    } catch (err) {
        console.warn(`⚠️ [tatacliq/sessionStore] Save failed for ${username}: ${err.message}`);

        return false;
    }
}

async function loadSession({ credentialId, username }) {
    // Nothing was ever written from this process, so there is nothing to read.
    // Keeps the desktop app from opening a database connection it must not have.
    if (!isSessionPersistenceEnabled()) return null;
    if (!isSessionCacheEnabled()) return null;

    const matcher = buildMatchers({ credentialId, username });

    if (!matcher) return null;

    try {
        const col = await companiesCollection();
        const doc = await col.findOne(matcher.query, {
            projection: { "settings.eCommercePlatformLoginInfo": 1 },
        });

        const platforms = doc?.settings?.eCommercePlatformLoginInfo || [];
        const tatacliq = platforms.find(
            (entry) => (entry?.eComPlatform || "").toLowerCase().trim() === "tatacliq"
        );
        const cred = (Array.isArray(tatacliq?.info) ? tatacliq.info : []).find(matcher.matches);
        const record = cred?.[SESSION_FIELD];

        if (!isUsableRecord(record)) return null;

        if (record.expiresAt && new Date(record.expiresAt).getTime() <= Date.now()) {
            console.log(
                `⏰ [tatacliq/sessionStore] Cached session for ${username} expired at ${record.expiresAt}`
            );

            return null;
        }

        return record;
    } catch (err) {
        console.warn(`⚠️ [tatacliq/sessionStore] Load failed for ${username}: ${err.message}`);

        return null;
    }
}

async function clearSession({ credentialId, username }, reason = "") {
    if (!isSessionPersistenceEnabled()) return false;

    const matcher = buildMatchers({ credentialId, username });

    if (!matcher) return false;

    try {
        const col = await companiesCollection();

        await col.updateMany(
            matcher.query,
            { $unset: { [`settings.eCommercePlatformLoginInfo.$[p].info.$[c].${SESSION_FIELD}`]: "" } },
            { arrayFilters: matcher.arrayFilters }
        );
        console.log(
            `🗑️ [tatacliq/sessionStore] Cleared cached session for ${username}${reason ? ` (${reason})` : ""}`
        );

        return true;
    } catch (err) {
        console.warn(`⚠️ [tatacliq/sessionStore] Clear failed for ${username}: ${err.message}`);

        return false;
    }
}

// ---------------------------
// 🩺 Probe
// ---------------------------

/**
 * Is this page actually signed in?
 *
 * The slave list is the probe. It is the cheapest authenticated call the portal
 * has, it is the first thing a claim needs anyway, and — the part that makes it
 * a real probe — a signed-OUT session cannot answer it: there is no slave list
 * without a seller, so the response carries no `<li id="…">` at all.
 *
 * IN-PAGE, like every Tata CliQ call. This platform is deliberately absent from
 * common/probeSession.js's jar-only registry for the same reason AJIO is: a
 * caller holding only a jar cannot run this, and answering "cannot tell" is
 * better than answering wrongly.
 *
 * @returns {Promise<{ alive: boolean, slaves: Array }>} the slaves come back
 *          because the probe already has them — throwing them away would mean
 *          a second identical call a moment later.
 */
async function probeSessionInPage(page) {
    try {
        const html = await page.evaluate(async (target) => {
            const res = await fetch(target, {
                credentials: "include",
                headers: { Accept: "text/html", "X-Requested-With": "XMLHttpRequest" },
            });

            return res.ok ? res.text() : "";
        }, `${ORIGIN}/faces/jsp/userResponse.jsp?flag=SlavesUnderSeller&Value=`);

        const slaves = parseSlaveList(html);

        if (slaves.length === 0) {
            console.log("🩺 [tatacliq/sessionStore] Probe got no slaves — the session is not signed in");

            return { alive: false, slaves: [] };
        }

        return { alive: true, slaves };
    } catch (err) {
        console.log(`🩺 [tatacliq/sessionStore] Probe failed (${err.message}) — treating the session as dead`);

        return { alive: false, slaves: [] };
    }
}

/**
 * Hydrate a stored session into this page and prove it.
 *
 * @returns {Promise<{ jar: Array, slaves: Array }|null>} null when there is
 *          nothing usable, in which case the caller signs in — which costs an
 *          OTP, so this is worth the two calls it spends trying.
 */
async function reuseSessionRecord(page, record, { username } = {}) {
    if (!isUsableRecord(record)) return null;

    const restored = await hydrateTataCliqCookies(page, record.jar);

    if (restored === 0) {
        console.log(
            `↩️ [tatacliq/sessionStore] Could not hydrate any cookie for ${username} — signing in fresh`
        );

        return null;
    }

    // The portal has to be loaded with the cookies in place before it will
    // answer anything: the JSP session is resolved server-side per request, and
    // the probe below is a request.
    try {
        await page.goto(`${ORIGIN}/faces/oms/EarlyRefundQC.jsp`, {
            waitUntil: "networkidle2",
            timeout: 60000,
        });
    } catch (err) {
        console.log(`↩️ [tatacliq/sessionStore] Could not open the portal with the stored session: ${err.message}`);

        return null;
    }

    const probe = await probeSessionInPage(page);

    if (!probe.alive) {
        // Deliberately NOT cleared. A probe is evidence, not proof, and deleting
        // a session on one failed probe is how a session captured minutes ago
        // disappears and costs an OTP. The fresh login overwrites it anyway.
        console.log(
            `↩️ [tatacliq/sessionStore] Stored session for ${username} did not answer the slave list — ` +
            "signing in fresh (stored session left in place)"
        );

        return null;
    }

    const leftMin = record.expiresAt
        ? Math.round((new Date(record.expiresAt).getTime() - Date.now()) / 60000)
        : null;

    console.log(
        `♻️ [tatacliq/sessionStore] Reusing the stored Tata CliQ session for ${username} — ` +
        `no sign-in, no OTP${leftMin !== null ? ` (~${leftMin}m left)` : ""}`
    );

    // The probe's own slave list wins over the stored one: it is current, and a
    // slave added since the session was saved would otherwise be invisible.
    return { jar: record.jar, slaves: probe.slaves.length ? probe.slaves : record.slaves || [] };
}

/** Load, hydrate and prove in one call. Null means "sign in". */
async function tryReuseSession(page, { credentialId, username }) {
    const record = await loadSession({ credentialId, username });

    if (!record) return null;

    return reuseSessionRecord(page, record, { username });
}

module.exports = {
    SESSION_FIELD,
    COOKIE_DOMAINS,
    isSessionCacheEnabled,
    harvestCookies,
    hydrateCookies: hydrateTataCliqCookies,
    saveSession,
    loadSession,
    clearSession,
    probeSessionInPage,
    reuseSessionRecord,
    tryReuseSession,
};
