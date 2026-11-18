/**
 * Flipkart — the seller portal's Report Centre, over HTTP.
 *
 * SAME SHAPE AS SNAPDEAL'S: ASK, WAIT, FETCH. `submitReport` answers with a
 * request id and an ETA ("30 mins"), the file is built server-side, and it
 * appears on `getReportsV2` as `FILE_STORED` once there is something to
 * download. Three calls, separated in time — so the caller keeps a request
 * table and comes back later, rather than looping here.
 *
 * WHAT IS EASIER THAN SNAPDEAL: every list row carries the `request_id` the
 * submit answered with, plus the date filter it was asked for. A finished file
 * is matched to its request by id, never by name or window.
 *
 * Verified against a portal capture (Report Centre → Fulfilment Reports):
 *
 *   POST /napi/metrics/bizReport/submitReport?reportName=Orders|Returns
 *        { from_date, to_date, file_format: "EXCEL", type: "ONETIME",
 *          filters: [{ name: "date", operator: "RANGE", values: [from, to] }] }
 *     → { request_id: { request_id, eta } }
 *
 *   POST /napi/metrics/bizReport/report/getReportsV2
 *        { reportGroup: "Fulfilment Reports", reportName: null, enable: true,
 *          status: null, page_size, starting_page }
 *     → { has_more, report_requests: [{ request_id, report_name, created_at,
 *          status: "QUERY_SUBMITTED" | … | "FILE_STORED", filters, … }] }
 *
 *   GET  /napi/metrics/bizReport/downloadReport/{request_id}_{created_at}.xlsx
 *        ?token={request_id}&sellerId={sellerId}
 *
 * Auth is the claim flow's context — `{ jar, csrfToken, sellerId }` from
 * `loginFlipkartApi` or a stored session. Nothing here signs in.
 */

const axios = require("axios");
const { authError } = require("../../../../common/apiError");
const {
    cookieHeader,
    ORIGIN,
} = require("../../claim-management/api-based-flow/claimApiFlow");

const SUBMIT_URL = `${ORIGIN}/napi/metrics/bizReport/submitReport`;
const LIST_URL = `${ORIGIN}/napi/metrics/bizReport/report/getReportsV2`;
const DOWNLOAD_BASE = `${ORIGIN}/napi/metrics/bizReport/downloadReport`;

const UA =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36";

const REQ_TIMEOUT_MS = Number(process.env.FLIPKART_REPORT_TIMEOUT_MS || 60000);
const DOWNLOAD_TIMEOUT_MS = Number(process.env.FLIPKART_REPORT_DOWNLOAD_TIMEOUT_MS || 180000);

/** The group both reports are listed under. */
const REPORT_GROUP = "Fulfilment Reports";

/**
 * Our report keys → the portal's `reportName`.
 *
 * `sheet` is the data sheet in the downloaded workbook; the first sheet of
 * both files is a "Help" page of column descriptions.
 */
const REPORTS = {
    forward: { reportName: "Orders", sheet: "Orders" },
    return: { reportName: "Returns", sheet: "Returns" },
};

/** The list status that means "there is a file". */
const FILE_READY = "FILE_STORED";

/** Statuses that will never become a file. */
const TERMINAL_FAILURES = new Set(["FAILED", "QUERY_FAILED", "EXPIRED", "CANCELLED", "REJECTED"]);

function reportConfig(report) {
    const cfg = REPORTS[report];
    if (!cfg) throw new Error(`Unknown Flipkart report: ${report}`);
    return cfg;
}

function headers(ctx, extra = {}) {
    return {
        "user-agent": UA,
        accept: "*/*",
        "accept-language": "en-US,en;q=0.9",
        "content-type": "application/json",
        origin: ORIGIN,
        referer: `${ORIGIN}/index.html`,
        "fk-csrf-token": ctx.csrfToken || "",
        cookie: cookieHeader(ctx.jar),
        ...extra,
    };
}

/** The seller id the download URL needs: the context, else the cookie. */
function sellerIdOf(ctx) {
    return String(ctx?.sellerId || ctx?.jar?.sellerId || "").trim() || null;
}

function failOn(step, res) {
    if (res.status === 401 || res.status === 403) {
        throw authError(step, res.status, JSON.stringify(res.data || ""));
    }
    if (res.status < 200 || res.status >= 300) {
        const err = new Error(`${step} failed: HTTP ${res.status} ${JSON.stringify(res.data || "").slice(0, 300)}`);
        err.status = res.status;
        throw err;
    }
}

/**
 * Ask Flipkart to build one report for a window (`yyyy-MM-dd`, inclusive).
 * Returns `{ requestId, eta }`. Throws when the portal answers without an id —
 * a request nobody can find again is not a request.
 */
async function submitReport(ctx, report, { from, to }) {
    const { reportName } = reportConfig(report);
    const res = await axios.post(
        SUBMIT_URL,
        {
            from_date: from,
            to_date: to,
            file_format: "EXCEL",
            type: "ONETIME",
            filters: [{ values: [from, to], operator: "RANGE", name: "date" }],
        },
        {
            params: { reportName },
            headers: headers(ctx),
            validateStatus: () => true,
            timeout: REQ_TIMEOUT_MS,
        }
    );

    failOn(`Submit ${reportName} report`, res);

    const body = res.data || {};
    const inner = body.request_id && typeof body.request_id === "object" ? body.request_id : body;
    const requestId = typeof inner.request_id === "string" ? inner.request_id : null;

    if (!requestId) {
        throw new Error(`Submit ${reportName} report: no request id in ${JSON.stringify(body).slice(0, 300)}`);
    }

    return { requestId, eta: inner.eta ?? null };
}

/** One list row, reduced to what a caller needs. */
function toListRow(raw) {
    const dateFilter = (raw.filters || []).find((f) => f && f.name === "date");
    const sellerFilter = (raw.filters || []).find((f) => f && f.name === "seller_id");
    const window = Array.isArray(dateFilter?.value) ? dateFilter.value : [];

    return {
        requestId: raw.request_id || null,
        reportName: raw.report_name || null,
        status: String(raw.status || "").toUpperCase(),
        createdAt: Number(raw.created_at) || null,
        size: Number(raw.size) || 0,
        from: window[0] || null,
        to: window[1] || null,
        sellerId: Array.isArray(sellerFilter?.value) ? sellerFilter.value[0] || null : null,
    };
}

/**
 * The Fulfilment Reports list, newest first, across `pages` pages.
 * Rows keep their status — "still building" and "failed" are both answers.
 */
async function listReports(ctx, { pageSize = 50, pages = 2 } = {}) {
    const rows = [];

    for (let page = 1; page <= pages; page += 1) {
        const res = await axios.post(
            LIST_URL,
            {
                reportGroup: REPORT_GROUP,
                reportName: null,
                enable: true,
                status: null,
                page_size: pageSize,
                starting_page: page,
            },
            { headers: headers(ctx), validateStatus: () => true, timeout: REQ_TIMEOUT_MS }
        );

        failOn("List reports", res);

        const body = res.data || {};
        for (const raw of body.report_requests || []) rows.push(toListRow(raw));

        if (!body.has_more) break;
    }

    return rows;
}

const isReady = (row) => row && row.status === FILE_READY;
const isFailed = (row) => row && TERMINAL_FAILURES.has(row.status);

/** The download URL for a finished list row. */
function downloadUrl(row, sellerId) {
    if (!row?.requestId || !row?.createdAt) throw new Error("downloadUrl: the row has no request id or created_at");
    if (!sellerId) throw new Error("downloadUrl: no seller id");
    const name = `${encodeURIComponent(row.requestId)}_${row.createdAt}.xlsx`;
    const query = `token=${encodeURIComponent(row.requestId)}&sellerId=${encodeURIComponent(sellerId)}`;
    return `${DOWNLOAD_BASE}/${name}?${query}`;
}

/** Fetch one finished report. Returns `{ buffer, filename }`. */
async function downloadReport(ctx, row) {
    const url = downloadUrl(row, row.sellerId || sellerIdOf(ctx));
    const res = await axios.get(url, {
        headers: headers(ctx, { accept: "*/*" }),
        responseType: "arraybuffer",
        validateStatus: () => true,
        timeout: DOWNLOAD_TIMEOUT_MS,
        maxRedirects: 5,
    });

    failOn("Download report", res);

    const buffer = Buffer.from(res.data || []);
    if (buffer.length === 0) throw new Error("Download report: empty file");

    return { buffer, filename: `${row.requestId}_${row.createdAt}.xlsx` };
}

module.exports = {
    REPORTS,
    REPORT_GROUP,
    FILE_READY,
    reportConfig,
    sellerIdOf,
    submitReport,
    listReports,
    isReady,
    isFailed,
    downloadUrl,
    downloadReport,
    toListRow,
};
