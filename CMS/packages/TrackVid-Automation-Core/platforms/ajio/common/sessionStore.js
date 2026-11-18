// -----------------------------------------------------------------------------
// AJIO session cache — persist the post-login cookie jar per credential
// -----------------------------------------------------------------------------
// Mirrors flipkartAutoMation/sessionStore.js and myntraAutoMation/sessionStore.js.
// The master-data runner (masterDataImport/script.js) launches Puppeteer, walks
// through the Reliance-Retail OAuth SSO ceremony to reach seller.ajio.com, and
// then calls the report-download API from inside that page. The SSO part is the
// expensive piece (~30-60s + the Akamai/bot failure surface); every step after
// it is just an in-page fetch. A session worth reusing should be reused.
//
// Stored on the credential itself, beside `masterDataSync` / `flipkartSession`:
//
//   companies.settings.eCommercePlatformLoginInfo[<ajio>].info[<cred>].ajioSession = {
//       jar:        [{ name, value, domain, path, ... puppeteer cookie shape }, ...],
//       userId:     "6a2f0a3e-…-b8c1",       // activeSellerProfileId from localStorage
//       pobIds:     ["DV00349597", ...],     // work-places API result (skip on reuse)
//       stores:     [{ id, storeName }, ...],
//       savedAt:    "2026-08-20T10:03:40.001Z",
//       expiresAt:  "2026-08-27T08:03:40.001Z",
//       ip:         null,
//       source:     "master-data" | "renew-endpoint" | "chrome-extension",
//   }
//
// Why the jar shape is full cookie records (name+domain+path+expiry) instead of
// Flipkart/Myntra's flat {name:value} bag: AJIO's session is enforced by Akamai
// (`_abck`, `bm_sv`, `bm_sz`). Those cookies are HttpOnly, domain-scoped and
// short-lived. To rehydrate them back into Puppeteer via `page.setCookie(...)`
// we need the full shape — a name/value alone would land on the wrong scope and
// the very first request would fail the Akamai check.
//
// Reuse is conservative: present → not past expiresAt → passes a live probe
// (in-page work-places API call). Any doubt falls through to the normal SSO
// login, which overwrites the record.
//
// GATE: session reuse is OFF by default. Set AJIO_SESSION_SAVE=true to save
// sessions after a fresh login, and to attempt reuse on the next run. This
// mirrors how the user wants the rollout to be reversible without a code push.
// AJIO_SESSION_CACHE=false is a hard kill-switch that overrides everything.
//
// Lifetime is not env-tunable — see AJIO_SESSION_EXPIRY_HOURS in
// common/constants.js (kept in step with TrackVid-BE/src/constants/common.ts).
// -----------------------------------------------------------------------------

const { connectDB } = require("../../../common/db");
const { AJIO_SESSION_EXPIRY_HOURS } = require("../../../common/constants");

const SESSION_FIELD = "ajioSession";
const PLATFORM_REGEX = { $regex: "^ajio$", $options: "i" };

const { companiesCollection, makeBuildMatchers } = require("../../../common/sessionHelpers");
const { isSessionPersistenceEnabled } = require("../../../common/sessionPersistence.js");
const { hydrateCookies: hydrateCookiesShared } = require("../../../common/cookieHarvest");

// Platform-specific: the eComPlatform matcher this store scopes every query to.
const buildMatchers = makeBuildMatchers(PLATFORM_REGEX);

// Akamai plus the AJIO SPA plant a lot of cookies. A jar with fewer than a
// handful is almost certainly a torn-down session — refuse to cache it rather
// than write a record that will fail the very first probe.
const MIN_COOKIES = 3;

// ---------------------------
// 🎚️ Feature flags
// ---------------------------
// AJIO_SESSION_SAVE=true → opt in to the whole flow (save AND try reuse).
// AJIO_SESSION_CACHE=false → hard kill-switch (overrides SAVE).
function isSessionSaveEnabled() {
    // A process with no database access can never persist, and no environment
    // variable may override that. See common/sessionPersistence.js.
    if (!isSessionPersistenceEnabled()) return false;
    if (process.env.AJIO_SESSION_CACHE === "false") return false;
    return process.env.AJIO_SESSION_SAVE === "true";
}


function isUsableRecord(record) {
    return !!(
        record &&
        Array.isArray(record.jar) &&
        record.jar.length >= MIN_COOKIES &&
        record.userId &&
        Array.isArray(record.pobIds) &&
        record.pobIds.length > 0
    );
}

function computeExpiry() {
    return new Date(Date.now() + AJIO_SESSION_EXPIRY_HOURS * 60 * 60 * 1000);
}

// ---------------------------
// 🔎 Locating the credential
// ---------------------------
// Prefer the credential's own _id; fall back to username. The same AJIO account
// can sit under more than one company, so writes use updateMany.


// ---------------------------
// 💾 Save
// ---------------------------
// Never throws — a cache write must not fail a login that just succeeded.
async function saveSession({
    credentialId,
    username,
    jar,
    userId,
    pobIds,
    stores = [],
    ip = null,
    source = "unknown",
}) {
    if (!isSessionSaveEnabled()) return false;
    const draft = { jar, userId, pobIds };
    if (!isUsableRecord(draft)) {
        console.warn(
            `⚠️ [ajio/sessionStore] Refusing to cache an incomplete session for ${username} ` +
            `(cookies=${Array.isArray(jar) ? jar.length : 0}, userId=${userId ? "yes" : "no"}, pobIds=${Array.isArray(pobIds) ? pobIds.length : 0})`
        );
        return false;
    }

    const matcher = buildMatchers({ credentialId, username });
    if (!matcher) return false;

    const expiresAt = computeExpiry();
    const record = {
        jar,
        userId,
        pobIds,
        stores,
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
            // bff_session is the AJIO backend auth cookie — if it's missing here,
            // the save is worthless. Surface its presence explicitly so a broken
            // save shows up in the log rather than silently succeeding.
            const hasAuth = jar.some((c) => c && c.name === "bff_session");
            console.log(
                `💾 [ajio/sessionStore] Cached session for ${username} ` +
                `(${jar.length} cookies, ${pobIds.length} PoBs, userId=${userId}, bff_session=${hasAuth ? "yes" : "MISSING"}, source=${source}, valid ~${hrs}h)`
            );
            return true;
        }
        console.warn(
            `⚠️ [ajio/sessionStore] No credential matched ${matcher.label} — session not cached`
        );
        return false;
    } catch (err) {
        console.warn(`⚠️ [ajio/sessionStore] Save failed for ${username}: ${err.message}`);
        return false;
    }
}

// ---------------------------
// 📤 Load
// ---------------------------
async function loadSession({ credentialId, username }) {
    // Nothing was ever written from this process, so there is nothing to read.
    // Returning early keeps the desktop app from opening a database connection
    // it must not have — see common/sessionPersistence.js.
    if (!isSessionPersistenceEnabled()) return null;
    if (!isSessionSaveEnabled()) return null;

    const matcher = buildMatchers({ credentialId, username });
    if (!matcher) return null;

    try {
        const col = await companiesCollection();
        const doc = await col.findOne(matcher.query, {
            projection: { "settings.eCommercePlatformLoginInfo": 1 },
        });

        const platforms = doc?.settings?.eCommercePlatformLoginInfo || [];
        const ajio = platforms.find(
            (p) => (p?.eComPlatform || "").toLowerCase().trim() === "ajio"
        );
        const cred = (Array.isArray(ajio?.info) ? ajio.info : []).find(matcher.matches);
        const record = cred?.[SESSION_FIELD];

        if (!isUsableRecord(record)) return null;

        if (record.expiresAt && new Date(record.expiresAt).getTime() <= Date.now()) {
            console.log(
                `⏰ [ajio/sessionStore] Cached session for ${username} expired at ${record.expiresAt}`
            );
            return null;
        }
        return record;
    } catch (err) {
        console.warn(`⚠️ [ajio/sessionStore] Load failed for ${username}: ${err.message}`);
        return null;
    }
}

// ---------------------------
// 🗑️ Clear
// ---------------------------
async function clearSession({ credentialId, username }, reason = "") {
    // Nothing was ever written from this process, so there is nothing to clear.
    // Without this a forceFresh login tries to reach Mongo purely to delete a
    // row that cannot exist, fails, and logs a warning about a missing driver
    // that is missing on purpose.
    if (!isSessionPersistenceEnabled()) return;
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
            `🗑️ [ajio/sessionStore] Cleared cached session for ${username}${reason ? ` (${reason})` : ""}`
        );
        return true;
    } catch (err) {
        console.warn(`⚠️ [ajio/sessionStore] Clear failed for ${username}: ${err.message}`);
        return false;
    }
}

// ---------------------------
// 🍪 Puppeteer helpers
// ---------------------------
// Grab every cookie from the browser context. We use CDP's Network.getAllCookies
// (via CDPSession) because it returns HttpOnly + third-party cookies too, which
// `page.cookies()` alone drops. Akamai's `_abck` is HttpOnly, so missing it
// would make the cached session useless.
async function harvestCookies(page) {
    try {
        const client = await page.createCDPSession();
        const { cookies } = await client.send("Network.getAllCookies");
        return Array.isArray(cookies) ? cookies : [];
    } catch (err) {
        console.warn(`⚠️ [ajio/sessionStore] Cookie harvest via CDP failed (${err.message}) — falling back to page.cookies()`);
        try {
            return await page.cookies();
        } catch (e) {
            return [];
        }
    }
}

// Rehydrate a saved jar into a fresh Puppeteer page. Uses CDP so HttpOnly
// cookies land intact. Returns the number of cookies set (for logging).
//
// THE RULES THIS USED TO CARRY NOW LIVE IN common/cookieHarvest, because a
// second Cloudflare/Akamai platform needed the same ones and learned them the
// same way. They were, and remain:
//
// 1. `expires: -1` from getAllCookies means "session cookie". Handed back,
//    Chrome reads it as a Unix timestamp of Dec 1969 and drops the cookie as
//    expired the instant it is set. `bff_session` IS a session cookie, so every
//    reuse silently lost it and the probe hit the API unauthenticated — 401,
//    fresh login, save, repeat.
// 2. A `sameSite` that is not "Strict" | "Lax" | "None" makes setCookies throw
//    for the WHOLE batch, dropping every cookie.
//
// The shared helper adds a third that AJIO was only accidentally safe from: it
// never passes `partitionKey` back, which is what rejected Tata CliQ's
// `cf_clearance` on newer Chrome. Its fallback also sanitises, which this one
// did not — the old `page.setCookie(c)` path handed back the raw record and so
// reproduced rules 1 and 2 the moment CDP failed.
async function hydrateCookies(page, jar) {
    return hydrateCookiesShared(page, jar, { label: "ajio/sessionStore" });
}

// ---------------------------
// 🧹 Clean-slate helper
// ---------------------------
// Wipe everything the AJIO SPA uses to conclude "user is already logged in":
// the cookies we just hydrated AND the localStorage / sessionStorage the SPA
// wrote when we navigated to /vmsui/dashboard during the probe. Without this,
// a probe rejection (401) still leaves enough of a client-side session that
// navigating to the SSO login URL bounces straight through to a signed-in
// view — the login form never renders and the outer waitForSelector times
// out. Storage MUST be cleared before cookies, and BEFORE navigating away
// from seller.ajio.com — a page not on that origin cannot touch its
// localStorage. Best-effort throughout: this runs on the failure path and
// must not throw.
async function clearPageAuthState(page) {
    try {
        await page.evaluate(() => {
            try { window.localStorage.clear(); } catch (_) { /* opaque origin */ }
            try { window.sessionStorage.clear(); } catch (_) { /* same */ }
        });
    } catch (_) { /* page may have been torn down */ }
    try {
        const client = await page.createCDPSession();
        await client.send("Network.clearBrowserCookies");
    } catch (err) {
        console.warn(
            `⚠️ [ajio/sessionStore] Cookie clear after probe rejection failed (${err.message}) — SSO login may find a stale jar`
        );
    }
    // Park on about:blank LAST. Left on the live SPA, AJIO reacts to the auth state we just wiped
    // by redirecting itself — and that self-navigation ABORTS the caller's next page.goto with
    // net::ERR_ABORTED (login() swallowed it and the run died 15s later on "Could not resolve
    // x-seller-id"). A blank page has no SPA left to race us. Best-effort: never throw here.
    try { await page.evaluate(() => window.stop()); } catch (_) { /* page may be mid-navigation */ }
    try {
        await page.goto("about:blank", { waitUntil: "domcontentloaded", timeout: 15000 });
    } catch (err) {
        console.warn(`⚠️ [ajio/sessionStore] Could not park page on about:blank (${err.message})`);
    }
}

// ---------------------------
// 🩺 Probe
// ---------------------------
// "Not expired" is not "works". Fire the same work-places API the runner uses
// (page 0, size 1) from inside the page — same origin, real Chrome fingerprint,
// so Akamai treats it as legitimate. If we get a 200 with content, the session
// is genuinely alive.
async function probeSessionInPage(page, record) {
    const url = `/malekith/nickfury/v1/sellers/${record.userId}/work-places?workPlaceType=POB&page=0&size=1`;
    try {
        const res = await page.evaluate(async (u) => {
            try {
                const r = await fetch(u, {
                    headers: { Accept: "application/json", "X-Tenant": "AJIO" },
                    credentials: "include",
                });
                // Return the FULL body — do NOT truncate here. A PoB list with
                // full address details easily runs 2-3 KB and truncating before
                // JSON.parse makes valid responses look malformed, which the
                // caller then treats as "session dead" and forces a re-login on
                // every run. Cap at 100 KB to keep a pathological response from
                // flooding the log; well above real payload sizes.
                const text = await r.text();
                return { status: r.status, text: text.slice(0, 100_000) };
            } catch (e) {
                return { status: -1, text: String(e) };
            }
        }, url);

        if (res.status < 200 || res.status >= 300) {
            // Include a body snippet — a 401 with an empty response is our own
            // cookies not landing, but a 401 with an "Akamai reference" body
            // is a bot check we cannot reuse through and need to know about.
            const snippet = (res.text || "").replace(/\s+/g, " ").slice(0, 200);
            console.log(
                `🩺 [ajio/sessionStore] Probe rejected session (HTTP ${res.status})${snippet ? ` body="${snippet}"` : ""}`
            );
            return false;
        }
        let json = null;
        let parseErr = null;
        try { json = JSON.parse(res.text); } catch (e) { parseErr = e; }

        if (parseErr) {
            // A parse failure is NOT the same as a dead session. If AJIO ever
            // ships a non-JSON response (HTML error page, gateway timeout, etc.)
            // the reuse should still fail closed — but we log it as its own
            // thing so it doesn't get miscategorised as "session is dead".
            const snippet = (res.text || "").replace(/\s+/g, " ").slice(0, 300);
            console.log(
                `🩺 [ajio/sessionStore] Probe response was not JSON (HTTP ${res.status}) body="${snippet}" err=${parseErr.message}`
            );
            return false;
        }

        const content = Array.isArray(json.content) ? json.content : null;
        if (!content || content.length === 0) {
            const snippet = (res.text || "").replace(/\s+/g, " ").slice(0, 300);
            console.log(
                `🩺 [ajio/sessionStore] Probe returned no PoBs (HTTP ${res.status}) body="${snippet}" — session is dead`
            );
            return false;
        }
        return true;
    } catch (err) {
        console.log(
            `🩺 [ajio/sessionStore] Probe failed (${err.message}) — treating session as dead`
        );
        return false;
    }
}

// ---------------------------
// ♻️ Reuse
// ---------------------------
// Convenience wrapper used by the login path. Given an already-launched
// Puppeteer page (fresh context, no cookies yet), try to bring it up to a
// logged-in state using the cached record without ever showing the SSO form.
//
// Flow:
//   1. Load cache. If empty/expired/disabled → null (caller falls back to SSO).
//   2. Hydrate cookies into the page via CDP Network.setCookies.
//   3. Navigate to seller.ajio.com — enough to boot the SPA and rehydrate
//      localStorage from the session cookies.
//   4. Probe the work-places API from inside the page. If it fails, return null.
//   5. Return { userId, pobIds, stores } so the caller can skip getUserId /
//      getPobIds too.
//
// On failure, the record is deliberately NOT cleared here — a fresh SSO login
// will overwrite it anyway, and clearing on a soft failure is how a
// just-renewed session vanishes from the DB (see flipkart/sessionStore comment).
async function tryReuseSession(page, { credentialId, username, landingUrl }) {
    if (!isSessionSaveEnabled()) return null;
    const record = await loadSession({ credentialId, username });
    if (!record) return null;

    return reuseSessionRecord(page, record, { username, landingUrl });
}

// Steps 2-5 of the flow above, given a record the caller already holds.
//
// Split out because the desktop app cannot use `tryReuseSession`: that one
// reads the record from Mongo and is gated on env keys, and the desktop has
// neither a database connection nor those keys — it holds the same record
// already, decrypted from its local copy of the company document.
//
// AJIO is the one platform whose session cannot be probed from a jar alone
// (see common/probeSession.js, where it is absent on purpose): the check has to
// run inside a real logged-in page. So this is the only shape a correct AJIO
// reuse can take, and both runners must share it rather than each inventing
// one.
//
// @param {object} page    a fresh Puppeteer page with no cookies yet
// @param {object} record  { jar, userId, pobIds?, stores?, expiresAt? }
// @returns {Promise<{userId, pobIds, stores}|null>} null means "sign in"
async function reuseSessionRecord(page, record, { username, landingUrl } = {}) {
    if (!isUsableRecord(record)) return null;

    // Say up front whether the stored jar can possibly authenticate.
    //
    // bff_session is AJIO's backend auth cookie and it is HttpOnly, so a jar
    // harvested by anything that reads document.cookie — a browser extension,
    // page.evaluate — simply does not contain it. That jar hydrates fine, looks
    // healthy, has a future expiry, and then the probe answers
    // "Authorization header missing" (HTTP 401), which reads like a bug in the
    // probe rather than a jar that was never usable. Only a CDP harvest
    // (`harvestCookies` above) captures it.
    const names = record.jar.map((c) => c && c.name);
    if (!names.includes("bff_session")) {
        console.log(
            `🍪 [ajio/sessionStore] Stored jar for ${username} has no bff_session — ` +
            `it cannot authenticate (${record.jar.length} cookies: ${names.slice(0, 8).join(", ")}). ` +
            "That cookie is HttpOnly, so whatever captured this session could not read it. " +
            "Signing in fresh; the session saved after this login will carry it."
        );
        return null;
    }

    const hydrated = await hydrateCookies(page, record.jar);
    if (hydrated === 0) {
        console.log(`↩️ [ajio/sessionStore] Could not hydrate cookies for ${username} — falling through to SSO login`);
        // Nothing was hydrated, so nothing to clear — safe to just return.
        return null;
    }

    // Navigate to the seller portal so the SPA can boot with our cookies in place.
    // Use domcontentloaded rather than networkidle2 — Akamai keeps beacons open.
    const target = landingUrl || "https://seller.ajio.com/vmsui/dashboard";
    try {
        await page.goto(target, { waitUntil: "domcontentloaded", timeout: 45000 });
    } catch (err) {
        console.log(`↩️ [ajio/sessionStore] Navigation to ${target} failed (${err.message}) — falling through to SSO login`);
        // Cookies were hydrated at the browser level. Even if the goto failed,
        // the fresh SSO login below will hit seller.ajio.com and the stale
        // cookies would bounce it into a signed-in view — clear them now.
        await clearPageAuthState(page);
        return null;
    }

    if (!(await probeSessionInPage(page, record))) {
        console.log(
            `↩️ [ajio/sessionStore] Cached session for ${username} did not pass the probe — ` +
            "logging in fresh (stored session left in place)"
        );
        // Probe rejection means the API session is dead but the client-side
        // cookies + SPA-written localStorage are still enough to make AJIO's
        // SPA answer "already logged in" on the next navigation. That's what
        // was making /ajiocommerce/ auto-redirect to /vmsui/orders/dropship/
        // order-process and the outer waitForSelector time out at 60s. Clear
        // the auth state so the SSO login form actually renders.
        await clearPageAuthState(page);
        return null;
    }

    const leftMin = record.expiresAt
        ? Math.round((new Date(record.expiresAt).getTime() - Date.now()) / 60000)
        : null;
    console.log(
        `♻️ [ajio/sessionStore] Reusing cached AJIO session for ${username} — ` +
        `skipping SSO login${leftMin !== null ? ` (~${leftMin}m left)` : ""}`
    );
    return {
        userId: record.userId,
        pobIds: record.pobIds,
        stores: Array.isArray(record.stores) ? record.stores : [],
    };
}

module.exports = {
    isSessionSaveEnabled,
    saveSession,
    reuseSessionRecord,
    loadSession,
    clearSession,
    harvestCookies,
    hydrateCookies,
    probeSessionInPage,
    tryReuseSession,
    clearPageAuthState,
    SESSION_FIELD,
};
