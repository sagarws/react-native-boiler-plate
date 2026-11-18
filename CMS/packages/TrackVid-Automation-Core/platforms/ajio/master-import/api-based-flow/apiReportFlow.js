/**
 * AJIO report download via direct API — called from INSIDE a logged-in puppeteer page
 * (page.evaluate + fetch). The browser attaches its own cookies (incl. HttpOnly
 * bff_session) + Akamai _abck + real Chrome TLS fingerprint, so no manual Cookie header
 * is needed and Akamai sees a legitimate continuation. Same-origin requests only.
 *
 * Replaces the fragile UI navigation (sidebar accordion / PoB & report-type dropdowns /
 * View + Export buttons) that broke when AJIO revamped the portal to "Seller Central".
 *
 * Verified 2026-07-29 (navlik test account). See memory: project_ajio_report_api_flow.
 */

// Report-type label (from configBuilder) -> download endpoint path.
const REPORT_ENDPOINTS = {
    "Dropship Order Report": "/malekith/vision/v1/dropship/order/report/download",
    "Dropship Rtv Report": "/malekith/vision/v1/dropship/rtv/report/download",
};

// AJIO caps a single report request to 31 days. Keep a small safety margin.
const MAX_CHUNK_DAYS = 30;

const GUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/**
 * Read the seller's AJIO userId from browser storage after login.
 * Primary source: localStorage "activeSellerProfileId". Falls back to the first GUID
 * found across local/session storage. Returns null if none found.
 */
async function getUserId(page, { maxWaitMs = 15000, pollMs = 500 } = {}) {
    // Poll because after the SSO callback the SPA needs a beat to hydrate localStorage. This
    // lets the API flow skip the slow post-login popup dismissals (which incidentally provided
    // that hydration delay) — it waits only as long as the id actually takes to appear.
    const readOnce = () => page.evaluate(() => {
        const direct = localStorage.getItem("activeSellerProfileId");
        const GUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
        if (direct && GUID.test(direct)) return direct.match(GUID)[0];
        // fallback: scan all storage for a GUID
        const blobs = [];
        for (let i = 0; i < localStorage.length; i++) blobs.push(localStorage.getItem(localStorage.key(i)));
        for (let i = 0; i < sessionStorage.length; i++) blobs.push(sessionStorage.getItem(sessionStorage.key(i)));
        for (const b of blobs) { const m = (b || "").match(GUID); if (m) return m[0]; }
        return null;
    }).catch(() => null);

    const deadline = Date.now() + maxWaitMs;
    for (;;) {
        const id = await readOnce();
        if (id) return id;
        if (Date.now() >= deadline) return null;
        await new Promise((r) => setTimeout(r, pollMs));
    }
}

/**
 * Fetch the seller's PoB (place-of-business) ids via the work-places API, in-page.
 * Pages through results (size=100) in case a seller has many PoBs.
 * Returns { pobIds: string[], stores: [{id, storeName}] }.
 * Throws on a non-2xx first-page response so the caller can fail the account cleanly.
 */
async function getPobIds(page, userId) {
    const all = [];
    let pageNum = 0;
    const size = 100;
    // Guard against runaway pagination.
    for (let guard = 0; guard < 20; guard++) {
        const url = `/malekith/nickfury/v1/sellers/${userId}/work-places?workPlaceType=POB&page=${pageNum}&size=${size}`;
        const res = await page.evaluate(async (u) => {
            try {
                const r = await fetch(u, { headers: { Accept: "application/json", "X-Tenant": "AJIO" } });
                const text = await r.text();
                return { status: r.status, text: text.slice(0, 500000) };
            } catch (e) {
                return { status: -1, text: String(e) };
            }
        }, url);

        if (res.status < 200 || res.status >= 300) {
            if (pageNum === 0) throw new Error(`work-places API failed: status=${res.status} body=${res.text.slice(0, 200)}`);
            break; // later page failed — return what we have
        }
        let json;
        try { json = JSON.parse(res.text); } catch (e) { throw new Error(`work-places API returned non-JSON: ${res.text.slice(0, 200)}`); }
        const content = json.content || [];
        for (const c of content) if (c && c.id) all.push({ id: c.id, storeName: c.storeName });
        if (json.last === true || content.length < size || json.totalPages == null || pageNum >= json.totalPages - 1) break;
        pageNum++;
    }
    return { pobIds: all.map((s) => s.id), stores: all };
}

/**
 * Download one report for a single date window (must be <= 31 days), in-page.
 * Returns:
 *   { ok: true,  buffer: Buffer, contentType }            on 200 (xlsx)
 *   { ok: false, noData: true, status, body }             on 404 "No records found"
 *   { ok: false, noData: false, status, body }            on any other status / error
 */
async function downloadReport(page, { reportType, pobIds, from, to }) {
    const endpoint = REPORT_ENDPOINTS[reportType];
    if (!endpoint) throw new Error(`Unknown reportType "${reportType}" — no API endpoint mapped`);
    const pobCsv = pobIds.join(",");
    const primaryPob = pobIds[0] || "";
    // AJIO changed the download API on/around 2026-08-20: GET → POST, and pobIds moved
    // from the query string into a form-urlencoded body. from/to stay in the query string.
    const url = `${endpoint}?from=${from}&to=${to}`;

    const res = await page.evaluate(async (u, pob, csv) => {
        try {
            const r = await fetch(u, {
                method: "POST",
                headers: {
                    Accept: "application/json, text/plain, */*",
                    "Content-Type": "application/x-www-form-urlencoded",
                    "X-Tenant": "AJIO",
                    businessModel: "B2C",
                    "x-pob-id": pob,
                },
                credentials: "include",
                body: "pobIds=" + encodeURIComponent(csv),
            });
            const ct = r.headers.get("content-type") || "";
            const buf = new Uint8Array(await r.arrayBuffer());
            let bin = "";
            const CH = 0x8000;
            for (let i = 0; i < buf.length; i += CH) bin += String.fromCharCode.apply(null, buf.subarray(i, i + CH));
            return { status: r.status, contentType: ct, len: buf.length, b64: btoa(bin) };
        } catch (e) {
            return { status: -1, contentType: "", len: 0, b64: "", err: String(e) };
        }
    }, url, primaryPob, pobCsv);

    if (res.err) return { ok: false, noData: false, status: res.status, body: res.err };

    const buffer = res.b64 ? Buffer.from(res.b64, "base64") : Buffer.alloc(0);
    const isXlsx = buffer.slice(0, 2).toString("latin1") === "PK";

    if (res.status === 200 && isXlsx) {
        return { ok: true, buffer, contentType: res.contentType };
    }

    // Non-200 (or 200 non-xlsx) — decode the JSON error body.
    const body = buffer.toString("utf8").slice(0, 500);
    const noData = res.status === 404 || /no records found/i.test(body);
    return { ok: false, noData, status: res.status, body };
}

module.exports = { REPORT_ENDPOINTS, MAX_CHUNK_DAYS, getUserId, getPobIds, downloadReport };
