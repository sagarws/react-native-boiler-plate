// -----------------------------------------------------------------------------
// Flipkart session cache — persist the post-login session per credential
// -----------------------------------------------------------------------------
// Mirrors myntraAutoMation/sessionStore.js. The API runner
// (flipkartAutoClaim/claimApiFlow.loginFlipkartApi) launches a visible Chrome
// purely to clear Flipkart's emailed-OTP login and harvest a session, then tears
// the browser down and does every claim step over HTTP. That login costs ~30-90s
// (most of it waiting on the OTP mail) and carries the whole OTP / bot-detection
// failure surface, so a session worth reusing should be reused.
//
// Stored on the credential itself, beside `masterDataSync` / `myntraSession`:
//
//   companies.settings.eCommercePlatformLoginInfo[<flipkart>].info[<cred>].flipkartSession = {
//       jar:        { <cookie name>: <value>, ... },
//       csrfToken:  "JzRq1dXU-xfSW3HQfPsbi6C8geegObhMgcgQ",
//       savedAt:    "2026-08-18T12:03:40.001Z",
//       expiresAt:  "2026-08-25T10:03:40.001Z",
//       ip:         null,
//       source:     "claim-api" | "renew-endpoint" | "chrome-extension",
//   }
//
// TWO fields matter here where Myntra needed one: Flipkart signs every GraphQL
// call with `fk-csrf-token` in addition to the cookies, and a jar without it is
// useless for anything that mutates. Both are stored, both are required.
//
// Reuse is conservative: present → not past expiresAt → passes a live probe.
// Any doubt falls through to the normal login, which overwrites the record.
//
// Disable reuse with FLIPKART_SESSION_CACHE=false. The lifetime itself is not
// env-tunable — see FLIPKART_SESSION_EXPIRY_HOURS in src/constants/common.js.
// -----------------------------------------------------------------------------

const axios = require("axios");
const { connectDB } = require("../../../common/db");
const { FLIPKART_SESSION_EXPIRY_HOURS } = require("../../../common/constants");

const SESSION_FIELD = "flipkartSession";
const PLATFORM_REGEX = { $regex: "^flipkart$", $options: "i" };

const { companiesCollection, cookieHeader, makeBuildMatchers } = require("../../../common/sessionHelpers");
const { isSessionPersistenceEnabled } = require("../../../common/sessionPersistence.js");

// Platform-specific: the eComPlatform matcher this store scopes every query to.
const buildMatchers = makeBuildMatchers(PLATFORM_REGEX);
const ORIGIN = "https://seller.flipkart.com";
const PROBE_TIMEOUT_MS = 20_000;

// Flipkart never told us which cookie carries the session (the capture omits
// Cookie headers entirely — Chrome strips them). So rather than requiring
// specific names the way the Myntra store requires erp.at + session, we require
// a non-empty jar AND the csrf token, and let the probe decide if it works.
const MIN_COOKIES = 1;

// Lifetime comes from src/constants/common.js — the single source of truth,
// kept in step with TrackVid-BE/src/constants/common.ts. Deliberately NOT
// env-overridable: two places to set it is how the automation and the BE ingest
// endpoint end up stamping different expiries on the same record.

function isSessionCacheEnabled() {
    // A process with no database access can never persist, and no environment
    // variable may override that. See common/sessionPersistence.js.
    if (!isSessionPersistenceEnabled()) return false;
    return process.env.FLIPKART_SESSION_CACHE !== "false";
}


function isUsableRecord(record) {
    return !!(
        record &&
        record.jar &&
        Object.keys(record.jar).length >= MIN_COOKIES &&
        record.csrfToken
    );
}


function computeExpiry() {
    return new Date(Date.now() + FLIPKART_SESSION_EXPIRY_HOURS * 60 * 60 * 1000);
}

// ---------------------------
// 🔎 Locating the credential
// ---------------------------
// Prefer the credential's own _id; fall back to username. The same Flipkart
// account can sit under more than one company, so writes use updateMany.


// ---------------------------
// 💾 Save
// ---------------------------
// Never throws — a cache write must not fail a login that just succeeded.
async function saveSession({
    credentialId,
    username,
    jar,
    csrfToken,
    ip = null,
    source = "unknown",
}) {
    if (!isSessionCacheEnabled()) return false;
    if (!isUsableRecord({ jar, csrfToken })) {
        console.warn(
            `⚠️ [flipkart/sessionStore] Refusing to cache an incomplete session for ${username} ` +
            `(cookies=${Object.keys(jar || {}).length}, csrfToken=${csrfToken ? "yes" : "no"})`
        );
        return false;
    }

    const matcher = buildMatchers({ credentialId, username });
    if (!matcher) return false;

    const expiresAt = computeExpiry();
    const record = {
        jar,
        csrfToken,
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
                `💾 [flipkart/sessionStore] Cached session for ${username} ` +
                `(${Object.keys(jar).length} cookies, valid ~${hrs}h)`
            );
            return true;
        }
        console.warn(
            `⚠️ [flipkart/sessionStore] No credential matched ${matcher.label} — session not cached`
        );
        return false;
    } catch (err) {
        console.warn(`⚠️ [flipkart/sessionStore] Save failed for ${username}: ${err.message}`);
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
        const flipkart = platforms.find(
            (p) => (p?.eComPlatform || "").toLowerCase().trim() === "flipkart"
        );
        const cred = (Array.isArray(flipkart?.info) ? flipkart.info : []).find(matcher.matches);
        const record = cred?.[SESSION_FIELD];

        if (!isUsableRecord(record)) return null;

        if (record.expiresAt && new Date(record.expiresAt).getTime() <= Date.now()) {
            console.log(
                `⏰ [flipkart/sessionStore] Cached session for ${username} expired at ${record.expiresAt}`
            );
            return null;
        }
        return record;
    } catch (err) {
        console.warn(`⚠️ [flipkart/sessionStore] Load failed for ${username}: ${err.message}`);
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
            `🗑️ [flipkart/sessionStore] Cleared cached session for ${username}${reason ? ` (${reason})` : ""}`
        );
        return true;
    } catch (err) {
        console.warn(`⚠️ [flipkart/sessionStore] Clear failed for ${username}: ${err.message}`);
        return false;
    }
}

// ---------------------------
// 🩺 Probe
// ---------------------------
// "Not expired" is not "works", so we ask Flipkart — but WHICH call we ask
// matters, and the first choice here was wrong.
//
// Payments_Spf_WEB_getRiskProfile looked ideal (cheap, seller-scoped, part of
// the SPF page's own boot). It is not: sellers with no risk profile get an
// empty payload, so a perfectly good session reads as dead. Measured against
// live sessions, it failed 3 of 4 accounts that could raise claims fine.
//
// Payments_SPF_WEB_getProductTypes is the right probe, verified both ways:
//   valid session   → 200 with 5 product types
//   wrong csrf token→ 403 EBADCSRFTOKEN
//   no cookies      → 404
// It is also the very first call the runner makes after login, so a session
// that passes this passes the thing we actually need it for.
const Q_PRODUCT_TYPES = `query Payments_SPF_WEB_getProductTypes {
  getProductTypes {
    product_type
    __typename
  }
}`;

async function probeSession(record) {
    try {
        const res = await axios.post(
            `${ORIGIN}/napi/graphql`,
            {
                operationName: "Payments_SPF_WEB_getProductTypes",
                variables: {},
                query: Q_PRODUCT_TYPES,
            },
            {
                headers: {
                    accept: "*/*",
                    "content-type": "application/json",
                    Referer: `${ORIGIN}/index.html`,
                    "fk-csrf-token": record.csrfToken,
                    operation: "query",
                    "operation-name": "Payments_SPF_WEB_getProductTypes",
                    "x-internal-env-type": "WEB",
                    "x-location-id": "",
                    "x-requested-with": "XMLHttpRequest",
                    cookie: cookieHeader(record.jar),
                },
                validateStatus: () => true,
                timeout: PROBE_TIMEOUT_MS,
            }
        );

        if (res.status !== 200) {
            const code = res.data && res.data.error && res.data.error.code;
            console.log(
                `🩺 [flipkart/sessionStore] Probe rejected session (HTTP ${res.status}${code ? ` ${code}` : ""})`
            );
            return false;
        }
        const body = res.data || {};
        if (Array.isArray(body.errors) && body.errors.length > 0) {
            console.log("🩺 [flipkart/sessionStore] Probe returned GraphQL errors — session is dead");
            return false;
        }
        const types = body.data && body.data.getProductTypes && body.data.getProductTypes.product_type;
        if (!Array.isArray(types) || types.length === 0) {
            console.log("🩺 [flipkart/sessionStore] Probe got no product types — session is dead");
            return false;
        }
        return true;
    } catch (err) {
        console.log(
            `🩺 [flipkart/sessionStore] Probe failed (${err.message}) — treating session as dead`
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
        // Deliberately NOT cleared. A probe is evidence, not proof, and deleting
        // a session on a failed probe is how a renewed-two-minutes-ago session
        // disappeared from the DB and forced a browser login. The fresh login
        // that follows overwrites this record anyway; if the session really is
        // dead, the AUTH_EXPIRED path (a real 401/403 from a real call) clears
        // it with actual evidence.
        console.log(
            `↩️ [flipkart/sessionStore] Cached session for ${username} did not pass the probe — ` +
            "logging in fresh (stored session left in place)"
        );
        return null;
    }

    const leftMin = record.expiresAt
        ? Math.round((new Date(record.expiresAt).getTime() - Date.now()) / 60000)
        : null;
    console.log(
        `♻️ [flipkart/sessionStore] Reusing cached Flipkart session for ${username} — ` +
        `skipping browser login${leftMin !== null ? ` (~${leftMin}m left)` : ""}`
    );
    return { jar: record.jar, csrfToken: record.csrfToken, sellerId: null };
}

module.exports = {
    isSessionCacheEnabled,
    saveSession,
    loadSession,
    clearSession,
    probeSession,
    getUsableSession,
    SESSION_FIELD,
};
