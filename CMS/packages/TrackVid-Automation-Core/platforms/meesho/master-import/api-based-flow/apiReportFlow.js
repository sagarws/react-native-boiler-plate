/**
 * Meesho Supplier Panel — direct-API master-data flow.
 *
 * Replaces the Puppeteer UI navigation (Orders → Download Orders Data → date
 * picker → Generate → poll list → click Download → CSV) with the same JSON
 * APIs the SPA calls.
 *
 * Auth is HYBRID: Puppeteer bootstraps the cookie jar via meeshoAutoClaim's
 * sessionStore; every subsequent call is HTTP.
 *
 * Verified from ApiDocs/meesho-master-import+cms (1).json:
 *
 *   POST /api/fulfillment/orders/download-gst/request
 *   POST /api/fulfillment/orders/download-gst/history      (poll → downloadUrl)
 *   GET  <downloadUrl>                                     (CSV/XLSX blob)
 *
 * The GST-download endpoint is Meesho's actual bulk export — the "Download
 * Orders Data" dropdown in the UI wraps this same request. Note that Meesho
 * currently only exposes an ORDER-scoped export via this path; for
 * return-order data the UI drives a different flow that has NO documented
 * API in the current capture. Return-order API path is therefore stubbed —
 * see runReturnReport() below.
 */

const axios = require("axios");
const dayjs = require("dayjs");

const {
    getUsableSession, saveSession, clearSession, cookieHeader, ORIGIN,
} = require("../../common/sessionStore");
const { loginMeeshoApi } = require("../../claim-management/api-based-flow/claimApiFlow");

const REQ_TIMEOUT_MS = Number(process.env.MEESHO_API_TIMEOUT_MS || 60000);
const DOWNLOAD_TIMEOUT_MS = Number(process.env.MEESHO_DOWNLOAD_TIMEOUT_MS || 300000);

const UA =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36";

const dbg = (...a) => {
    if (process.env.MEESHO_API_DEBUG === "true") console.log("[meesho-master-api]", ...a);
};

// -----------------------------------------------------------------------------
// 🔐 Login wrapper — reuses the claim runner's Puppeteer bootstrap.
// -----------------------------------------------------------------------------
async function loginMasterData(email, password, credentialId, { forceFresh = false } = {}) {
    const cacheKey = { credentialId, username: email };
    if (!forceFresh) {
        const cached = await getUsableSession(cacheKey);
        if (cached) return cached;
    } else {
        await clearSession(cacheKey, "forced fresh login");
    }
    const ctx = await loginMeeshoApi(
        { _id: credentialId, username: email, password },
        { forceFresh },
    );
    // Overwrite source so ops can see where the session came from.
    try {
        await saveSession({
            ...cacheKey, jar: ctx.jar,
            supplierId: ctx.supplierId,
            supplierIdentifier: ctx.supplierIdentifier,
            source: "masterdata-api",
        });
    } catch (_) { /* best effort */ }
    return ctx;
}

// -----------------------------------------------------------------------------
// 🧰 HTTP wrapper
// -----------------------------------------------------------------------------
function apiHeaders(ctx, extra = {}) {
    return {
        "user-agent": UA,
        accept: "application/json, text/plain, */*",
        "accept-language": "en-US,en;q=0.9",
        origin: ORIGIN, Referer: `${ORIGIN}/`,
        "content-type": "application/json",
        cookie: cookieHeader(ctx.jar),
        ...extra,
    };
}
function authError(step, status) {
    const err = new Error(`${step}: session expired (HTTP ${status})`);
    err.code = "AUTH_EXPIRED";
    return err;
}
async function httpCall(ctx, { method = "post", url, data, responseType }) {
    const res = await axios({
        method, url, data,
        headers: apiHeaders(ctx),
        responseType,
        maxRedirects: responseType === "arraybuffer" ? 5 : 0,
        maxBodyLength: Infinity, maxContentLength: Infinity,
        validateStatus: () => true,
        timeout: responseType === "arraybuffer" ? DOWNLOAD_TIMEOUT_MS : REQ_TIMEOUT_MS,
    });
    if (res.status === 401 || res.status === 403) throw authError("Meesho API", res.status);
    if (res.status < 200 || res.status >= 300) {
        const bodyPreview = typeof res.data === "string" ? res.data.slice(0, 300)
            : JSON.stringify(res.data || "").slice(0, 300);
        throw new Error(`Meesho API failed: HTTP ${res.status} ${bodyPreview}`);
    }
    return res;
}

// -----------------------------------------------------------------------------
// 📅 Request a bulk order/GST download for [from, to]
// -----------------------------------------------------------------------------
async function requestOrderReport(ctx, { from, to }) {
    const body = {
        filters: { date_range: { min: from, max: to } },
        supplier_details: { id: Number(ctx.supplierId || 0), identifier: ctx.supplierIdentifier || "" },
        identifier: ctx.supplierIdentifier || "",
        child_supplier_identifier: null,
        child_supplier_id: null,
    };
    const res = await httpCall(ctx, {
        url: `${ORIGIN}/api/fulfillment/orders/download-gst/request`,
        data: body,
    });
    // Response body isn't captured but the UI toasts a request-id / job-id.
    return res.data || {};
}

async function listReportHistory(ctx) {
    const body = {
        supplier_id: Number(ctx.supplierId || 0),
        identifier: ctx.supplierIdentifier || "",
        child_supplier_identifier: null,
        child_supplier_id: null,
    };
    const res = await httpCall(ctx, {
        url: `${ORIGIN}/api/fulfillment/orders/download-gst/history`,
        data: body,
    });
    const list = res.data?.history || res.data?.data || res.data?.results ||
                 (Array.isArray(res.data) ? res.data : []);
    return list;
}

// Find the freshest history entry that matches our requested date range.
function findMatchingReport(history, { from, to, requestedAt }) {
    if (!Array.isArray(history) || history.length === 0) return null;
    // Try to match by date range first — Meesho stamps them on the row.
    const byRange = history.find((r) => {
        const rMin = r?.filters?.date_range?.min || r?.date_range?.min;
        const rMax = r?.filters?.date_range?.max || r?.date_range?.max;
        return rMin === from && rMax === to;
    });
    if (byRange) return byRange;
    // Fallback: the first entry newer than our requestedAt.
    const rq = requestedAt instanceof Date ? requestedAt.getTime() : new Date(requestedAt).getTime();
    return history.find((r) => {
        const t = new Date(r?.created_at || r?.createdAt || r?.timestamp || 0).getTime();
        return t >= rq - 5000;
    }) || null;
}

function getReportStatus(record) {
    const s = record?.status || record?.state || record?.download_status || "";
    return String(s).toUpperCase();
}
function getReportDownloadUrl(record) {
    return record?.download_url || record?.downloadUrl || record?.url ||
           record?.file_url || record?.fileUrl || null;
}

async function downloadReportFile(ctx, url) {
    if (!url) throw new Error("downloadReportFile: no url");
    const absoluteUrl = url.startsWith("http") ? url : `${ORIGIN}${url.startsWith("/") ? "" : "/"}${url}`;
    const res = await axios.get(absoluteUrl, {
        headers: apiHeaders(ctx),
        responseType: "arraybuffer",
        maxRedirects: 5,
        maxBodyLength: Infinity, maxContentLength: Infinity,
        validateStatus: () => true,
        timeout: DOWNLOAD_TIMEOUT_MS,
    });
    if (res.status < 200 || res.status >= 300) {
        throw new Error(`downloadReportFile failed: HTTP ${res.status}`);
    }
    const cd = res.headers?.["content-disposition"] || "";
    const match = cd.match(/filename\*?=(?:UTF-8''|")?([^";]+)/i);
    const filename = match ? decodeURIComponent(match[1].replace(/^"|"$/g, "")) : `meesho_${Date.now()}.csv`;
    return {
        buffer: Buffer.from(res.data),
        contentType: res.headers?.["content-type"] || "text/csv",
        filename,
    };
}

// Return-order API path — Meesho's UI-side flow for returns uses a different
// backend that isn't in the capture. Stubbed: caller falls back to the
// Puppeteer path (runReturnsFlow) for return imports. Wire this up when the
// API endpoint becomes visible.
async function runReturnReport(/* ctx, config */) {
    throw new Error(
        "MEESHO_RETURN_API_UNAVAILABLE: return-order API path not documented in the current capture — " +
        "use the Puppeteer runner (unset MEESHO_APIBASE_AUTOMATION_RETURNS) or add the endpoint here."
    );
}

// -----------------------------------------------------------------------------
// 📊 Date range — matches the Puppeteer flow's default (last 30 days).
// -----------------------------------------------------------------------------
function computeDateRange(scenario, lastSyncDate, lookbackDaysCap = 30) {
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
    return { from: from.format("YYYY-MM-DD"), to: to.format("YYYY-MM-DD") };
}

module.exports = {
    loginMasterData,
    requestOrderReport,
    listReportHistory,
    findMatchingReport,
    getReportStatus,
    getReportDownloadUrl,
    downloadReportFile,
    runReturnReport,
    computeDateRange,
};
