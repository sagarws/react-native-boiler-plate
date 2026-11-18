// -----------------------------------------------------------------------------
// Meesho session cache — persist the supplier-portal cookie jar per credential
// -----------------------------------------------------------------------------
// Same cookie-jar template as Snapdeal (no CSRF token, no JWT). Puppeteer
// runs the two-step email+password login once per credential and this file
// caches the harvested jar; every subsequent run reuses it and skips the
// browser entirely.
//
// Stored beside `masterDataSync`:
//   companies.settings.eCommercePlatformLoginInfo[<meesho>].info[<cred>].meeshoSession = {
//       jar:       { <cookie name>: <value>, ... },
//       supplierId: 4647393,     // from prefetch-supply-data — see common/supplierIdentity.js
//       supplierIdentifier: "e18ek",  // the `identifier` header every panel call needs
//       savedAt, expiresAt, source,
//   }
//
// Reuse gate:
//   MEESHO_SESSION_SAVE=true   → enable (new positive flag, matches AJIO/Snapdeal)
//   MEESHO_SESSION_CACHE=false → disable (legacy inverted flag, still honoured)
// -----------------------------------------------------------------------------

const axios = require("axios");
const { connectDB } = require("../../../common/db");
const { MEESHO_SESSION_EXPIRY_HOURS } = require("../../../common/constants");

const SESSION_FIELD = "meeshoSession";
const PLATFORM_REGEX = { $regex: "^meesho$", $options: "i" };

const { companiesCollection, cookieHeader, makeBuildMatchers } = require("../../../common/sessionHelpers");
const { isSessionPersistenceEnabled } = require("../../../common/sessionPersistence.js");

// Platform-specific: the eComPlatform matcher this store scopes every query to.
const buildMatchers = makeBuildMatchers(PLATFORM_REGEX);
const ORIGIN = "https://supplier.meesho.com";
const PROBE_TIMEOUT_MS = 20_000;

const MIN_COOKIES = 1;

function isSessionCacheEnabled() {
    // A process with no database access can never persist, and no environment
    // variable may override that. See common/sessionPersistence.js.
    if (!isSessionPersistenceEnabled()) return false;
    if (process.env.MEESHO_SESSION_SAVE === "false") return false;
    if (process.env.MEESHO_SESSION_CACHE === "false") return false;
    return true;
}


function isUsableRecord(r) {
    return !!(r && r.jar && Object.keys(r.jar).length >= MIN_COOKIES);
}

function computeExpiry() {
    return new Date(Date.now() + MEESHO_SESSION_EXPIRY_HOURS * 60 * 60 * 1000);
}


async function saveSession({ credentialId, username, jar, supplierId = null, supplierIdentifier = null, source = "unknown" }) {
    if (!isSessionCacheEnabled()) return false;
    if (!isUsableRecord({ jar })) {
        console.warn(`⚠️ [meesho/sessionStore] Refusing to cache empty jar for ${username}`);
        return false;
    }
    const matcher = buildMatchers({ credentialId, username });
    if (!matcher) return false;

    const expiresAt = computeExpiry();
    const record = {
        jar,
        supplierId,
        supplierIdentifier,
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
                `💾 [meesho/sessionStore] Cached session for ${username} ` +
                `(${Object.keys(jar).length} cookies, supplierId=${supplierId}, valid ~${hrs}h)`
            );
            return true;
        }
        console.warn(`⚠️ [meesho/sessionStore] No credential matched ${matcher.label}`);
        return false;
    } catch (err) {
        console.warn(`⚠️ [meesho/sessionStore] Save failed for ${username}: ${err.message}`);
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
        const meesho = platforms.find((p) => (p?.eComPlatform || "").toLowerCase().trim() === "meesho");
        const cred = (Array.isArray(meesho?.info) ? meesho.info : []).find(matcher.matches);
        const record = cred?.[SESSION_FIELD];
        if (!isUsableRecord(record)) return null;
        if (record.expiresAt && new Date(record.expiresAt).getTime() <= Date.now()) {
            console.log(`⏰ [meesho/sessionStore] Cached session for ${username} expired`);
            return null;
        }
        return record;
    } catch (err) {
        console.warn(`⚠️ [meesho/sessionStore] Load failed for ${username}: ${err.message}`);
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
        console.log(`🗑️ [meesho/sessionStore] Cleared for ${username}${reason ? ` (${reason})` : ""}`);
        return true;
    } catch (err) {
        console.warn(`⚠️ [meesho/sessionStore] Clear failed: ${err.message}`);
        return false;
    }
}

// Is this session alive?
//
// Asked with prefetch-supply-data, which is also the call that says WHO the
// session is. Two reasons it is the right probe and supplier/config was not:
//
//   • supplier/config answers 403 "Identifier not present or invalid" when the
//     record carries no identifier — a live session reported dead, and then a
//     sign-in that stored no identifier either, for ever.
//   • this one needs nothing but the cookies, and hands back the supplierId and
//     the slug, so a jar-only session is repaired instead of replaced.
//
// The browser headers are not optional. With no user-agent Meesho's CDN answers
// 403 "Access Denied" before Meesho sees the request; without client-type it
// answers 400 "Invalid client type". Verified against the live endpoint with no
// cookies at all, where the correct answer is 463 "Token missing".
async function probeSession(record) {
    const { fetchSupplierIdentity } = require("./supplierIdentity.js");

    try {
        // No headers of our own: the identity endpoint takes client-type `web`
        // and no client-package-version, and the panel's set is answered by the
        // edge with 403 "Access Denied" — a live session reported dead.
        const identity = await fetchSupplierIdentity(record, { timeout: PROBE_TIMEOUT_MS });

        if (identity.supplierId === null) {
            console.log("🩺 [meesho/sessionStore] Probe answered without a supplier id — session dead");
            return false;
        }
        return true;
    } catch (err) {
        // The identity call reports the HTTP status on the error, so the line
        // says which kind of "no" this was.
        console.log(`🩺 [meesho/sessionStore] Probe rejected (${err.message.slice(0, 120)})`);
        return false;
    }
}

async function getUsableSession({ credentialId, username }) {
    const record = await loadSession({ credentialId, username });
    if (!record) return null;
    if (!(await probeSession(record))) {
        console.log(`↩️ [meesho/sessionStore] Cached session for ${username} did not pass probe`);
        return null;
    }
    console.log(`♻️ [meesho/sessionStore] Reusing session for ${username}`);
    return {
        jar: record.jar,
        supplierId: record.supplierId,
        supplierIdentifier: record.supplierIdentifier,
    };
}

module.exports = {
    isSessionCacheEnabled,
    saveSession, loadSession, clearSession, probeSession, getUsableSession,
    cookieHeader,
    SESSION_FIELD, ORIGIN,
};
