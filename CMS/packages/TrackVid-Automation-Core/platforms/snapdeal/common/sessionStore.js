// -----------------------------------------------------------------------------
// Snapdeal session cache — persist the post-login session per credential
// -----------------------------------------------------------------------------
// Mirrors flipkartAutoMation/sessionStore.js. The API runner
// (snapdealAutoClaim/claimApiFlow.loginSnapdealApi) launches Puppeteer purely to
// clear the seller portal's password login and harvest a session, then tears
// the browser down and does every claim / report step over HTTP. Bootstrapping
// login is expensive (~15-30s) and carries the whole OTP / captcha failure
// surface, so a session worth reusing should be reused.
//
// Stored on the credential itself, beside `masterDataSync`:
//
//   companies.settings.eCommercePlatformLoginInfo[<snapdeal>].info[<cred>].snapdealSession = {
//       jar:        { <cookie name>: <value>, ... },
//       savedAt:    "2026-08-21T12:03:40.001Z",
//       expiresAt:  "2026-08-28T10:03:40.001Z",
//       source:     "claim-api" | "renew-endpoint" | "chrome-extension" | "masterdata-api",
//   }
//
// Unlike Flipkart / Myntra, Snapdeal's seller portal does NOT send a CSRF
// token on mutating requests — every authenticated call is scoped by the
// session cookie plus `X-Requested-With: XMLHttpRequest`. So only the jar is
// stored; no `csrfToken` field.
//
// Reuse is conservative: present → not past expiresAt → passes a live probe.
// Any doubt falls through to the normal login, which overwrites the record.
//
// Reuse is opt-IN through SNAPDEAL_SESSION_SAVE=true (mirrors AJIO's naming).
// The legacy inverted flag SNAPDEAL_SESSION_CACHE=false is still honoured so
// existing .env files keep working through the transition. The lifetime is
// not env-tunable — see SNAPDEAL_SESSION_EXPIRY_HOURS in src/constants/common.js.
// -----------------------------------------------------------------------------

const axios = require("axios");
const { connectDB } = require("../../../common/db");
const { SNAPDEAL_SESSION_EXPIRY_HOURS } = require("../../../common/constants");

const SESSION_FIELD = "snapdealSession";
const PLATFORM_REGEX = { $regex: "^snapdeal$", $options: "i" };

const { companiesCollection, cookieHeader, makeBuildMatchers } = require("../../../common/sessionHelpers");
const { isSessionPersistenceEnabled } = require("../../../common/sessionPersistence.js");

// Platform-specific: the eComPlatform matcher this store scopes every query to.
const buildMatchers = makeBuildMatchers(PLATFORM_REGEX);
const ORIGIN = "https://seller.snapdeal.com";
const PROBE_TIMEOUT_MS = 20_000;

// Snapdeal's capture omitted Cookie headers (Chrome strips them in silent
// webRequest capture), so we can't require a specific cookie by name. Require
// a non-empty jar and let the probe decide if it works.
const MIN_COOKIES = 1;

// Lifetime comes from src/constants/common.js — the single source of truth,
// kept in step with TrackVid-BE/src/constants/common.ts.

function isSessionCacheEnabled() {
    // A process with no database access can never persist, and no environment
    // variable may override that. See common/sessionPersistence.js.
    if (!isSessionPersistenceEnabled()) return false;
    // Two flags, in priority order:
    //   SNAPDEAL_SESSION_SAVE=true  → enable (positive; matches AJIO / new convention)
    //   SNAPDEAL_SESSION_CACHE=false → disable (legacy inverted flag, still honoured)
    // Default: enabled, so any deployment without either flag keeps caching.
    if (process.env.SNAPDEAL_SESSION_SAVE === "false") return false;
    if (process.env.SNAPDEAL_SESSION_CACHE === "false") return false;
    // A caller that explicitly sets SNAPDEAL_SESSION_SAVE=true is also fine.
    return true;
}


function isUsableRecord(record) {
    return !!(
        record &&
        record.jar &&
        Object.keys(record.jar).length >= MIN_COOKIES
    );
}


function computeExpiry() {
    return new Date(Date.now() + SNAPDEAL_SESSION_EXPIRY_HOURS * 60 * 60 * 1000);
}

// ---------------------------
// 🔎 Locating the credential
// ---------------------------


// ---------------------------
// 💾 Save
// ---------------------------
async function saveSession({
    credentialId,
    username,
    jar,
    source = "unknown",
}) {
    if (!isSessionCacheEnabled()) return false;
    if (!isUsableRecord({ jar })) {
        console.warn(
            `⚠️ [snapdeal/sessionStore] Refusing to cache an incomplete session for ${username} ` +
            `(cookies=${Object.keys(jar || {}).length})`
        );
        return false;
    }

    const matcher = buildMatchers({ credentialId, username });
    if (!matcher) return false;

    const expiresAt = computeExpiry();
    const record = {
        jar,
        savedAt: new Date().toISOString(),
        expiresAt: expiresAt.toISOString(),
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
                `💾 [snapdeal/sessionStore] Cached session for ${username} ` +
                `(${Object.keys(jar).length} cookies, valid ~${hrs}h)`
            );
            return true;
        }
        console.warn(
            `⚠️ [snapdeal/sessionStore] No credential matched ${matcher.label} — session not cached`
        );
        return false;
    } catch (err) {
        console.warn(`⚠️ [snapdeal/sessionStore] Save failed for ${username}: ${err.message}`);
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
    if (!isSessionCacheEnabled()) return null;

    const matcher = buildMatchers({ credentialId, username });
    if (!matcher) return null;

    try {
        const col = await companiesCollection();
        const doc = await col.findOne(matcher.query, {
            projection: { "settings.eCommercePlatformLoginInfo": 1 },
        });

        const platforms = doc?.settings?.eCommercePlatformLoginInfo || [];
        const snapdeal = platforms.find(
            (p) => (p?.eComPlatform || "").toLowerCase().trim() === "snapdeal"
        );
        const cred = (Array.isArray(snapdeal?.info) ? snapdeal.info : []).find(matcher.matches);
        const record = cred?.[SESSION_FIELD];

        if (!isUsableRecord(record)) return null;

        if (record.expiresAt && new Date(record.expiresAt).getTime() <= Date.now()) {
            console.log(
                `⏰ [snapdeal/sessionStore] Cached session for ${username} expired at ${record.expiresAt}`
            );
            return null;
        }
        return record;
    } catch (err) {
        console.warn(`⚠️ [snapdeal/sessionStore] Load failed for ${username}: ${err.message}`);
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
            `🗑️ [snapdeal/sessionStore] Cleared cached session for ${username}${reason ? ` (${reason})` : ""}`
        );
        return true;
    } catch (err) {
        console.warn(`⚠️ [snapdeal/sessionStore] Clear failed for ${username}: ${err.message}`);
        return false;
    }
}

// ---------------------------
// 🩺 Probe
// ---------------------------
// "Not expired" is not "works", so we ask Snapdeal — /getLoggedInSeller is the
// portal's own boot call, dirt-cheap, and returns 200 with the seller record
// when the cookies are alive and 401/302 otherwise. Same call the seller
// dashboard fires on load.
async function probeSession(record) {
    try {
        const res = await axios.get(`${ORIGIN}/getLoggedInSeller`, {
            headers: {
                accept: "application/json, text/plain, */*",
                "x-requested-with": "XMLHttpRequest",
                Referer: `${ORIGIN}/`,
                cookie: cookieHeader(record.jar),
            },
            // Follow-redirect off: a redirect here means Snapdeal is bouncing
            // an unauthenticated request back to /login, i.e. session dead.
            maxRedirects: 0,
            validateStatus: () => true,
            timeout: PROBE_TIMEOUT_MS,
        });

        if (res.status !== 200) {
            console.log(
                `🩺 [snapdeal/sessionStore] Probe rejected session (HTTP ${res.status})`
            );
            return false;
        }
        // Endpoint returns a JSON body with the seller's identifiers on a live
        // session; an empty body would mean the endpoint changed shape.
        const body = res.data;
        if (!body || (typeof body === "object" && Object.keys(body).length === 0)) {
            console.log("🩺 [snapdeal/sessionStore] Probe returned empty body — session is dead");
            return false;
        }
        return true;
    } catch (err) {
        console.log(
            `🩺 [snapdeal/sessionStore] Probe failed (${err.message}) — treating session as dead`
        );
        return false;
    }
}

// Convenience wrapper used by the login path: load → probe → hand back a ctx.
// Returns null when there is nothing usable, in which case the caller logs in.
async function getUsableSession({ credentialId, username }) {
    const record = await loadSession({ credentialId, username });
    if (!record) return null;

    if (!(await probeSession(record))) {
        // Deliberately NOT cleared. A probe is evidence, not proof; the fresh
        // login that follows overwrites this record anyway, and if the session
        // really is dead, the AUTH_EXPIRED path (a real 401/403 from a real
        // call) clears it with actual evidence.
        console.log(
            `↩️ [snapdeal/sessionStore] Cached session for ${username} did not pass the probe — ` +
            "logging in fresh (stored session left in place)"
        );
        return null;
    }

    const leftMin = record.expiresAt
        ? Math.round((new Date(record.expiresAt).getTime() - Date.now()) / 60000)
        : null;
    console.log(
        `♻️ [snapdeal/sessionStore] Reusing cached Snapdeal session for ${username} — ` +
        `skipping browser login${leftMin !== null ? ` (~${leftMin}m left)` : ""}`
    );
    return { jar: record.jar, sellerId: null };
}

module.exports = {
    isSessionCacheEnabled,
    saveSession,
    loadSession,
    clearSession,
    probeSession,
    getUsableSession,
    cookieHeader,
    SESSION_FIELD,
    ORIGIN,
};
