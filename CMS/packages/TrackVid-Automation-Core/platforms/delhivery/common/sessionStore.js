// -----------------------------------------------------------------------------
// Delhivery session cache — persist the Keycloak OAuth2 tokens per credential
// -----------------------------------------------------------------------------
// Different template from cookie-jar platforms (Snapdeal/Flipkart/Myntra):
// Delhivery One authenticates every API call with an `Authorization: Bearer`
// header carrying a Keycloak access_token, and the token lives only ~10 minutes
// (expires_in=600) — so the sessionStore holds a REFRESH_TOKEN plus a
// short-lived access_token snapshot, and the caller refreshes on demand.
//
// Stored on the credential itself:
//
//   companies.settings.eCommercePlatformLoginInfo[<delhivery>].info[<cred>]
//     .delhiverySession = {
//       accessToken,       // short-lived (~600s)
//       accessExpiresAt,   // ISO — auto-refresh when within 60s of this
//       refreshToken,      // longer-lived (~86400s / 24h)
//       tokenType: "Bearer",
//       idToken,           // JWT with email/sub — informational
//       realm,             // Keycloak realm this seller belongs to (per-tenant)
//       tenantId,          // realm/company uuid from /p/tenants — realm discovery only
//       hqClientId,        // the x-hq-client-id header value (see ./hqClient.js).
//                          // NOT the same thing as tenantId on a multi-client
//                          // account: sending the company uuid there earns a
//                          // 403 "User unauthorised to access mentioned client!"
//       clientId,          // "ucp-vue-frontend" today, but stored for portability
//       savedAt,
//       expiresAt,         // ISO — record lifetime cap, mirrors refresh_token TTL
//       source,
//   }
//
// Enable session persistence with DELHIVERY_SESSION_SAVE=true (mirrors AJIO
// naming). Legacy inverted flag DELHIVERY_SESSION_CACHE=false disables it —
// same transition pattern used for Snapdeal.
// -----------------------------------------------------------------------------

const axios = require("axios");
const { connectDB } = require("../../../common/db");
const { DELHIVERY_SESSION_EXPIRY_HOURS } = require("../../../common/constants");

const SESSION_FIELD = "delhiverySession";
const PLATFORM_REGEX = { $regex: "^delhivery$", $options: "i" };

const { companiesCollection, makeBuildMatchers } = require("../../../common/sessionHelpers");
const { isSessionPersistenceEnabled } = require("../../../common/sessionPersistence.js");

// Platform-specific: the eComPlatform matcher this store scopes every query to.
const buildMatchers = makeBuildMatchers(PLATFORM_REGEX);
const PROBE_TIMEOUT_MS = 20_000;

// Endpoints — kept here so claimApiFlow can import them and use the same URLs
// the sessionStore probes / refreshes against (single source of truth).
const AUTH_HOST = "https://ucp-auth.delhivery.com";
const APP_AUTH_HOST = "https://ucp-app-auth.delhivery.com";
const GATEWAY_HOST = "https://ucp-app-gateway.delhivery.com";
const TOKEN_URL = (realm) => `${AUTH_HOST}/facelessvoid/realms/${realm}/protocol/openid-connect/token`;
const PROBE_URL = `${APP_AUTH_HOST}/p/api/account/profile`;

// Refresh the access_token this many seconds BEFORE it expires. The token
// itself is short (~600s / 10 min), so a 60s cushion buys enough time to
// finish a mid-batch call without race-condition 401s.
const REFRESH_BEFORE_EXPIRY_SEC = 60;

function isSessionCacheEnabled() {
    // A process with no database access can never persist, and no environment
    // variable may override that. See common/sessionPersistence.js.
    if (!isSessionPersistenceEnabled()) return false;
    if (process.env.DELHIVERY_SESSION_SAVE === "false") return false;
    if (process.env.DELHIVERY_SESSION_CACHE === "false") return false;
    return true;
}


function isUsableRecord(record) {
    return !!(record && record.accessToken && record.refreshToken && record.realm);
}

function computeExpiry() {
    return new Date(Date.now() + DELHIVERY_SESSION_EXPIRY_HOURS * 60 * 60 * 1000);
}

function tokenNearlyExpired(record) {
    if (!record?.accessExpiresAt) return true;
    const ms = new Date(record.accessExpiresAt).getTime() - Date.now();
    return ms <= REFRESH_BEFORE_EXPIRY_SEC * 1000;
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
    accessToken,
    refreshToken,
    accessExpiresIn,       // seconds — from token endpoint `expires_in`
    idToken = null,
    tokenType = "Bearer",
    realm,
    tenantId = null,
    hqClientId = null,
    clientId = "ucp-vue-frontend",
    source = "unknown",
}) {
    if (!isSessionCacheEnabled()) return false;
    if (!accessToken || !refreshToken || !realm) {
        console.warn(
            `⚠️ [delhivery/sessionStore] Refusing to cache incomplete session for ${username} ` +
            `(accessToken=${!!accessToken}, refreshToken=${!!refreshToken}, realm=${realm || "none"})`
        );
        return false;
    }
    const matcher = buildMatchers({ credentialId, username });
    if (!matcher) return false;

    const accessExpiresAt = new Date(
        Date.now() + (Number(accessExpiresIn) || 600) * 1000
    ).toISOString();
    const expiresAt = computeExpiry();

    const record = {
        accessToken,
        accessExpiresAt,
        refreshToken,
        tokenType,
        idToken,
        realm,
        tenantId,
        hqClientId,
        clientId,
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
                `💾 [delhivery/sessionStore] Cached session for ${username} ` +
                `(access ${Number(accessExpiresIn) || 600}s, record ~${hrs}h, realm=${realm})`
            );
            return true;
        }
        console.warn(
            `⚠️ [delhivery/sessionStore] No credential matched ${matcher.label} — session not cached`
        );
        return false;
    } catch (err) {
        console.warn(`⚠️ [delhivery/sessionStore] Save failed for ${username}: ${err.message}`);
        return false;
    }
}

// ---------------------------
// 💾 Save just the hq client id
// ---------------------------
// A resolved x-hq-client-id is worth caching, but re-running the full
// saveSession to store it would rewrite accessExpiresAt from a default
// `expires_in` we no longer have — a token with two minutes left would be
// recorded as fresh for ten, and the batch would 401 halfway through. So this
// touches the one field.
// Pass null to forget a resolved id — used when the gateway refuses it, so the
// next run re-probes instead of replaying a value that cannot work. Without
// this a bad id outlives every token refresh and every re-login, which is
// exactly how the company uuid kept 403-ing long after the session was healthy.
async function saveHqClientId({ credentialId, username }, hqClientId) {
    if (!isSessionCacheEnabled()) return false;
    const matcher = buildMatchers({ credentialId, username });
    if (!matcher) return false;
    try {
        const col = await companiesCollection();
        const res = await col.updateMany(
            matcher.query,
            { $set: { [`settings.eCommercePlatformLoginInfo.$[p].info.$[c].${SESSION_FIELD}.hqClientId`]: hqClientId } },
            { arrayFilters: matcher.arrayFilters }
        );
        return res.modifiedCount > 0;
    } catch (err) {
        console.warn(`⚠️ [delhivery/sessionStore] hqClientId save failed for ${username}: ${err.message}`);
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
        const delhivery = platforms.find(
            (p) => (p?.eComPlatform || "").toLowerCase().trim() === "delhivery"
        );
        const cred = (Array.isArray(delhivery?.info) ? delhivery.info : []).find(matcher.matches);
        const record = cred?.[SESSION_FIELD];

        if (!isUsableRecord(record)) return null;
        if (record.expiresAt && new Date(record.expiresAt).getTime() <= Date.now()) {
            console.log(
                `⏰ [delhivery/sessionStore] Cached session for ${username} expired at ${record.expiresAt}`
            );
            return null;
        }
        return record;
    } catch (err) {
        console.warn(`⚠️ [delhivery/sessionStore] Load failed for ${username}: ${err.message}`);
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
            `🗑️ [delhivery/sessionStore] Cleared session for ${username}${reason ? ` (${reason})` : ""}`
        );
        return true;
    } catch (err) {
        console.warn(`⚠️ [delhivery/sessionStore] Clear failed for ${username}: ${err.message}`);
        return false;
    }
}

// ---------------------------
// 🔄 Refresh access_token via refresh_token
// ---------------------------
// Called from getUsableSession when the cached access_token is near expiry.
// Never throws — a failed refresh returns null and the caller falls through to
// a full re-login. Keycloak refresh answers with the same JSON shape as the
// initial token exchange, so the caller updates the record with the new
// { access_token, refresh_token, expires_in }.
async function refreshAccessToken(record) {
    try {
        const url = TOKEN_URL(record.realm);
        const body = new URLSearchParams({
            grant_type: "refresh_token",
            refresh_token: record.refreshToken,
            client_id: record.clientId || "ucp-vue-frontend",
        }).toString();

        const res = await axios.post(url, body, {
            headers: {
                "content-type": "application/x-www-form-urlencoded",
                accept: "application/json",
            },
            validateStatus: () => true,
            timeout: PROBE_TIMEOUT_MS,
        });

        if (res.status !== 200 || !res.data?.access_token) {
            console.log(
                `🔄 [delhivery/sessionStore] Refresh rejected (HTTP ${res.status}) — session dead`
            );
            return null;
        }
        return {
            accessToken: res.data.access_token,
            refreshToken: res.data.refresh_token || record.refreshToken,
            accessExpiresIn: res.data.expires_in,
            idToken: res.data.id_token || record.idToken,
            tokenType: res.data.token_type || "Bearer",
        };
    } catch (err) {
        console.log(`🔄 [delhivery/sessionStore] Refresh failed (${err.message})`);
        return null;
    }
}

// ---------------------------
// 🩺 Probe
// ---------------------------
// GET /p/api/account/profile — the same call the portal fires on boot. A live
// session returns 200 with the seller profile; a dead one returns 401.
async function probeSession(record) {
    try {
        const res = await axios.get(PROBE_URL, {
            headers: {
                accept: "application/json",
                authorization: `${record.tokenType || "Bearer"} ${record.accessToken}`,
            },
            validateStatus: () => true,
            timeout: PROBE_TIMEOUT_MS,
        });
        if (res.status !== 200) {
            console.log(`🩺 [delhivery/sessionStore] Probe rejected (HTTP ${res.status})`);
            return false;
        }
        return true;
    } catch (err) {
        console.log(`🩺 [delhivery/sessionStore] Probe failed (${err.message})`);
        return false;
    }
}

// ---------------------------
// 🎫 Convenience: get a usable ctx
// ---------------------------
// Load → refresh if near-expiry → probe → return ctx object.
// Returns null when nothing survives, in which case the caller does a fresh
// login. Persists any refreshed token back to Mongo so the next call skips
// the refresh round-trip.
async function getUsableSession(cacheKey) {
    const record = await loadSession(cacheKey);
    if (!record) return null;

    let currentRecord = record;
    if (tokenNearlyExpired(record)) {
        const refreshed = await refreshAccessToken(record);
        if (!refreshed) return null;
        currentRecord = {
            ...record,
            accessToken: refreshed.accessToken,
            refreshToken: refreshed.refreshToken,
            accessExpiresAt: new Date(
                Date.now() + (Number(refreshed.accessExpiresIn) || 600) * 1000
            ).toISOString(),
            idToken: refreshed.idToken,
            tokenType: refreshed.tokenType,
        };
        try {
            await saveSession({
                ...cacheKey,
                accessToken: refreshed.accessToken,
                refreshToken: refreshed.refreshToken,
                accessExpiresIn: refreshed.accessExpiresIn,
                idToken: refreshed.idToken,
                tokenType: refreshed.tokenType,
                realm: record.realm,
                tenantId: record.tenantId,
                hqClientId: record.hqClientId,
                clientId: record.clientId,
                source: "refresh",
            });
        } catch (_) { /* save is best-effort */ }
    }

    if (!(await probeSession(currentRecord))) {
        // Same rationale as Flipkart: probe fails aren't proof — leave the
        // record in place so the fresh login path overwrites it; AUTH_EXPIRED
        // from a real API call clears it with evidence.
        console.log(
            `↩️ [delhivery/sessionStore] Cached session for ${cacheKey.username} did not pass probe — logging in fresh`
        );
        return null;
    }

    const leftMin = currentRecord.expiresAt
        ? Math.round((new Date(currentRecord.expiresAt).getTime() - Date.now()) / 60000)
        : null;
    console.log(
        `♻️ [delhivery/sessionStore] Reusing session for ${cacheKey.username}` +
        (leftMin !== null ? ` (~${leftMin}m before refresh_token TTL cap)` : "")
    );
    return {
        accessToken: currentRecord.accessToken,
        refreshToken: currentRecord.refreshToken,
        tokenType: currentRecord.tokenType || "Bearer",
        realm: currentRecord.realm,
        tenantId: currentRecord.tenantId,
        hqClientId: currentRecord.hqClientId || null,
        clientId: currentRecord.clientId || "ucp-vue-frontend",
        idToken: currentRecord.idToken,
    };
}

module.exports = {
    isSessionCacheEnabled,
    saveSession,
    saveHqClientId,
    loadSession,
    clearSession,
    probeSession,
    refreshAccessToken,
    getUsableSession,
    SESSION_FIELD,
    AUTH_HOST,
    APP_AUTH_HOST,
    GATEWAY_HOST,
    TOKEN_URL,
    PROBE_URL,
    REFRESH_BEFORE_EXPIRY_SEC,
};
