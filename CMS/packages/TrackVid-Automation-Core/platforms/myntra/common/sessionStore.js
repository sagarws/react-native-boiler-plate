// -----------------------------------------------------------------------------
// Myntra session cache — persist the post-login cookie jar per credential
// -----------------------------------------------------------------------------
// Both API runners (myntraAutoClaim/claimApiFlow.loginMyntraApi and
// myntraMasterData/utils/apiReportFlow.loginMyntra) launch a VISIBLE Chrome for
// the sole purpose of harvesting two cookies — `erp.at` and `session` — then
// destroy the driver and do everything else over HTTP. That login costs ~30-60s
// per account and carries the whole Akamai / robotjs / stale-element failure
// surface.
//
// This module stores that jar on the credential itself, next to `masterDataSync`:
//
//   companies.settings.eCommercePlatformLoginInfo[<myntra>].info[<cred>].myntraSession = {
//       jar:          { "erp.at": "...", "session": "..." },
//       savedAt:      "2026-08-17T09:12:44.001Z",
//       expiresAt:    "2026-08-24T09:12:44.001Z",   // savedAt + MYNTRA_SESSION_EXPIRY_HOURS
//       ip:           "185.96.81.146",              // egress IP the jar was minted on
//       proxySession: "mp_account10_arvindbrands_co_in",
//       source:       "claim-api" | "masterdata-api",
//   }
//
// Reuse is deliberately conservative — a cached jar is only used when it is
// (a) present, (b) not past `expiresAt`, (c) minted on the same egress IP we're
// running on now, and (d) still answers a live probe request. Any doubt and we
// fall through to the normal Selenium login, which overwrites the cache. Worst
// case this costs one extra HTTP round-trip; it can never make a run fail that
// would otherwise have succeeded.
//
// Disable at runtime with MYNTRA_SESSION_CACHE=false.
// -----------------------------------------------------------------------------

const axios = require("axios");
const { connectDB } = require("../../../common/db");
const { MYNTRA_SESSION_EXPIRY_HOURS } = require("../../../common/constants");

const SESSION_FIELD = "myntraSession";
const BOOT_URL = "https://partnersapi.myntrainfo.com/api/boot/partners";
const PROBE_TIMEOUT_MS = 20_000;

// Cookies Myntra's partnersapi actually authenticates with. A cached jar
// missing either is worthless, so we never store or trust one.
const REQUIRED_COOKIES = ["erp.at", "session"];

// Session lifetime, from src/constants/common.js. MYNTRA_SESSION_TTL_MINUTES is
// no longer read — one knob, in code, so this path and TrackVid-BE's extension
// ingest cannot drift apart again.
const SESSION_TTL_MS = MYNTRA_SESSION_EXPIRY_HOURS * 60 * 60 * 1000;

const { companiesCollection, cookieHeader, makeBuildMatchers } = require("../../../common/sessionHelpers");
const { isSessionPersistenceEnabled } = require("../../../common/sessionPersistence.js");

// Platform-specific: the eComPlatform matcher this store scopes every query to.
// Myntra spelled this as a $regex object rather than a literal; both reach
// arrayFilters unchanged, so the behaviour is the same.
const PLATFORM_REGEX = { $regex: "^myntra$", $options: "i" };
const buildMatchers = makeBuildMatchers(PLATFORM_REGEX);

function isSessionCacheEnabled() {
    // A process with no database access can never persist, and no environment
    // variable may override that. See common/sessionPersistence.js.
    if (!isSessionPersistenceEnabled()) return false;
    return process.env.MYNTRA_SESSION_CACHE !== "false";
}


/** A trimmed string, or "" — the boot payload mixes strings, numbers and nulls. */
function str(value) {
    return typeof value === "string" ? value.trim() : "";
}

function hasRequiredCookies(jar) {
    return !!jar && REQUIRED_COOKIES.every((name) => !!jar[name]);
}


// Flat lifetime from MYNTRA_SESSION_EXPIRY_HOURS. The erp.at JWT's own `exp` is
// not consulted — see the constant for why.
function computeExpiry() {
    return new Date(Date.now() + SESSION_TTL_MS);
}

// ---------------------------
// 🔎 Locating the credential
// ---------------------------
// Prefer the credential's own _id (present on claim-flow credentials — see the
// info[]._id in the companies doc); fall back to the username for callers that
// only carry an email (apiReportFlow.loginMyntra takes email + password).
// The same Myntra account can legitimately sit under more than one company, so
// writes use updateMany and reads take the first match.


// ---------------------------
// 💾 Save
// ---------------------------
// Called after a successful Selenium login. Never throws — a cache write that
// fails must not fail the run that just logged in successfully.
async function saveSession({ credentialId, username, jar, ip = null, proxySession = null, source = "unknown" }) {
    if (!isSessionCacheEnabled()) return false;
    if (!hasRequiredCookies(jar)) {
        console.warn(`⚠️ [sessionStore] Refusing to cache jar without ${REQUIRED_COOKIES.join(" + ")} for ${username}`);
        return false;
    }

    const matcher = buildMatchers({ credentialId, username });
    if (!matcher) return false;

    const expiresAt = computeExpiry();
    const record = {
        jar,
        savedAt: new Date().toISOString(),
        expiresAt: expiresAt.toISOString(),
        ip,
        proxySession,
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
            const mins = Math.round((expiresAt.getTime() - Date.now()) / 60000);
            console.log(`💾 [sessionStore] Cached Myntra session for ${username} (valid ~${mins}m, ip=${ip || "n/a"})`);
            return true;
        }
        console.warn(`⚠️ [sessionStore] No credential matched ${matcher.label} — session not cached`);
        return false;
    } catch (err) {
        console.warn(`⚠️ [sessionStore] Save failed for ${username}: ${err.message}`);
        return false;
    }
}

// ---------------------------
// 📤 Load
// ---------------------------
// Returns the stored record, or null when there's nothing usable. Expiry is
// checked here; liveness is checked by probeSession (one HTTP call), so callers
// can decide whether the probe is worth it.
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
        const myntra = platforms.find(
            (p) => (p?.eComPlatform || "").toLowerCase().trim() === "myntra"
        );
        const cred = (Array.isArray(myntra?.info) ? myntra.info : []).find(matcher.matches);
        const record = cred?.[SESSION_FIELD];

        if (!record || !hasRequiredCookies(record.jar)) return null;

        if (record.expiresAt && new Date(record.expiresAt).getTime() <= Date.now()) {
            console.log(`⏰ [sessionStore] Cached session for ${username} expired at ${record.expiresAt}`);
            return null;
        }
        return record;
    } catch (err) {
        console.warn(`⚠️ [sessionStore] Load failed for ${username}: ${err.message}`);
        return null;
    }
}

// ---------------------------
// 🗑️ Clear
// ---------------------------
// Called when a jar is proven dead (401/403 mid-batch) so the next run doesn't
// retry the same corpse.
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
        console.log(`🗑️ [sessionStore] Cleared cached session for ${username}${reason ? ` (${reason})` : ""}`);
        return true;
    } catch (err) {
        console.warn(`⚠️ [sessionStore] Clear failed for ${username}: ${err.message}`);
        return false;
    }
}

// ---------------------------
// 🩺 Probe
// ---------------------------
// "Not expired" is not the same as "works", so we ask Myntra.
//
// IMPORTANT: /api/boot/partners answers 200 to ANYONE — with no cookies at all
// it still returns the portal's static config (verified: bogus cookies → 200,
// `sellerType: []`, no partnerId). So an HTTP status check alone would pass
// every dead jar. What separates a live session is the identity block: a real
// session carries partnerId/sellerId and a non-empty sellerType — precisely the
// fields getPartnerBoot reads and scheduleReport refuses to run without.
// Anything else (401/403, network error, anonymous payload) is treated as dead
// so we fall back to the login we know works.
//
// TAKES A RECORD, not a bare jar — `{ jar, savedAt, source, ... }`, the same
// shape every other platform's probeSession takes and the shape
// common/probeSession.js passes (`probe({ jar, ...extra })`).
//
// This one took the jar, and the mismatch was silent in the worst way: the
// record went to `cookieHeader`, which turned it into
// `jar=[object Object]; source=claim-api; savedAt=...`. Myntra answers 200 to
// anyone, so that malformed header came back as the ANONYMOUS boot payload —
// and the probe reported "session is dead" for every session it was ever
// given. On the desktop that meant a Selenium login on every master import
// while the automation server, which calls this with a bare jar, reused the
// very same session minutes earlier.
//
// A bare jar is still accepted so the internal caller below and any older
// call site keep working; a record is detected by its `jar` property.
async function probeSession(input) {
    const jar = input && typeof input === "object" && input.jar ? input.jar : input;

    try {
        const res = await axios.get(BOOT_URL, {
            headers: {
                accept: "*/*",
                origin: "https://partners.myntrainfo.com",
                referer: "https://partners.myntrainfo.com/",
                "x-myntra-app-name": "partners",
                "x-myntra-knuth": "yes",
                "x-requested-with": "XMLHttpRequest",
                cookie: cookieHeader(jar),
            },
            validateStatus: () => true,
            timeout: PROBE_TIMEOUT_MS,
        });

        if (res.status !== 200) {
            console.log(`🩺 [sessionStore] Probe rejected cached session (HTTP ${res.status})`);
            return false;
        }

        // WHO IT NAMES, not what kind of partner it is. A VENDOR account
        // (partnerType VENDOR, partnerCode DYVY, partnerId 14880, sellerId 0)
        // has an EMPTY sellerType, because sellerType classifies sellers —
        // PPMP, FBM, SJIT — and a vendor is not one. Requiring it here refused
        // every vendor account on the platform while the boot payload was
        // naming the signed-in user on the very same line. Same rule as
        // common/sessionIdentity, which is the one the desktop asks first.
        const d = res.data || {};
        const user = d.user && typeof d.user === "object" ? d.user : {};
        const named = str(user.loginId) || str(user.uidx) || str(user.email);
        // `sellerId: 0` is "not a seller", not an id. Coerced because the
        // payload sends partnerId as a string and sellerId as a number.
        const id = (value) => (typeof value === "number" ? String(value) : str(value));
        const partner = id(d.partnerId) || id(d.partnerCode) || (d.sellerId ? id(d.sellerId) : "");

        if (!named || !partner) {
            console.log(
                "🩺 [sessionStore] Probe got the anonymous boot payload (it names no user) — session is dead"
            );
            return false;
        }
        return true;
    } catch (err) {
        console.log(`🩺 [sessionStore] Probe failed (${err.message}) — treating session as dead`);
        return false;
    }
}

// Convenience wrapper used by both login functions: load → IP check → probe.
// Returns a usable jar or null. `currentIp` is optional; when the caller knows
// the egress IP it will run on, a jar minted elsewhere is rejected up front
// (Myntra can bind a session to the IP that created it, and a rejected reuse
// costs a wasted probe at best, a confusing mid-batch 401 at worst).
async function getUsableSession({ credentialId, username, currentIp = null }) {
    const record = await loadSession({ credentialId, username });
    if (!record) return null;

    if (currentIp && record.ip && record.ip !== currentIp) {
        console.log(
            `🌍 [sessionStore] Cached session for ${username} was minted on ${record.ip}, now on ${currentIp} — ignoring it`
        );
        return null;
    }

    if (!(await probeSession(record.jar))) {
        await clearSession({ credentialId, username }, "failed liveness probe");
        return null;
    }

    const leftMin = record.expiresAt
        ? Math.round((new Date(record.expiresAt).getTime() - Date.now()) / 60000)
        : null;
    console.log(
        `♻️ [sessionStore] Reusing cached Myntra session for ${username} — skipping browser login` +
        (leftMin !== null ? ` (~${leftMin}m left)` : "")
    );
    return record.jar;
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
