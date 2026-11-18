/**
 * Snapdeal Seller Portal — direct-API report flow (master data).
 *
 * Replaces the Puppeteer UI navigation (Reports tab → Create New Report modal
 * → dropdowns → date range → Generate → Reports list → Download) with the
 * same JSON APIs the portal itself calls.
 *
 * Auth is HYBRID: Puppeteer bootstraps cookies (loginSnapdealApi in
 * ../../snapdealAutoClaim/claimApiFlow.js — same session cache the claim
 * runner uses, so one login serves both flows), then axios handles the rest.
 *
 * Flow:
 *   loginSnapdealApi(credentials) → { jar }
 *   scheduleReport(jar, importType, from, to) → { requestId, initiationText }
 *   listReports(jar, { pageSize, start })     → array of report records
 *   findReportByInitiation(list, initiationText) → single record or null
 *   downloadReport(jar, downloadUrl)          → { buffer, contentType }
 *
 * Verified against a full portal capture (api-network-records (4).json).
 * The generateReport request body is exact:
 *
 *   {
 *     payload: JSON.stringify({
 *       reportType:      "NonSDPlus",
 *       queryType:       "created",
 *       state:           "ReturnsAck",
 *       fulfillmentMode: "DROPSHIP",
 *       startDate:       "21-8-2026",
 *       endDate:         "21-8-2026"
 *     }),
 *     subCategory: "ReturnsAck",
 *     scheduled:   false
 *   }
 *
 * `subCategory` is the STATE, not the category — "ReturnsAck", matching the
 * payload's `state`. Sending "Returns" there is what made /report/generateReport
 * answer 500 with an empty body.
 *
 * The response is:
 *   { eta, requestId, generationStatus, reportName: "Dropship Return
 *     Acknowledged", params: { fm }, system }
 *
 * The reports list is GET /report/get?category=Returns&pageSize=10&start=0:
 *   { reports: [{ name, status, startTime, endTime, code, area, subArea }] }
 *
 * Two things follow from that shape:
 *   - There is NO id and no requestId on a row, so the requestId the schedule
 *     returns cannot be matched against the list. Reports are found by `name`
 *     and recency instead.
 *   - There is NO downloadHref. The download URL is built from the row:
 *     /report/download/{subArea}/{code}, and `code` is null until the report
 *     completes.
 *
 * Statuses seen on the list: "PEN" (building) and "CMP" (complete).
 */

const axios = require("axios");
const dayjs = require("dayjs");
const {
    loginSnapdealApi,
} = require("../../claim-management/api-based-flow/claimApiFlow");
const {
    getUsableSession,
    saveSession,
    clearSession,
    cookieHeader,
    ORIGIN,
} = require("../../common/sessionStore");

const REQ_TIMEOUT_MS = Number(process.env.SNAPDEAL_API_TIMEOUT_MS || 60000);
const DOWNLOAD_TIMEOUT_MS = Number(process.env.SNAPDEAL_DOWNLOAD_TIMEOUT_MS || 300000); // 5 min

// Enough for a storage redirect and one signed-URL bounce; a chain longer than
// that is a loop, not a download.
const MAX_DOWNLOAD_REDIRECTS = 5;

const UA =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36";

const dbg = (...a) => {
    if (process.env.SNAPDEAL_API_DEBUG === "true") console.log("[snapdeal-master-api]", ...a);
};

// ---------------------------
// 🗂️ importType → generateReport payload
// ---------------------------
// Mirrors IMPORT_TYPE_CONFIG in ../requestReportFlow.js (the Puppeteer path),
// but expressed as the JSON fields the /report/generateReport endpoint takes.
//
// Verified from the capture (only "returnOrderData" today):
//   reportType:      "NonSDPlus"      — portal's internal name for the seller's plan
//   queryType:       "created"        — "Created Date" filter
//   state:           "ReturnsAck"     — "Return Acknowledged" state
//   fulfillmentMode: "DROPSHIP"       — "Dropship" (uppercase for the API)
//   subCategory:     "ReturnsAck"     — the STATE, echoing `state` (NOT the
//                                       category; "Returns" here answers 500)
//
// The Puppeteer path's `trackvidReportType` ("Dropship Rtv Report") is carried
// through unchanged so importSnapdealDataToTrackVid routes to the same
// ingestion endpoint.
const IMPORT_TYPE_API_CONFIG = {
    returnOrderData: {
        reportType: process.env.SNAPDEAL_REPORT_TYPE || "NonSDPlus",
        queryType: "created",
        state: "ReturnsAck",
        fulfillmentMode: "DROPSHIP",
        subCategory: "ReturnsAck",
        // Query param on GET /report/get — narrows the list to this area.
        listCategory: "Returns",
        // Path segment in /report/download/{subArea}/{code}. Matches the
        // `subArea` the list rows carry.
        subArea: "ReturnsAck",
        // The `name` the list rows carry, and what a report is matched on —
        // rows have no id to match against.
        portalReportName: "Dropship Return Acknowledged",
        trackvidReportType: "Dropship Rtv Report",
        // Snapdeal caps the request window at 28 days from today.
        lookbackDaysCap: 28,
    },
};

function getImportTypeApiConfig(importType) {
    const cfg = IMPORT_TYPE_API_CONFIG[importType];
    if (!cfg) throw new Error(`Unknown Snapdeal importType (API): ${importType}`);
    return cfg;
}

// Format used by /report/generateReport — from the capture: "21-8-2026"
// (day-month-year with no zero padding on the month/day).
function formatSnapdealDate(d) {
    return dayjs(d).format("D-M-YYYY");
}

// Compute a request window with the 28-day cap.
function computeDateRange(scenario, lastSyncDate, lookbackDaysCap) {
    const today = dayjs();
    const to = today;
    let from;
    if (scenario === "SCENARIO_2_INCREMENTAL" && lastSyncDate) {
        const last = dayjs(lastSyncDate);
        if (!last.isValid()) throw new Error(`Invalid lastSyncDate: ${lastSyncDate}`);
        const earliest = today.subtract(lookbackDaysCap, "day");
        from = last.isBefore(earliest) ? earliest : last;
    } else {
        from = today.subtract(lookbackDaysCap, "day");
    }
    return {
        fromDate: from.toDate(),
        toDate: to.toDate(),
        from: formatSnapdealDate(from),
        to: formatSnapdealDate(to),
    };
}

// ---------------------------
// 🧰 Shared HTTP call
// ---------------------------
function apiHeaders(jar, extra = {}) {
    return {
        "user-agent": UA,
        accept: "application/json, text/plain, */*",
        "accept-language": "en-US,en;q=0.9",
        origin: ORIGIN,
        Referer: `${ORIGIN}/`,
        "x-requested-with": "XMLHttpRequest",
        cookie: cookieHeader(jar),
        ...extra,
    };
}

function authError(step, status, body) {
    const err = new Error(
        `${step}: session expired (HTTP ${status}) ${String(body || "").slice(0, 200)}`
    );
    err.code = "AUTH_EXPIRED";
    return err;
}

async function httpCall(jar, { method = "get", url, data, headers, responseType, step, allowRedirect = false }) {
    const res = await axios({
        method,
        url,
        data,
        headers: apiHeaders(jar, headers || {}),
        responseType,
        maxRedirects: 0,
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
        validateStatus: () => true,
        timeout: responseType === "arraybuffer" ? DOWNLOAD_TIMEOUT_MS : REQ_TIMEOUT_MS,
    });
    if (res.status === 401 || res.status === 403) {
        throw authError(step, res.status, JSON.stringify(res.data || ""));
    }
    if (res.status === 302 || res.status === 301) {
        const loc = res.headers?.location || "";
        if (/login|signin|auth/i.test(loc)) {
            throw authError(step, res.status, `redirect to ${loc}`);
        }
        // Not an auth bounce. `maxRedirects: 0` is deliberate — it is what lets
        // the check above see a login redirect instead of silently following it
        // into an HTML page — so a legitimate redirect is handed back for the
        // caller to follow rather than treated as a failure.
        if (allowRedirect) return res;
    }
    if (res.status < 200 || res.status >= 300) {
        const bodyPreview = typeof res.data === "string"
            ? res.data.slice(0, 300)
            : JSON.stringify(res.data || "").slice(0, 300);
        throw new Error(`${step} failed: HTTP ${res.status} ${bodyPreview}`);
    }
    return res;
}

// ---------------------------
// 🔐 Login (thin wrapper around loginSnapdealApi)
// ---------------------------
// Kept as a separate export so the master-data runner reads like Myntra's
// `loginMyntra(email, password)` while still routing through the shared
// session cache and Puppeteer bootstrap.
async function loginMasterData(email, password, credentialId, { forceFresh = false } = {}) {
    const cacheKey = { credentialId, username: email };

    // Direct hit on the shared cache — skip Puppeteer entirely.
    if (!forceFresh) {
        const cached = await getUsableSession(cacheKey);
        if (cached) return cached.jar;
    } else {
        await clearSession(cacheKey, "forced fresh login");
    }

    const ctx = await loginSnapdealApi({
        _id: credentialId,
        username: email,
        password,
    }, { forceFresh });
    // Overwrite source so ops can see where the session came from.
    try {
        await saveSession({ ...cacheKey, jar: ctx.jar, source: "masterdata-api" });
    } catch (_) { /* ignore — sessionStore never throws */ }
    return ctx.jar;
}

// ---------------------------
// 📅 Phase 1 — schedule a report
// ---------------------------
/**
 * POST /report/generateReport
 *
 * Body verified from capture (see file header). Returns { requestId,
 * initiationText, scheduledAt } — requestId is the report's row id in the
 * Reports list, initiationText is the human string the Puppeteer runner
 * matches on (portalReportName + " Created between <from> and <to>").
 */
async function scheduleReport(jar, importType, { from, to, fromDate, toDate }) {
    const cfg = getImportTypeApiConfig(importType);

    const payload = {
        reportType: cfg.reportType,
        queryType: cfg.queryType,
        state: cfg.state,
        fulfillmentMode: cfg.fulfillmentMode,
        startDate: from,
        endDate: to,
    };

    const body = {
        payload: JSON.stringify(payload),
        subCategory: cfg.subCategory,
        scheduled: false,
    };

    const scheduledAt = new Date();
    const res = await httpCall(jar, {
        method: "post",
        url: `${ORIGIN}/report/generateReport`,
        data: body,
        headers: { "content-type": "application/json;charset=UTF-8" },
        step: "Generate report",
    });

    const data = res.data || {};

    // `generationStatus: false` is a refusal, not a success — the portal
    // answers 200 and simply does not queue the report.
    if (data.generationStatus === false) {
        const why = data.reportErrorStatus || "Snapdeal declined to generate the report";
        throw new Error(`Generate report refused: ${why}`);
    }

    const requestId = data.requestId || null;

    // The name the reports list will carry. Taken from the response when it is
    // there, because that is the exact string the list rows use.
    const reportName = data.reportName || cfg.portalReportName;

    return {
        requestId,
        reportName,
        scheduledAt,
        // How to find and fetch it later.
        listCategory: cfg.listCategory,
        subArea: cfg.subArea,
        portalReportName: reportName,
        trackvidReportType: cfg.trackvidReportType,
    };
}

function formatInitiationDate(d) {
    return dayjs(d).format("DD-MMM-YYYY");
}

// ---------------------------
// 📄 Phase 2 — list + find
// ---------------------------
/**
 * GET /report/get?category=Returns&pageSize=10&start=0
 *
 * Verified response:
 *   { reports: [{ name, status, startTime, endTime, code, area, subArea }] }
 *
 * `code` is null while the report is building and becomes the download token
 * when it completes, so downloadHref is derived rather than read.
 */
async function listReports(jar, { category, pageSize = 20, start = 0 } = {}) {
    const query = [
        category ? `category=${encodeURIComponent(category)}` : null,
        `pageSize=${pageSize}`,
        `start=${start}`,
    ].filter(Boolean).join("&");

    const res = await httpCall(jar, {
        method: "get",
        url: `${ORIGIN}/report/get?${query}`,
        step: "List reports",
    });

    const data = res.data || {};
    const rows = Array.isArray(data.reports) ? data.reports : (Array.isArray(data) ? data : []);

    return rows.map((r) => ({
        name: r.name || null,
        status: String(r.status || "").toUpperCase(),   // "PEN" | "CMP"
        code: r.code || null,
        area: r.area || null,
        subArea: r.subArea || null,
        startTime: r.startTime || null,
        endTime: r.endTime || null,
        // Built, not read: the list carries no download link.
        downloadHref: r.code && r.subArea ? `/report/download/${r.subArea}/${r.code}` : null,
        raw: r,
    }));
}

// Tolerance when comparing a row's startTime against our own clock — the
// portal timestamps server-side, and a minute of skew must not hide the row we
// just asked for.
const CLOCK_SKEW_MS = 2 * 60 * 1000;

/**
 * Locate the report we scheduled.
 *
 * Matched on `name` plus recency, NOT on requestId: the list rows carry no id
 * of any kind, so the requestId the schedule returns has nothing to match
 * against. `notBefore` keeps yesterday's identically-named report from being
 * mistaken for today's — without it the newest row wins even when our own
 * request has not appeared yet, and the import silently loads stale data.
 */
function findReport(list, { reportName, notBefore }) {
    const wanted = String(reportName || "").trim().toLowerCase();

    if (!wanted) return null;

    const candidates = list
        .filter((r) => r.name && String(r.name).trim().toLowerCase() === wanted)
        .filter((r) => !notBefore || !r.startTime || r.startTime >= notBefore - CLOCK_SKEW_MS)
        .sort((a, b) => (b.startTime || 0) - (a.startTime || 0));

    return candidates[0] || null;
}

// ---------------------------
// ⬇️ Phase 2 — download
// ---------------------------
/**
 * Download the completed report. Snapdeal's downloadHref is either a full
 * URL or a path relative to seller.snapdeal.com — normalise here.
 * Returns { buffer, contentType, filename }.
 */
async function downloadReport(jar, downloadHref) {
    if (!downloadHref) throw new Error("downloadReport: downloadHref is required");

    const url = downloadHref.startsWith("http") ? downloadHref : `${ORIGIN}${downloadHref.startsWith("/") ? "" : "/"}${downloadHref}`;

    // Snapdeal does not serve the file from this path — it 302s to wherever the
    // report actually lives. Following that hop is the whole job; without it the
    // response is a 302 with an empty body, which reads as
    // "Download report failed: HTTP 302 {"type":"Buffer","data":[]}".
    let res = await httpCall(jar, {
        method: "get",
        url,
        responseType: "arraybuffer",
        step: "Download report",
        allowRedirect: true,
    });

    for (let hop = 0; hop < MAX_DOWNLOAD_REDIRECTS && (res.status === 302 || res.status === 301); hop++) {
        const location = res.headers?.location;

        if (!location) {
            throw new Error(`Download report: HTTP ${res.status} with no Location header to follow`);
        }

        const next = new URL(location, url).toString();

        // Cookies go to Snapdeal, not to wherever it forwards us. These
        // redirects usually land on a CDN or presigned storage URL, and a
        // session cookie has no business being sent to a third party — some
        // presigned URLs also reject a request carrying unexpected headers.
        const sameOrigin = new URL(next).origin === new URL(ORIGIN).origin;

        res = await httpCall(sameOrigin ? jar : {}, {
            method: "get",
            url: next,
            responseType: "arraybuffer",
            step: "Download report (redirect)",
            allowRedirect: true,
        });
    }

    if (res.status === 302 || res.status === 301) {
        throw new Error(`Download report: still redirecting after ${MAX_DOWNLOAD_REDIRECTS} hops`);
    }

    // content-disposition: attachment; filename="Dropship_Return_Acknowledged_....xlsx"
    const cd = res.headers?.["content-disposition"] || "";
    const match = cd.match(/filename\*?=(?:UTF-8''|")?([^";]+)/i);
    const filename = match ? decodeURIComponent(match[1].replace(/^"|"$/g, "")) : `snapdeal_${Date.now()}.csv`;

    return {
        buffer: Buffer.from(res.data),
        contentType: res.headers?.["content-type"] || "text/csv",
        filename,
    };
}

module.exports = {
    // constants
    IMPORT_TYPE_API_CONFIG,
    getImportTypeApiConfig,
    // helpers
    computeDateRange,
    formatSnapdealDate,
    findReport,
    // flow
    loginMasterData,
    scheduleReport,
    listReports,
    downloadReport,
};
