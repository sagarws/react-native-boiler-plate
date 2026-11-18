/**
 * Myntra Partners — direct-API report flow.
 *
 * Replaces the Selenium UI navigation (Store/Partner Type/Report dropdowns +
 * date picker + Generate button) with the same JSON APIs the portal calls.
 *
 * Auth is HYBRID: Selenium bootstraps cookies (Akamai on accounts.myntra.com
 * hard-blocks Node's TLS fingerprint — verified: POST /emaillogin never returns),
 * then we hand those cookies to axios for everything else. The partnersapi
 * subdomain accepts axios calls fine once you carry a real session.
 *
 * Flow:
 *   loginMyntra(email, password) → cookieJar  (uses utils.buildDriverAndLogin)
 *   getPartnerBoot(jar)          → { partnerId, sellerType, storeId, ... }
 *   scheduleReport(jar, opts)    → { jobId }
 *   pollJob(jar, jobId)          → { successFile }
 *   downloadReport(jar, url)     → { buffer, contentType }
 *
 * Cookies are managed as a simple {name:value} bag — every call after login
 * is to partnersapi.myntrainfo.com so we don't need domain/path scoping.
 */

const dayjs = require("dayjs");
const axios = require("axios");
// Login uses the CLAIM folder's helpers (../../myntraAutoClaim/utils) — same
// browser launch + form-fill + Network-Error retry + Bright Data proxy path
// as myntraAutoClaim. Keeps API-base master-data login byte-identical to the
// claim automation login (single source of truth), independent of the master-
// data folder's own utils.js used by the old Selenium UI flow (script.js).
const { buildDriverAndLogin, destroyDriver } = require("../../claim-management/common/utils");

// Dumps the full response body of any >= 400 answer to the terminal. The
// throws below only carry an HTTP code (and at most a 300-char slice), which
// is not enough to tell WHY partnersapi refused the report.
const { logHttpError } = require("../../common/httpLog");

// Shared per-credential cookie-jar cache (companies doc). Same store the claim
// runner uses, so a session minted by either flow serves both.
const { getUsableSession, saveSession, clearSession } = require("../../common/sessionStore");

// The `cidx` is Myntra's OAuth client id for the Partners portal. Constant across
// all sellers — only the /emaillogin URL uses it; boot/schedule/poll/download don't care.
const MYNTRA_LOGIN_CIDX =
    process.env.MYNTRA_LOGIN_CIDX ||
    "partners_mdirect-bb952a4d-38dd-4e69-91c1-90be8e98ff29";

// After login, the browser is redirected to this partnersapi endpoint which sets
// the erp.at/erp.rt/session cookies. The `back=` param is where it eventually
// lands after the SSO handshake — Dashboard is fine; we don't read the HTML.
const PAGE_REQUESTED =
    "https://partnersapi.myntrainfo.com/api/user/login/partners?back=" +
    encodeURIComponent(
        "https://partners.myntrainfo.com/Dashboard?state=partners-login"
    );

/*
 * THE SAME IDENTITY THE CLAIM FLOW SENDS — see ../../common/browserIdentity.js.
 *
 * This file had a third answer: macOS Chrome 150, where the claim flow said 151
 * and the browser that minted the jar said whatever it actually was. Three
 * voices for one seller account, against a portal whose whole edge layer is
 * looking for exactly that.
 */
const { myntraBrowserIdentity } = require("../../common/browserIdentity.js");

const IDENTITY = myntraBrowserIdentity();

// A real Chrome UA is required — partnersapi trivially blocks obvious bots.
const UA = IDENTITY.userAgent;

// Chromium Client Hints — Akamai's bot layer inspects these. Sending nothing
// (as bare Node does) or a mismatched set can make the login POST hang.
const CLIENT_HINTS = {
    ...IDENTITY.headers,
    "sec-fetch-dest": "empty",
    "sec-fetch-mode": "cors",
    // Not the claim flow's "same-site": this one is partnersapi calling
    // partnersapi, and the value describes the request, not the browser.
    "sec-fetch-site": "same-origin",
    priority: "u=1, i",
};

// Per-request timeout. Login/download can legitimately take a while, so 60s.
// Prevents an Akamai stall from hanging the process indefinitely.
const REQ_TIMEOUT_MS = 60000;

// Toggle verbose progress logs during login/boot with MYNTRA_API_DEBUG=true.
const dbg = (...a) => {
    if (process.env.MYNTRA_API_DEBUG === "true") console.log("[myntra-api]", ...a);
};

// The store id for the MYNTRA marketplace. Present in the erp.at JWT payload
// (`storeId: "2297"`) — same for every seller, so a constant here is fine.
const MYNTRA_STORE_ID = 2297;

// portalReportName → reportId (from /report/jobs/search responses).
// storeList=["MYNTRA"] and partnerTypeList=["PPMP"] on all four verified reports.
const REPORT_IDS = {
    Seller_Orders_Report: 4,
    Seller_Returns_Report: 12,
    Seller_Listings_Report: 14,
    Seller_Inventory_Report: 16,
};

// MDirect variants (partnerType=MDIRECT). Populate reportId when we see one in
// the wild — the API is identical, only the reportId + partnerType change.
const MDIRECT_REPORT_IDS = {
    // MDirect_Returns_Report: <id>,
};

// -------- cookie jar (dumb {name:value} bag; single domain) --------

function parseSetCookie(headers) {
    const raw = headers || [];
    const list = Array.isArray(raw) ? raw : [raw];
    const out = [];
    for (const line of list) {
        if (!line) continue;
        const first = String(line).split(";")[0].trim();
        const eq = first.indexOf("=");
        if (eq === -1) continue;
        out.push({ name: first.slice(0, eq).trim(), value: first.slice(eq + 1).trim() });
    }
    return out;
}

function mergeCookies(jar, list) {
    for (const c of list) jar[c.name] = c.value;
    return jar;
}

function cookieHeader(jar) {
    return Object.entries(jar)
        .map(([k, v]) => `${k}=${v}`)
        .join("; ");
}

// Standard headers for every partnersapi XHR (matches the portal's own fetches).
// Includes Client Hints so Akamai treats us like a real Chrome, not a bot.
function apiHeaders(jar, extra) {
    return {
        "user-agent": UA,
        accept: "application/json, text/plain, */*",
        "accept-language": "en-US,en;q=0.9",
        origin: "https://partners.myntrainfo.com",
        referer: "https://partners.myntrainfo.com/",
        "x-myntra-app-name": "partners",
        "x-requested-with": "XMLHttpRequest",
        ...CLIENT_HINTS,
        "sec-fetch-site": "same-site",  // partners.myntrainfo.com → partnersapi.myntrainfo.com
        cookie: cookieHeader(jar),
        ...(extra || {}),
    };
}

// -------- login --------

/**
 * Log a seller in via Selenium (real browser), extract cookies, close the
 * browser, and return a jar usable by the other axios-based functions.
 *
 * Selenium is required because Akamai on accounts.myntra.com hard-blocks
 * pure Node HTTP at the TLS-handshake level — verified by empty 60s timeouts.
 * A real Chrome sails through. Once we have the session cookies, partnersapi
 * accepts axios requests fine (Akamai on the API subdomain is much more lax).
 *
 * Delegates to the CLAIM folder's buildDriverAndLogin — Chrome is always
 * visible (HEADLESS is hard-coded false there), Bright Data proxy is used
 * for mapped accounts, Network-Error retry is included. Same browser + login
 * behavior as the running myntraAutoClaim flow.
 */
async function loginMyntra(email, password, { forceFresh = false } = {}) {
    // Matched by username here — this entry point only receives email/password,
    // unlike the claim flow which also has the credential's _id.
    const cacheKey = { username: email };

    // A live jar from an earlier run (either flow — the claim runner writes to
    // the same record) means no browser at all.
    if (!forceFresh) {
        const cached = await getUsableSession(cacheKey);
        if (cached) return cached;
    } else {
        await clearSession(cacheKey, "forced fresh login");
    }

    dbg(`🌐 Selenium login for ${email}...`);
    const loginStart = Date.now();

    const { driver, sessionId, ip } = await buildDriverAndLogin(
        { username: email, password },
        {
            accountEmail: email,
            maxAttempts: 2,
            // Cookie bootstrap only — the driver is destroyed below and the
            // report flow is pure axios from there. No portal DOM is touched,
            // so the dashboard gate is skipped and the relationship-type modal
            // is best-effort rather than fatal.
            postLoginOptions: { dashboardGate: false, modalBestEffort: true },
        }
    );

    let jar = {};
    try {
        // After myntraLogin the browser is on partners.myntrainfo.com/Dashboard.
        // Cookies scoped to .myntrainfo.com (erp.at, erp.rt, session) are all
        // visible here — no need to navigate cross-subdomain.
        const seleniumCookies = await driver.manage().getCookies();
        for (const c of seleniumCookies) {
            if (c && c.name) jar[c.name] = c.value;
        }
        dbg(`  ← got ${Object.keys(jar).length} cookies from Selenium: ${Object.keys(jar).join(", ")}`);

        if (!jar["erp.at"] || !jar["session"]) {
            // Fallback: cookies for partnersapi.myntrainfo.com may be host-scoped
            // rather than domain-scoped — navigate there once so Selenium can
            // see and return them.
            dbg(`  → navigating to partnersapi to pick up host-scoped cookies...`);
            await driver.get("https://partnersapi.myntrainfo.com/api/boot/partners");
            await new Promise((r) => setTimeout(r, 1500));
            const more = await driver.manage().getCookies();
            for (const c of more) {
                if (c && c.name) jar[c.name] = c.value;
            }
            dbg(`  ← after partnersapi hop: ${Object.keys(jar).length} cookies (${Object.keys(jar).join(", ")})`);
        }
    } finally {
        try {
            await destroyDriver(driver);
        } catch (_) {
            /* driver may already be gone; ignore */
        }
    }

    if (!jar["erp.at"] || !jar["session"]) {
        const err = new Error(
            `Myntra login: missing required cookies after Selenium bootstrap. Got: ${Object.keys(jar).join(", ") || "(none)"}`
        );
        err.code = "LOGIN_NO_COOKIES";
        throw err;
    }
    dbg(`✅ Selenium login done in ${Date.now() - loginStart}ms`);

    // Cache for the next run / the claim flow. Best-effort by design.
    await saveSession({ ...cacheKey, jar, ip, proxySession: sessionId, source: "masterdata-api" });

    return jar;
}

// -------- boot / partner info --------

/**
 * Discover the current seller's partnerId, sellerType, etc. from the boot API.
 * `sellerType` here is an array like ["PPMP"] — used AS-IS as `partnerType` in
 * the schedule POST (this is distinct from the top-level `partnerType`: "SELLER").
 */
async function getPartnerBoot(jar) {
    const res = await axios.get(
        "https://partnersapi.myntrainfo.com/api/boot/partners",
        {
            headers: apiHeaders(jar, { accept: "*/*", "x-myntra-knuth": "yes" }),
            validateStatus: () => true,
            timeout: REQ_TIMEOUT_MS,
        }
    );
    logHttpError("boot/partners", res);
    if (res.status !== 200) {
        throw new Error(`boot/partners failed: HTTP ${res.status} ${JSON.stringify(res.data).slice(0, 300)}`);
    }
    const d = res.data || {};
    const sellerTypeArr = Array.isArray(d.sellerType) ? d.sellerType : (d.sellerType ? [d.sellerType] : []);
    return {
        partnerId: d.partnerId != null ? String(d.partnerId) : (d.sellerId != null ? String(d.sellerId) : null),
        sellerId: d.sellerId != null ? Number(d.sellerId) : null,
        sellerType: sellerTypeArr[0] || null,   // ← "PPMP" / "MDIRECT" — use as scheduleReport.partnerType
        sellerTypes: sellerTypeArr,
        partnerCode: d.partnerCode || null,     // brand tag, e.g. "WDLL"
        firstlogin: !!d.firstlogin,
        hasAccess: !!d.hasAccess,
        isAdmin: !!d.isAdmin,
        raw: d,                                 // keep for debugging; strip in prod if noisy
    };
}

// -------- schedule --------

/**
 * Ask Myntra to build a report for [from, to]. Returns the job id to poll.
 * `partnerType` is the sellerType from getPartnerBoot() (e.g. "PPMP"), NOT
 * the boot response's top-level partnerType ("SELLER").
 */
async function scheduleReport(jar, { reportId, storeId, partnerType, from, to }) {
    if (!reportId) throw new Error("scheduleReport: reportId is required");
    if (!partnerType) throw new Error("scheduleReport: partnerType is required (e.g. 'PPMP')");
    const body = {
        reportId,
        queryParams: {
            storeId: Number(storeId || MYNTRA_STORE_ID),
            partnerType,
            reportStartDate: from,
            reportEndDate: to,
        },
    };
    const res = await axios.post(
        "https://partnersapi.myntrainfo.com/api/partners/report/jobs/schedule",
        body,
        {
            headers: apiHeaders(jar, { "content-type": "application/json", accept: "application/json" }),
            validateStatus: () => true,
            timeout: REQ_TIMEOUT_MS,
        }
    );
    logHttpError("scheduleReport", res);
    const st = res.data && res.data.status;
    const row = res.data && res.data.data && res.data.data[0];
    if (res.status !== 200 || !st || st.statusType !== "SUCCESS" || !row || !row.id) {
        throw new Error(
            `scheduleReport failed: HTTP ${res.status} ${JSON.stringify(res.data).slice(0, 400)}`
        );
    }
    return {
        jobId: row.id,
        status: row.status,           // usually "CREATED" at this point
        reportName: row.reportEntry && row.reportEntry.name,
    };
}

// -------- search (list recent jobs — used by the queue drain loop) --------

/**
 * One-shot list of the seller's most recent report jobs (all statuses).
 * The queue-based runner calls this ONCE per seller per poll round: the
 * response contains status + successFile for every recently-submitted job,
 * so N pending jobs for one seller = one HTTP call, not N.
 */
async function searchJobs(jar, { pageSize = 50, start = 0 } = {}) {
    const url = `https://partnersapi.myntrainfo.com/api/partners/report/jobs/search?fetchSize=${pageSize}&sortBy=id&sortOrder=desc&start=${start}`;
    const res = await axios.get(url, {
        headers: apiHeaders(jar),
        validateStatus: () => true,
        timeout: REQ_TIMEOUT_MS,
    });
    logHttpError("searchJobs", res);
    if (res.status !== 200) throw new Error(`searchJobs failed: HTTP ${res.status}`);
    return (res.data && res.data.data) || [];
}

// -------- poll --------

/**
 * Poll the jobs/search endpoint until our jobId reaches COMPLETED (or FAILED).
 * pageSize=25 covers the case where a busy seller has other jobs queued in
 * front of ours; we page (using `start`) up to a safe cap if not found.
 */
async function pollJob(
    jar,
    jobId,
    { timeoutMs = 900000, pollMs = 10000, pageSize = 25, maxPages = 6 } = {}
) {
    const deadline = Date.now() + timeoutMs;
    const findRow = async () => {
        for (let p = 0; p < maxPages; p++) {
            const url = `https://partnersapi.myntrainfo.com/api/partners/report/jobs/search?fetchSize=${pageSize}&sortBy=id&sortOrder=desc&start=${p * pageSize}`;
            const res = await axios.get(url, { headers: apiHeaders(jar), validateStatus: () => true, timeout: REQ_TIMEOUT_MS });
            logHttpError("pollJob(search)", res);
            if (res.status !== 200) throw new Error(`pollJob search failed: HTTP ${res.status}`);
            const rows = (res.data && res.data.data) || [];
            const row = rows.find((r) => r.id === jobId);
            if (row) return row;
            if (rows.length < pageSize) break; // no more pages
        }
        return null;
    };
    while (Date.now() < deadline) {
        const row = await findRow();
        if (!row) throw new Error(`pollJob: jobId ${jobId} not found in first ${pageSize * maxPages} rows`);
        if (row.status === "COMPLETED") {
            if (!row.successFile) throw new Error(`pollJob: job ${jobId} COMPLETED but no successFile`);
            return { successFile: row.successFile, row };
        }
        if (row.status === "FAILED" || row.status === "CANCELLED") {
            throw new Error(`pollJob: job ${jobId} ${row.status} — ${row.statusMessage || "no message"}`);
        }
        await new Promise((r) => setTimeout(r, pollMs));
    }
    throw new Error(`pollJob: job ${jobId} timed out after ${timeoutMs}ms`);
}

// -------- download --------

/**
 * Download the completed report file. The endpoint wraps a signed Azure blob URL
 * and returns the raw CSV bytes directly (verified: text/csv, ~26k rows).
 */
async function downloadReport(jar, successFileUrl) {
    const url =
        "https://partnersapi.myntrainfo.com/api/file-manager/getDownloadUrl?url=" +
        encodeURIComponent(successFileUrl);
    const res = await axios.get(url, {
        responseType: "arraybuffer",
        headers: apiHeaders(jar, { accept: "application/json" }),
        validateStatus: () => true,
        timeout: REQ_TIMEOUT_MS * 5, // downloads can be big; allow 5 min
    });
    logHttpError("downloadReport", res);
    if (res.status !== 200) {
        const body = Buffer.from(res.data || "").toString("utf8").slice(0, 300);
        throw new Error(`downloadReport failed: HTTP ${res.status} ${body}`);
    }
    return {
        buffer: Buffer.from(res.data),
        contentType: res.headers["content-type"] || "text/csv",
    };
}

// -----------------------------------------------------------------------------
// 🗂️ importType → report, and the date window
// -----------------------------------------------------------------------------
// Lifted out of the automation server's apiScript.js so both runners share one
// definition. A second consumer (the CMS desktop app) needs exactly this map
// and this date maths, and a copy in each would drift the first time Myntra
// changed a report id.
//
// `trackvidReportType` is what importMyntraDataToTrackVid expects. Only
// `returnOrderData` has a confirmed mapping today; the others download fine but
// TrackVid has nowhere to put them, so a runner should report them as skipped
// rather than pretend they were imported.
const IMPORT_TYPE_API_CONFIG = {
    returnOrderData: {
        reportId: REPORT_IDS.Seller_Returns_Report,
        portalReportName: "Seller_Returns_Report",
        trackvidReportType: "returnReport",
        lookbackDaysCap: 28,
    },
    orderData: {
        reportId: REPORT_IDS.Seller_Orders_Report,
        portalReportName: "Seller_Orders_Report",
        trackvidReportType: null,
        lookbackDaysCap: 28,
    },
    listingsData: {
        reportId: REPORT_IDS.Seller_Listings_Report,
        portalReportName: "Seller_Listings_Report",
        trackvidReportType: null,
        lookbackDaysCap: 28,
    },
    inventoryData: {
        reportId: REPORT_IDS.Seller_Inventory_Report,
        portalReportName: "Seller_Inventory_Report",
        trackvidReportType: null,
        lookbackDaysCap: 28,
    },
};

function getImportTypeApiConfig(importType) {
    const cfg = IMPORT_TYPE_API_CONFIG[importType];
    if (!cfg) throw new Error(`Unknown Myntra importType (API): ${importType}`);
    return cfg;
}

// Myntra locks the most recent day(s) (`latestPeriod` in the report entry), so
// `to` is two days back — the same offset the UI flow uses. Asking for today
// returns an empty or partial report.
function computeDateRange(scenario, lastSyncDate, lookbackDaysCap = 28) {
    const today = dayjs();
    const to = today.subtract(2, "day");
    let from;
    if (scenario === "SCENARIO_2_INCREMENTAL" && lastSyncDate) {
        const last = dayjs(lastSyncDate);
        if (!last.isValid()) throw new Error(`Invalid lastSyncDate: ${lastSyncDate}`);
        const earliest = today.subtract(lookbackDaysCap, "day");
        from = last.isBefore(earliest) ? earliest : last;
    } else {
        from = today.subtract(lookbackDaysCap, "day");
    }
    return { from: from.format("YYYY-MM-DD"), to: to.format("YYYY-MM-DD") };
}

module.exports = {
    // constants
    MYNTRA_STORE_ID,
    MYNTRA_LOGIN_CIDX,
    REPORT_IDS,
    MDIRECT_REPORT_IDS,
    IMPORT_TYPE_API_CONFIG,
    getImportTypeApiConfig,
    computeDateRange,
    // flow
    loginMyntra,
    getPartnerBoot,
    scheduleReport,
    searchJobs,
    pollJob,
    downloadReport,
    // internals (exported for testing)
    _cookieHeader: cookieHeader,
    _parseSetCookie: parseSetCookie,
};
