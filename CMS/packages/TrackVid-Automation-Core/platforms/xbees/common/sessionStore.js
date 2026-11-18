// -----------------------------------------------------------------------------
// Xbees (ExpressBees) session cache — Keycloak OAuth2 tokens per credential
// -----------------------------------------------------------------------------
// Same JWT template as Delhivery — access_token (~7200s / 2h), refresh_token
// (~14399s / 4h). Stored on the credential itself:
//
//   companies.settings.eCommercePlatformLoginInfo[<xbees>].info[<cred>].xbeesSession = {
//       accessToken, accessExpiresAt, refreshToken, tokenType: "Bearer",
//       idToken, realm ("xpressbees"), clientId ("client-portal-ui"),
//       savedAt, expiresAt, source,
//   }
//
// Enable with XBEES_SESSION_SAVE=true. Legacy XBEES_SESSION_CACHE=false
// disables it (transition alias).
// -----------------------------------------------------------------------------

const axios = require("axios");
const { connectDB } = require("../../../common/db");
const { XBEES_SESSION_EXPIRY_HOURS } = require("../../../common/constants");

const SESSION_FIELD = "xbeesSession";
const PLATFORM_REGEX = { $regex: "^(xbees|expressbees|xpressbees)$", $options: "i" };

const { companiesCollection, makeBuildMatchers } = require("../../../common/sessionHelpers");
const { isSessionPersistenceEnabled } = require("../../../common/sessionPersistence.js");

// Platform-specific: the eComPlatform matcher this store scopes every query to.
const buildMatchers = makeBuildMatchers(PLATFORM_REGEX);
const PROBE_TIMEOUT_MS = 20_000;

// Endpoints — verified from ApiDocs/Express bees claim.json.
const AUTH_HOST = "https://auth.xbees.in";
const AUTH_SERVICE_HOST = "https://authservice.xbees.in";
const CLIENT_SHIP_HOST = "https://clientshipupdatesapi.xbees.in";
const XBM_MASTER_HOST = "https://xbmasterapi.xbees.in";
const DEFAULT_REALM = "xpressbees";
const DEFAULT_CLIENT_ID = "client-portal-ui";
const TOKEN_URL = (realm) => `${AUTH_HOST}/realms/${realm}/protocol/openid-connect/token`;
// A cheap authenticated call the portal makes on every page: used as probe.
const PROBE_URL = `${AUTH_SERVICE_HOST}/token?clients=b2cxpress,fms-service`;

const REFRESH_BEFORE_EXPIRY_SEC = 60;

function isSessionCacheEnabled() {
    // A process with no database access can never persist, and no environment
    // variable may override that. See common/sessionPersistence.js.
    if (!isSessionPersistenceEnabled()) return false;
    if (process.env.XBEES_SESSION_SAVE === "false") return false;
    if (process.env.XBEES_SESSION_CACHE === "false") return false;
    return true;
}


function isUsableRecord(r) { return !!(r && r.accessToken && r.refreshToken && r.realm); }
function computeExpiry() { return new Date(Date.now() + XBEES_SESSION_EXPIRY_HOURS * 60 * 60 * 1000); }
function tokenNearlyExpired(r) {
    if (!r?.accessExpiresAt) return true;
    return new Date(r.accessExpiresAt).getTime() - Date.now() <= REFRESH_BEFORE_EXPIRY_SEC * 1000;
}


async function saveSession({
    credentialId, username,
    accessToken, refreshToken, accessExpiresIn,
    idToken = null, tokenType = "Bearer",
    realm = DEFAULT_REALM, clientId = DEFAULT_CLIENT_ID,
    source = "unknown",
}) {
    if (!isSessionCacheEnabled()) return false;
    if (!accessToken || !refreshToken || !realm) {
        console.warn(`⚠️ [xbees/sessionStore] Refusing incomplete session for ${username}`);
        return false;
    }
    const matcher = buildMatchers({ credentialId, username });
    if (!matcher) return false;

    const accessExpiresAt = new Date(Date.now() + (Number(accessExpiresIn) || 7200) * 1000).toISOString();
    const expiresAt = computeExpiry();
    const record = {
        accessToken, accessExpiresAt, refreshToken, tokenType, idToken,
        realm, clientId,
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
                `💾 [xbees/sessionStore] Cached session for ${username} ` +
                `(access ${Number(accessExpiresIn) || 7200}s, record ~${hrs}h)`
            );
            return true;
        }
        console.warn(`⚠️ [xbees/sessionStore] No credential matched ${matcher.label}`);
        return false;
    } catch (err) {
        console.warn(`⚠️ [xbees/sessionStore] Save failed for ${username}: ${err.message}`);
        return false;
    }
}

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
        const xbees = platforms.find((p) => {
            const n = (p?.eComPlatform || "").toLowerCase().trim();
            return n === "xbees" || n === "expressbees" || n === "xpressbees";
        });
        const cred = (Array.isArray(xbees?.info) ? xbees.info : []).find(matcher.matches);
        const record = cred?.[SESSION_FIELD];
        if (!isUsableRecord(record)) return null;
        if (record.expiresAt && new Date(record.expiresAt).getTime() <= Date.now()) {
            console.log(`⏰ [xbees/sessionStore] Cached session for ${username} expired`);
            return null;
        }
        return record;
    } catch (err) {
        console.warn(`⚠️ [xbees/sessionStore] Load failed for ${username}: ${err.message}`);
        return null;
    }
}

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
        console.log(`🗑️ [xbees/sessionStore] Cleared for ${username}${reason ? ` (${reason})` : ""}`);
        return true;
    } catch (err) {
        console.warn(`⚠️ [xbees/sessionStore] Clear failed: ${err.message}`);
        return false;
    }
}

async function refreshAccessToken(record) {
    try {
        const url = TOKEN_URL(record.realm || DEFAULT_REALM);
        const body = new URLSearchParams({
            grant_type: "refresh_token",
            refresh_token: record.refreshToken,
            client_id: record.clientId || DEFAULT_CLIENT_ID,
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
            console.log(`🔄 [xbees/sessionStore] Refresh rejected (HTTP ${res.status})`);
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
        console.log(`🔄 [xbees/sessionStore] Refresh failed (${err.message})`);
        return null;
    }
}

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
            console.log(`🩺 [xbees/sessionStore] Probe rejected (HTTP ${res.status})`);
            return false;
        }
        return true;
    } catch (err) {
        console.log(`🩺 [xbees/sessionStore] Probe failed (${err.message})`);
        return false;
    }
}

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
            accessExpiresAt: new Date(Date.now() + (Number(refreshed.accessExpiresIn) || 7200) * 1000).toISOString(),
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
                clientId: record.clientId,
                source: "refresh",
            });
        } catch (_) { /* best effort */ }
    }
    if (!(await probeSession(currentRecord))) {
        console.log(`↩️ [xbees/sessionStore] Cached session for ${cacheKey.username} did not pass probe`);
        return null;
    }
    console.log(`♻️ [xbees/sessionStore] Reusing session for ${cacheKey.username}`);
    return {
        accessToken: currentRecord.accessToken,
        refreshToken: currentRecord.refreshToken,
        tokenType: currentRecord.tokenType || "Bearer",
        realm: currentRecord.realm || DEFAULT_REALM,
        clientId: currentRecord.clientId || DEFAULT_CLIENT_ID,
        idToken: currentRecord.idToken,
    };
}

module.exports = {
    isSessionCacheEnabled,
    saveSession, loadSession, clearSession,
    refreshAccessToken, probeSession, getUsableSession,
    SESSION_FIELD,
    AUTH_HOST, AUTH_SERVICE_HOST, CLIENT_SHIP_HOST, XBM_MASTER_HOST,
    DEFAULT_REALM, DEFAULT_CLIENT_ID, TOKEN_URL, PROBE_URL,
    REFRESH_BEFORE_EXPIRY_SEC,
};
