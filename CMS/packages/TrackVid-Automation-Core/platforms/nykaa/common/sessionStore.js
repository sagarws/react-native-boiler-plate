// -----------------------------------------------------------------------------
// Nykaa session cache — dispute-portal cookie jar (Zoho Desk)
// -----------------------------------------------------------------------------
// Nykaa's dispute portal (https://dispute.nykaa.com) is a Zoho Desk instance
// with Zoho IAM login behind an iframe. The password is client-side encrypted
// with a public key from /getPayloadEncryptionPublicKey — reversing that in
// Node isn't practical, so Puppeteer bootstraps the login (see the runner's
// utils.js:loginNykaa) and this file caches the resulting cookie jar.
//
// READS after login are cookie-signed. WRITES are not: Zoho guards them with a
// double-submit CSRF token — a value that lives in a cookie and must be echoed
// in an X-ZCSRF-TOKEN header. This file used to say "no CSRF, so the cached jar
// is enough", and that sentence was the bug: a jar with no CSRF cookie passes
// every probe, gets reused forever, and is refused on the first ticket it tries
// to raise with a 401 that reads exactly like a dead session.
//
// So "usable" here means CAN WRITE, not "can read" — see canWrite below.
//
// Stored beside `masterDataSync`:
//   companies.settings.eCommercePlatformLoginInfo[<nykaa>].info[<cred>].nykaaSession = {
//       jar:       { <cookie name>: <value>, ... },
//       portalId:  "edbsn...",          // discovered from /portal/api/me
//       userId:    "77727000983697274", // Zoho user id (from /me response)
//       savedAt, expiresAt, source,
//   }
//
// Enable with NAYKAA_SESSION_SAVE=true; legacy NAYKAA_SESSION_CACHE=false
// disables (transition alias).
// -----------------------------------------------------------------------------

const axios = require("axios");
const { connectDB } = require("../../../common/db");
const { NAYKAA_SESSION_EXPIRY_HOURS } = require("../../../common/constants");

const SESSION_FIELD = "nykaaSession";
// Nykaa's platform slug in the DB is inconsistent — some rows use "nykaa",
// some use the misspelled "naykaa". Accept both.
const PLATFORM_REGEX = { $regex: "^(nykaa|naykaa)$", $options: "i" };

const { companiesCollection, cookieHeader, makeBuildMatchers } = require("../../../common/sessionHelpers");
const { isSessionPersistenceEnabled } = require("../../../common/sessionPersistence.js");

// Platform-specific: the eComPlatform matcher this store scopes every query to.
const buildMatchers = makeBuildMatchers(PLATFORM_REGEX);
const ORIGIN = "https://dispute.nykaa.com";
const PROBE_TIMEOUT_MS = 20_000;
const MIN_COOKIES = 1;

function isSessionCacheEnabled() {
    // A process with no database access can never persist, and no environment
    // variable may override that. See common/sessionPersistence.js.
    if (!isSessionPersistenceEnabled()) return false;
    if (process.env.NAYKAA_SESSION_SAVE === "false") return false;
    if (process.env.NAYKAA_SESSION_CACHE === "false") return false;
    return true;
}


function isUsableRecord(r) {
    return !!(r && r.jar && Object.keys(r.jar).length >= MIN_COOKIES);
}

function computeExpiry() {
    return new Date(Date.now() + NAYKAA_SESSION_EXPIRY_HOURS * 60 * 60 * 1000);
}


async function saveSession({ credentialId, username, jar, portalId = null, userId = null, source = "unknown" }) {
    if (!isSessionCacheEnabled()) return false;
    if (!isUsableRecord({ jar })) {
        console.warn(`⚠️ [nykaa/sessionStore] Refusing to cache empty jar for ${username}`);
        return false;
    }
    const matcher = buildMatchers({ credentialId, username });
    if (!matcher) return false;
    const expiresAt = computeExpiry();
    const record = {
        jar, portalId, userId,
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
                `💾 [nykaa/sessionStore] Cached session for ${username} ` +
                `(${Object.keys(jar).length} cookies, portalId=${portalId}, valid ~${hrs}h)`
            );
            return true;
        }
        console.warn(`⚠️ [nykaa/sessionStore] No credential matched ${matcher.label}`);
        return false;
    } catch (err) {
        console.warn(`⚠️ [nykaa/sessionStore] Save failed for ${username}: ${err.message}`);
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
        const nykaa = platforms.find((p) => {
            const n = (p?.eComPlatform || "").toLowerCase().trim();
            return n === "nykaa" || n === "naykaa";
        });
        const cred = (Array.isArray(nykaa?.info) ? nykaa.info : []).find(matcher.matches);
        const record = cred?.[SESSION_FIELD];
        if (!isUsableRecord(record)) return null;
        if (record.expiresAt && new Date(record.expiresAt).getTime() <= Date.now()) {
            console.log(`⏰ [nykaa/sessionStore] Cached session for ${username} expired`);
            return null;
        }
        return record;
    } catch (err) {
        console.warn(`⚠️ [nykaa/sessionStore] Load failed for ${username}: ${err.message}`);
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
        console.log(`🗑️ [nykaa/sessionStore] Cleared for ${username}${reason ? ` (${reason})` : ""}`);
        return true;
    } catch (err) {
        console.warn(`⚠️ [nykaa/sessionStore] Clear failed: ${err.message}`);
        return false;
    }
}

// Probe: GET /portal/api/me?portalId=<PORTAL_ID> — cheap authenticated call
// that fires on every dashboard page load. 200 with the user record on live
// session; 401 / 302 to /signin on a dead one.
async function probeSession(record) {
    if (!record.portalId) {
        console.log("🩺 [nykaa/sessionStore] Probe skipped — no portalId cached (treat as dead)");
        return false;
    }
    try {
        const res = await axios.get(
            `${ORIGIN}/portal/api/me?portalId=${encodeURIComponent(record.portalId)}`,
            {
                headers: {
                    accept: "application/json, text/plain, */*",
                    Referer: `${ORIGIN}/portal/en/myarea`,
                    cookie: cookieHeader(record.jar),
                },
                maxRedirects: 0,
                validateStatus: () => true,
                timeout: PROBE_TIMEOUT_MS,
            }
        );
        if (res.status !== 200) {
            console.log(`🩺 [nykaa/sessionStore] Probe rejected (HTTP ${res.status})`);
            return false;
        }
        const body = res.data;
        if (!body || typeof body !== "object") {
            console.log("🩺 [nykaa/sessionStore] Probe body empty — session dead");
            return false;
        }
        return true;
    } catch (err) {
        console.log(`🩺 [nykaa/sessionStore] Probe failed (${err.message})`);
        return false;
    }
}

// -----------------------------------------------------------------------------
// 🔐 The CSRF cookie
// -----------------------------------------------------------------------------
// Zoho does not name these consistently, and we have seen both conventions on
// this one portal: the IAM sign-in sends `X-ZCSRF-TOKEN: iamcsrcoo=<uuid>`,
// where the header's parameter name IS the cookie name, while the ticket write
// sends `crmcsrfparam=<128 hex>`, where by Zoho's CRM convention it is not.
//
// Rather than hard-code one guess and fail with a 401 an hour into a batch,
// resolve it from the jar against the names Zoho is known to use. The explicit
// env override is tried first, so a live capture can correct this without a
// code change.
// zd_hccsr is FIRST because it is the one we have actually verified: in a
// working POST /portal/api/tickets, the X-ZCSRF-TOKEN value is byte-for-byte
// the zd_hccsr cookie. It is Zoho Desk's HELP CENTER csrf cookie — which is
// what this portal is — and it is not the same as the account cookies (`iamcsr`)
// the sign-in uses, nor the `crmcsr` that Zoho CRM uses. Those stay in the list
// below only as fallbacks for other Zoho products.
//
// The header PARAMETER is a separate name and does not follow the cookie:
// the same verified request sends `crmcsrfparam=<the zd_hccsr value>`.
const CSRF_COOKIE_CANDIDATES = [
    process.env.NAYKAA_CSRF_COOKIE,
    "zd_hccsr",
    "crmcsr",
    "deskcsr",
    "zd_csrf",
    "crmcsrfparam",
].filter(Boolean);

// IAM cookies. Present in every jar because they come from the sign-in, and
// NOT what a Desk write is signed with — matching one of these would send a
// confidently wrong token. Only ever used as a last resort, and named in the
// log when they are.
const IAM_CSRF_CANDIDATES = ["iamcsr", "iamcsrcoo"];

/**
 * The CSRF cookie in this jar, or null.
 *
 * Explicit names first, then a shape-based fallback so a rename costs a log
 * line rather than another failed batch: any cookie that looks like a CSRF
 * token and is not an IAM one, longest value first (the Desk token is 128 hex
 * characters; IAM's is a 36-character UUID).
 *
 * @returns {{name: string, value: string}|null}
 */
function resolveCsrfCookie(jar) {
    if (!jar || typeof jar !== "object") return null;

    for (const name of CSRF_COOKIE_CANDIDATES) {
        if (jar[name]) return { name, value: jar[name] };
    }

    const guessed = Object.keys(jar)
        .filter((name) => {
            const lower = name.toLowerCase();
            return lower.includes("csr") && !IAM_CSRF_CANDIDATES.includes(lower) && !lower.startsWith("iam");
        })
        .sort((a, b) => String(jar[b]).length - String(jar[a]).length)[0];

    if (guessed) {
        console.warn(
            `⚠️ [nykaa/sessionStore] No known CSRF cookie in the jar; falling back to "${guessed}" ` +
            "because it looks like one. If writes still fail, set NAYKAA_CSRF_COOKIE explicitly."
        );
        return { name: guessed, value: jar[guessed] };
    }

    for (const name of IAM_CSRF_CANDIDATES) {
        if (jar[name]) {
            console.warn(
                `⚠️ [nykaa/sessionStore] Only the IAM cookie "${name}" is present — that signs the SIGN-IN, ` +
                "not a Desk write, so this will probably be refused. Re-capture the session."
            );
            return { name, value: jar[name] };
        }
    }

    return null;
}

/**
 * Can this jar do more than read?
 *
 * The distinction the old code missed. A session that answers /portal/api/me
 * with a 200 has proved only that it can READ — reads are not CSRF-guarded — so
 * probing is not enough to decide a session is worth keeping for a claim.
 */
function canWrite(jar) {
    return resolveCsrfCookie(jar) !== null;
}

async function getUsableSession({ credentialId, username }) {
    const record = await loadSession({ credentialId, username });
    if (!record) return null;

    // Checked BEFORE the probe: the probe is a network round-trip, and a jar
    // that cannot write is not worth one. Discarded rather than merely skipped,
    // so the next run does not read the same dead row back out of the database
    // and make the same call again.
    if (!canWrite(record.jar)) {
        console.log(
            `↩️ [nykaa/sessionStore] Cached session for ${username} carries no CSRF cookie ` +
            `(tried ${CSRF_COOKIE_CANDIDATES.join(", ")}) — it can read but cannot raise a ticket. ` +
            `Discarding it and signing in fresh. Cookies present: ${Object.keys(record.jar || {}).join(", ") || "none"}`
        );
        await clearSession({ credentialId, username }, "no CSRF cookie — cannot write");
        return null;
    }

    if (!(await probeSession(record))) {
        console.log(`↩️ [nykaa/sessionStore] Cached session for ${username} did not pass probe`);
        return null;
    }
    console.log(`♻️ [nykaa/sessionStore] Reusing session for ${username}`);
    return {
        jar: record.jar,
        portalId: record.portalId,
        userId: record.userId,
    };
}

module.exports = {
    isSessionCacheEnabled,
    saveSession, loadSession, clearSession, probeSession, getUsableSession,
    cookieHeader, canWrite, resolveCsrfCookie, CSRF_COOKIE_CANDIDATES, IAM_CSRF_CANDIDATES,
    SESSION_FIELD, ORIGIN,
};
