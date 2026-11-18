/**
 * AJIO Help Center "Download Ticket" report via direct API — called from inside a logged-in
 * puppeteer page (page.evaluate + fetch), so the browser attaches its own cookies + Akamai
 * token + fingerprint (same-origin). Replaces the fragile UI flow (open panel / select POBs /
 * calendar / submit button / poll table / download arrow).
 *
 * 3-call async flow (verified 2026-07-30, navlik):
 *   POST /malekith/castellan/api/v1/tickets/excel
 *        body {requestDateFrom, requestDateTo (YYYY/MM/DD), pobIds:["ALL", ...ids]}
 *        -> 200 {"result":{"requestId":"..."}}   (queues generation, status IN_PROGRESS)
 *   GET  /malekith/castellan/api/v1/tickets/excel/{requestId}/download
 *        -> 500 {"message":"Report not ready...","status":1003} while IN_PROGRESS
 *        -> 200 xlsx (PK) once CREATED
 *   Required headers: X-Tenant: AJIO, X-Tenant-Id: AJIO, x-seller-id: <userId>
 *
 * userId (= x-seller-id) and pobIds come from the SAME helpers Master Data Import uses.
 */
const { getUserId, getPobIds } = require("../../master-import/api-based-flow/apiReportFlow");

const BASE = "/malekith/castellan/api/v1/tickets/excel";
const TENANT_HEADERS = (userId) => ({ "X-Tenant": "AJIO", "X-Tenant-Id": "AJIO", "x-seller-id": userId });

/** Convert a YYYY-MM-DD (or any dayjs-parseable) date to the API's YYYY/MM/DD format. */
function toSlashDate(d) {
    return String(d).trim().replace(/-/g, "/");
}

/**
 * Submit a ticket-report generation request. Returns the requestId.
 * from/to accepted as YYYY-MM-DD or YYYY/MM/DD (normalised to slashes).
 */
async function submitTicketRequest(page, { userId, pobIds, from, to }) {
    const body = JSON.stringify({
        requestDateFrom: toSlashDate(from),
        requestDateTo: toSlashDate(to),
        pobIds: ["ALL", ...pobIds],
    });
    const res = await page.evaluate(async (url, headers, body) => {
        try {
            const r = await fetch(url, { method: "POST", headers, body, credentials: "include" });
            const t = await r.text();
            return { status: r.status, text: t.slice(0, 5000) };
        } catch (e) {
            return { status: -1, text: String(e) };
        }
    }, BASE, { "Content-Type": "application/json", Accept: "application/json, text/plain, */*", ...TENANT_HEADERS(userId) }, body);

    if (res.status < 200 || res.status >= 300) {
        throw new Error(`Ticket submit failed: status=${res.status} body=${(res.text || "").slice(0, 200)}`);
    }
    let requestId;
    try { requestId = JSON.parse(res.text)?.result?.requestId; } catch (e) { /* fall through */ }
    if (!requestId) throw new Error(`Ticket submit: no requestId in response: ${(res.text || "").slice(0, 200)}`);
    return requestId;
}

/**
 * Poll the download endpoint until the report is ready, then return the xlsx Buffer.
 * The endpoint returns 500 "Report not ready ... IN_PROGRESS" until CREATED, then 200 xlsx.
 * Returns { ok: true, buffer } on success; throws on hard failure or timeout.
 */
async function downloadTicketReport(page, { userId, requestId, maxWaitMs = 600000, pollIntervalMs = 8000, userLogger } = {}) {
    const deadline = Date.now() + maxWaitMs;
    let polls = 0;

    while (Date.now() < deadline) {
        polls++;
        // Poll the LIST endpoint for OUR request's status (authoritative — the download
        // endpoint just 500s "not ready" while IN_PROGRESS and never reflects FAILED).
        const listRes = await page.evaluate(async (url, headers) => {
            try {
                const r = await fetch(url, { headers, credentials: "include" });
                return { status: r.status, text: (await r.text()).slice(0, 200000) };
            } catch (e) {
                return { status: -1, text: String(e) };
            }
        }, BASE, { Accept: "application/json", ...TENANT_HEADERS(userId) });

        let mine = null;
        try { mine = (JSON.parse(listRes.text).result || []).find((x) => x.requestId === requestId); } catch (e) { /* keep polling */ }
        const status = mine?.status;

        if (status === "FAILED") {
            const desc = mine.errorDesc || "";
            // "No Tickets found for report generation" = the seller simply has no tickets in
            // the range → NOT a failure, treat as no-data / skip.
            if (/no tickets found/i.test(desc)) {
                return { ok: false, noData: true, reason: desc };
            }
            throw new Error(`Ticket generation FAILED: ${desc || "unknown error"}`);
        }

        if (status === "CREATED") {
            // Ready — fetch the xlsx (single GET on the download endpoint).
            const dl = await page.evaluate(async (url, headers) => {
                try {
                    const r = await fetch(url, { headers, credentials: "include" });
                    const buf = new Uint8Array(await r.arrayBuffer());
                    let bin = ""; const CH = 0x8000;
                    for (let i = 0; i < buf.length; i += CH) bin += String.fromCharCode.apply(null, buf.subarray(i, i + CH));
                    let text = "";
                    if (buf.length < 4000) { try { text = new TextDecoder().decode(buf); } catch (e) { /* binary */ } }
                    return { status: r.status, len: buf.length, b64: btoa(bin), text };
                } catch (e) {
                    return { status: -1, text: String(e) };
                }
            }, `${BASE}/${requestId}/download`, { Accept: "application/json, text/plain, */*", ...TENANT_HEADERS(userId) });

            const buffer = dl.b64 ? Buffer.from(dl.b64, "base64") : Buffer.alloc(0);
            if (dl.status === 200 && buffer.slice(0, 2).toString("latin1") === "PK" && buffer.length > 0) {
                return { ok: true, buffer, totalTickets: mine.totalTickets };
            }
            // CREATED but download not a file yet — brief retry (rare race).
            if (userLogger) userLogger.debug(`⏳ CREATED but download not ready (status ${dl.status}); retrying...`);
        } else if (userLogger && polls % 3 === 0) {
            userLogger.debug(`⏳ Ticket report status: ${status || "(request not listed yet)"} (poll ${polls})`);
        }

        await new Promise((r) => setTimeout(r, pollIntervalMs));
    }
    throw new Error(`Ticket report not ready within ${Math.round(maxWaitMs / 1000)}s (never reached CREATED/FAILED)`);
}

module.exports = { submitTicketRequest, downloadTicketReport, getUserId, getPobIds, toSlashDate };
