/**
 * AJIO SPF (return) claim via direct API — called from inside a logged-in puppeteer page
 * (page.evaluate + fetch), so the browser attaches its own cookies + Akamai token +
 * fingerprint. Replaces the entire UI claim flow (navigate Returns → company-loop → search
 * table → Raise Ticket modal → issue/description → 6-side upload → create → Help Center).
 *
 * 7-call flow (verified 2026-07-30, navlik). All same-origin on seller.ajio.com.
 *   1. SEARCH   GET  /malekith/vision/v1/dashboard/dropship/return/pob/{pobId}/list?returnAwbNo=&from=&to=
 *                    headers: X-Tenant: AJIO, businessModel: B2C  → result.dropshipReturnList[].returnOrderNo
 *   2. DETAIL   GET  /malekith/gamora/vms/v1/return-orders/{returnOrderId}
 *                    headers: X-Tenant, x-integration-type, x-pob-id  → orderDetail fields
 *   3. GUARD    GET  /malekith/castellan/api/v1/tickets/return-order/{returnOrderId}  → existing tickets[]
 *   4. CREATE   POST /malekith/castellan/api/v1/tickets/spf  (json body)  → { result: { ticketId } }
 *   5. ATTACH   POST /malekith/castellan/api/v1/tickets/{ticketId}/attachments  (multipart "files")
 *   6. COMMENT  PUT  /malekith/castellan/api/v1/tickets/{ticketId}/comment  { comment }   (fallback)
 *   7. STATUS   GET  /malekith/castellan/api/v1/tickets?ticketId=&ticketDateRange=YYYY/MM/DD_YYYY/MM/DD
 *                    → result[].status ; CUSTOMER_REPLIED = success
 *
 * userId (= x-seller-id) + POB record come from the same work-places API Master Data uses.
 */
const axios = require("axios");
const dayjs = require("dayjs");
const fs = require("fs-extra");
const os = require("os");
const path = require("path");
const { withTransientRetry, TRANSIENT_RETRY_DELAYS_MS } = require("./common/transientRetry");
const { getUserId } = require("../../master-import/api-based-flow/apiReportFlow");
const { saveClaimResource, isEnabled: isSaveResourceEnabled } = require("../../../../common/resourceSaver");
const { isClaimSubmitDisabled, claimSubmitDisabledResult, assertClaimSubmitEnabled } = require("../../../../common/claimSubmitGuard");

const CASTELLAN = "/malekith/castellan/api/v1/tickets";

// Return-search date window. The search endpoints filter the return AWB WITHIN [from, to]
// (returnAwbNo/trackingNumber is exact, but the date range still scopes it) — a return whose
// createDate is older than this window returns 404 "No records found for pobId". Keep it wide so
// late-raised claims (esp. NOT DELIVERED RETURNS, 60+ days old) still resolve. Env-overridable.
const SEARCH_WINDOW_DAYS = Number(process.env.CLAIM_SEARCH_WINDOW_DAYS) || 365;

// ---- outcome messages -------------------------------------------------------------------
// Short, stable headlines for the two "AJIO has nothing to claim against" outcomes. These are
// what the BE stores in the job's `error` field and what the Monitor shows, so they are kept
// terse and constant — the diagnostics (identifiers, AJIO's own errorMessage, correlationId)
// are logged to the terminal at the point of failure instead of being packed in here.
const NOT_FOUND_MESSAGE = "AE1:No AWB number found under POB";
const NOT_CLAIMABLE_MESSAGE = "AE2:Searchable but not claimable";

// ---- header builders ----
const castellanHeaders = (sellerId) => ({ "X-Tenant": "AJIO", "X-Tenant-Id": "AJIO", "x-seller-id": sellerId });

// ---- S3 object URL for the TrackVid-stored PDF (same scheme the UI script used) ----
function getObjectURL(fileKey) {
    const region = process.env.AWS_BUCKET_REGION;
    const bucket = process.env.AWS_BUCKET_NAME;
    return `https://s3.${region}.amazonaws.com/${bucket}/${fileKey}`;
}

// ---- HTML email body -> plain-text claim description (ported from scriptNew.fillDescription) ----
function htmlToText(html) {
    if (!html) return "";
    html = String(html);
    html = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "");
    html = html.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "");
    html = html.replace(/<a [^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/gi, (_, href) => href);
    html = html.replace(/<br\s*\/?>/gi, "\n");
    html = html.replace(/<\/p>/gi, "\n");
    html = html.replace(/<\/li>/gi, "\n");
    html = html.replace(/<li[^>]*>/gi, "\n");
    html = html.replace(/<[^>]+>/g, "");
    html = html.replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<")
        .replace(/&gt;/gi, ">").replace(/&quot;/gi, '"').replace(/&#39;/gi, "'");
    html = html.replace(/\n{2,}/g, "\n\n");
    html = html.split("\n").map((l) => l.replace(/[ \t]+/g, " ").trim()).join("\n").replace(/\n{2,}/g, "\n\n").trim();
    return html;
}

/**
 * AJIO's error envelope is { errorCode, errorMessage, correlationId } — e.g. a 404 from the
 * vision return list answers:
 *   { "errorCode": 404, "errorMessage": "No records found for pobId: {} DV00352054", ... }
 * errorMessage is the ONLY part that says why, so it is what we surface everywhere instead of
 * a generic "status=404 body=…". Some endpoints use { message } / { error } instead; a non-JSON
 * body (Akamai HTML, gateway page) falls back to a trimmed snippet.
 * Kept in step with ajioReturnDeliveredAutoClaim/utils/claimApiFlow.js.
 */
function apiErrorMessage(res) {
    const j = res && res.json;
    if (j && typeof j === "object") {
        for (const key of ["errorMessage", "message", "error", "errorDescription"]) {
            const v = j[key];
            if (typeof v === "string" && v.trim()) return v.trim();
        }
    }
    const snippet = String((res && res.text) || "").replace(/\s+/g, " ").trim();
    if (snippet) return snippet.slice(0, 300);
    return `HTTP ${res ? res.status : "?"}`;
}

/**
 * Build an Error carrying AJIO's own wording plus the machine-readable bits. Callers that need
 * to branch on the status read `err.status` (see the detail-404 → not_claimable branch in
 * raiseClaim) rather than string-matching the message.
 */
function apiError(res, what) {
    const message = apiErrorMessage(res);
    const err = new Error(`${what}: ${message} (HTTP ${res ? res.status : "?"})`);
    err.status = res ? res.status : -1;
    err.errorMessage = message;
    err.errorCode = (res && res.json && res.json.errorCode) != null ? res.json.errorCode : null;
    err.correlationId = (res && res.json && res.json.correlationId) || null;
    return err;
}

/**
 * Terminal log for EVERY AJIO API response >= 400 (and for a transport failure, status -1).
 * Logging at the call site means the reason reaches the log even when the caller deliberately
 * swallows the status — the vision 404 that falls back to the VMS endpoint, the existing-tickets
 * lookup that degrades to "no existing", the status poll that returns null. correlationId is what
 * AJIO support asks for, so it is always included when present.
 */
function logApiError(res, userLogger) {
    const j = (res && res.json) || {};
    const parts = [`❌ AJIO API ${(res && res.method) || "GET"} ${(res && res.url) || "?"} → HTTP ${res ? res.status : "?"}`];
    if (j.errorCode != null) parts.push(`errorCode=${j.errorCode}`);
    parts.push(`errorMessage="${apiErrorMessage(res)}"`);
    if (j.correlationId) parts.push(`correlationId=${j.correlationId}`);
    const line = parts.join(" ");
    if (userLogger && typeof userLogger.error === "function") userLogger.error(line);
    else console.error(line);
}

/**
 * Generic in-page JSON fetch. Returns { status, json, text, url, method }.
 * Any status >= 400 (and a transport failure, status -1) is logged to the terminal here.
 */
async function apiJson(page, url, { method = "GET", headers = {}, body = null, userLogger = null, retryDelays = TRANSIENT_RETRY_DELAYS_MS } = {}) {
    // A GET that comes back busy (503 & co.) is asked again — see common/transientRetry.
    // POST/PUT are sent once, exactly as before.
    const send = () => page.evaluate(async (url, method, headers, body) => {
        try {
            const opt = { method, headers, credentials: "include" };
            if (body != null) opt.body = body;
            const r = await fetch(url, opt);
            const text = await r.text();
            let json = null;
            try { json = JSON.parse(text); } catch (e) { /* non-json */ }
            return { status: r.status, json, text: text.slice(0, 4000) };
        } catch (e) {
            return { status: -1, json: null, text: String(e) };
        }
    }, url, method, headers, body);
    const res = await withTransientRetry(send, { method, url, delays: retryDelays, userLogger });

    res.url = url;
    res.method = method;
    if (res.status === -1 || res.status >= 400) logApiError(res, userLogger);
    return res;
}

/**
 * Full POB record from work-places (storeName, pincode, integrationType, contact, businessModel).
 * These populate the claim body's storeName / seller contact / x-integration-type header.
 */
async function getPobRecord(page, sellerId, pobid, { userLogger } = {}) {
    const url = `/malekith/nickfury/v1/sellers/${sellerId}/work-places?workPlaceType=POB&page=0&size=100`;
    const res = await apiJson(page, url, { headers: { Accept: "application/json", "X-Tenant": "AJIO" }, userLogger });
    if (res.status < 200 || res.status >= 300) throw apiError(res, "work-places failed");
    if (!res.json) throw apiError(res, "work-places returned a non-JSON body");
    const pob = (res.json.content || []).find((c) => c.id === pobid);
    if (!pob) throw new Error(`POB ${pobid} not found in work-places`);
    return {
        id: pob.id,
        storeName: pob.storeName,
        pincode: pob.address?.pinCode,
        integrationType: pob.integrationType, // e.g. VMS_OMSGURU
        businessModel: pob.businessModel || "B2C",
        mobileNumber: pob.mobileNumber,
        emailId: pob.emailId,
        fulfilmentType: pob.fulfilmentType || "DROPSHIP",
    };
}

/** AWB equality: trim + case-insensitive. Empty/missing never matches. */
const awbEq = (a, b) => {
    const x = String(a || "").trim().toUpperCase();
    const y = String(b || "").trim().toUpperCase();
    return !!x && x === y;
};

/**
 * SEARCH (vision / dropship list): Return AWB -> returnOrderId (POB-scoped). Returns null if not found.
 *
 * This is the endpoint AJIO's own seller UI uses for the returns table, and it serves dropship POBs
 * on BOTH API and VMS accounts (verified 2026-08-22 on VMS_INCREFF POB DV00332648: this endpoint
 * returned the return that the VMS/gamora search reported as missing).
 *
 * A 404 here means "no row for this AWB in [from,to]" — NOT "endpoint unsupported for this POB".
 * Verified on the same POB: valid AWB -> 200 + row, bogus AWB -> 404. So we return null instead of
 * throwing, letting the caller fall back to the VMS endpoint.
 */
async function searchReturnByAwb(page, { pobid, returnAwb, from, to, userLogger, misses }) {
    const url = `/malekith/vision/v1/dashboard/dropship/return/pob/${pobid}/list?returnAwbNo=${encodeURIComponent(returnAwb)}&from=${from}&to=${to}&size=10&page=0`;
    const res = await apiJson(page, url, { headers: { Accept: "application/json", "X-Tenant": "AJIO", businessModel: "B2C" }, userLogger });
    if (res.status === 404) {
        // No match for this AWB in this POB/window. Keep AJIO's own wording (e.g. "No records
        // found for pobId: {} DV00352054") for the terminal log; apiJson already printed the
        // raw response.
        misses?.push(`vision: ${apiErrorMessage(res)}`);
        return null;
    }
    if (res.status < 200 || res.status >= 300) throw apiError(res, "return search failed");
    const list = res.json?.result?.dropshipReturnList || [];
    // Match the AWB EXACTLY. returnAwbNo is a server-side filter, so rows that don't carry our AWB
    // mean the filter was ignored (the unfiltered list returns the POB's 10 newest returns) —
    // taking list[0] there would raise the claim against someone else's return order.
    const row = list.find((r) => awbEq(r.returnAwbNo, returnAwb));
    if (!row) {
        misses?.push(`vision: HTTP ${res.status} but no row matching AWB ${returnAwb}${list.length ? ` (${list.length} unrelated row(s) returned — server-side filter ignored)` : " (empty list)"}`);
    }
    return row ? row.returnOrderNo : null;
}

/**
 * SEARCH (vision): a return order number OR a return AWB -> the whole row.
 *
 * THE SAME ENDPOINT AS `searchReturnByAwb`, with two differences that matter:
 * it filters on `returnOrderNo` when given one, and it returns the ROW rather
 * than just the order number — the POB fill needs `returnAwbNo` and the row's
 * other fields, not an id it already has.
 *
 * WHY A RETURN ORDER SEARCH EXISTS AT ALL. The bulk-claim sheet an operator can
 * actually produce often carries RT numbers and nothing else, and this list is
 * the LIVE one the seller portal itself shows — so it answers for a return
 * created yesterday, which the nightly report has not carried yet.
 *
 * THE EXACT MATCH IS NOT OPTIONAL. The filter is server-side, and an AJIO build
 * that ignores it answers with the POB's ten newest returns instead. Taking
 * `list[0]` there would attach a claim to a stranger's return order — the same
 * trap `searchReturnByAwb` documents, for the same reason.
 */
async function searchReturnRow(page, { pobid, returnOrderNo, returnAwb, from, to, userLogger, misses }) {
    const wanted = String(returnOrderNo || "").trim();
    const wantedAwb = String(returnAwb || "").trim();
    const filter = wanted
        ? `returnOrderNo=${encodeURIComponent(wanted)}`
        : `returnAwbNo=${encodeURIComponent(wantedAwb)}`;
    const url = `/malekith/vision/v1/dashboard/dropship/return/pob/${pobid}/list?&${filter}&from=${from}&to=${to}&size=10&page=0`;
    const res = await apiJson(page, url, {
        headers: { Accept: "application/json", "X-Tenant": "AJIO", businessModel: "B2C" },
        userLogger,
    });

    if (res.status === 404) {
        // AJIO's own wording — "No records found for pobId: …" — is the useful
        // half of a miss, so it is kept rather than flattened.
        misses?.push(`vision: ${apiErrorMessage(res)}`);

        return null;
    }

    if (res.status < 200 || res.status >= 300) throw apiError(res, "return search failed");

    const list = res.json?.result?.dropshipReturnList || [];
    const row = list.find((entry) =>
        wanted
            ? String(entry?.returnOrderNo || "").trim().toUpperCase() === wanted.toUpperCase()
            : awbEq(entry?.returnAwbNo, wantedAwb)
    );

    if (!row) {
        misses?.push(
            `vision: HTTP ${res.status} but no row matching ${wanted || wantedAwb}` +
                (list.length ? ` (${list.length} unrelated row(s) — server-side filter ignored)` : " (empty list)")
        );
    }

    return row || null;
}

/**
 * SEARCH (VMS accounts): Return AWB -> returnOrderId.
 * VMS accounts use a different endpoint (/malekith/gamora/vms/v1/return-orders) which filters
 * server-side by `trackingNumber` (the return AWB). Differences vs the API/vision endpoint:
 * orderDateRange=YYYY/MM/DD_YYYY/MM/DD (slashes), headers X-Tenant + x-pob-id (no businessModel),
 * result[].{returnOrderId,trackingNumber}. Returns null if not found in the window.
 */
async function searchReturnByAwbVMS(page, { pobid, returnAwb, userLogger, misses }) {
    const wanted = String(returnAwb).trim();
    // The VMS gamora endpoint returns EMPTY when orderDateRange spans too wide (it silently caps
    // the span — a 365-day range yields 0 results). trackingNumber is an exact filter, so we OMIT
    // orderDateRange entirely: this finds the return regardless of age. (Verified: with
    // orderDateRange=365d → 0 results; without any orderDateRange → found.)
    const url = `/malekith/gamora/vms/v1/return-orders?page=0&size=10&sort=desc&trackingNumber=${encodeURIComponent(wanted)}`;
    const res = await apiJson(page, url, { headers: { Accept: "application/json", "X-Tenant": "AJIO", "x-pob-id": pobid }, userLogger });
    if (res.status < 200 || res.status >= 300) throw apiError(res, "VMS return search failed");
    const list = res.json?.result || [];
    // Exact match only — trackingNumber is a server-side filter, so a non-matching row means the
    // filter was ignored; claiming list[0] there would target the wrong return order.
    const row = list.find((r) => awbEq(r.trackingNumber, wanted));
    if (!row) {
        misses?.push(`VMS: HTTP ${res.status} but no row matching AWB ${wanted}${list.length ? ` (${list.length} unrelated row(s) returned — server-side filter ignored)` : " (empty list)"}`);
    }
    return row ? row.returnOrderId : null;
}

/**
 * SEARCH (router): Return AWB -> returnOrderId, trying BOTH search endpoints.
 *
 * Which endpoint serves a return is decided by AJIO per POB (integrationType), not per account:
 * a VMS-tagged account can hold dropship POBs whose returns only appear in the vision list, and an
 * API-tagged account can hold POBs only gamora serves. Routing on credentials.accountType alone
 * therefore failed for EVERY AWB of such a POB ("not found under POB (VMS)") even though the AJIO
 * UI resolved the same AWB fine.
 *
 * `preferVMS` only decides which endpoint is tried FIRST (so the path that already works for an
 * account stays first and its behaviour is unchanged); the other is tried only on a clean miss.
 * Both endpoints filter server-side by the exact AWB and both feed the same
 * gamora /vms/v1/return-orders/{id} detail call, so a hit from either is the same return order.
 *
 * Errors are never swallowed into a false "not found": if no id is resolved and an endpoint
 * errored, the first error is rethrown.
 */
async function resolveReturnOrderId(page, { pobid, returnAwb, from, to, preferVMS = false, userLogger, misses = [] }) {
    const vision = ["vision", () => searchReturnByAwb(page, { pobid, returnAwb, from, to, userLogger, misses })];
    const vms = ["VMS", () => searchReturnByAwbVMS(page, { pobid, returnAwb, userLogger, misses })];
    const attempts = preferVMS ? [vms, vision] : [vision, vms];

    let firstError = null;
    for (const [label, run] of attempts) {
        let id = null;
        try {
            id = await run();
        } catch (err) {
            if (!firstError) firstError = err;
            misses.push(`${label}: ${err.errorMessage || err.message}`);
            userLogger?.warn?.(`⚠️ ${label} return search errored (${err.message}) — trying the other endpoint`);
            continue;
        }
        if (id) {
            userLogger?.info(`🔎 return search resolved via ${label} endpoint`);
            return id;
        }
        userLogger?.info(`🔎 ${label} return search: no match for AWB ${returnAwb}`);
    }
    if (firstError) throw firstError; // don't report a transport/auth failure as "not found"
    return null;
}

/** DETAIL: return-order details for the claim body. */
async function getReturnOrderDetail(page, { returnOrderId, pobid, integrationType, userLogger }) {
    const url = `/malekith/gamora/vms/v1/return-orders/${returnOrderId}`;
    const res = await apiJson(page, url, { headers: { Accept: "application/json", "X-Tenant": "AJIO", "x-integration-type": integrationType, "x-pob-id": pobid }, userLogger });
    if (res.status < 200 || res.status >= 300) throw apiError(res, "return-order detail failed");
    if (!res.json?.result) throw apiError(res, "return-order detail returned no result");
    return res.json.result;
}

/** GUARD: existing tickets for this return order (already-raised check). */
async function getExistingTickets(page, { sellerId, returnOrderId, userLogger }) {
    const url = `${CASTELLAN}/return-order/${returnOrderId}`;
    const res = await apiJson(page, url, { headers: { Accept: "application/json", ...castellanHeaders(sellerId) }, userLogger });
    if (res.status < 200 || res.status >= 300) return []; // treat lookup failure as "no existing" — create will still guard
    return res.json?.result || [];
}

/**
 * Pick — and VALIDATE — the return article this claim is for. A return AWB can hold multiple
 * articles (returnOrderItems[]), each with its own returnItemId/sku/quantity.
 *
 * The CMS validates the seller SKU against master data at creation, so the job always passes a
 * `sku`. We use it as a GATE: it MUST match an article in the return (against sellerSkuId /
 * sterlingSkuId / itemCode / ean / scanCode, case/space-insensitive) — otherwise we DON'T raise
 * (the AWB/SKU pairing is wrong). Only when no sku is given do we fall back to the single article.
 *
 * Matching runs in two passes so a pure formatting difference isn't treated as a mismatch:
 *   1. exact  — trimmed + lowercased
 *   2. loose  — same, with every non-alphanumeric character stripped, so the CMS's
 *               "Cargo-33-Grey-S" still matches AJIO's "Cargo33GreyS" (and vice versa).
 * The loose pass only strips punctuation — it never matches a different SKU, so the gate holds.
 */
const SKU_MATCH_FIELDS = ["sellerSkuId", "sterlingSkuId", "itemCode", "eanCode", "scanCode"];

function selectReturnItem(items, sku, userLogger) {
    const list = items || [];
    const norm = (s) => String(s || "").trim().toLowerCase();
    // Separator-insensitive form: drop hyphens, underscores, spaces, slashes, dots…
    const loose = (s) => norm(s).replace(/[^a-z0-9]/g, "");
    const skuFields = (it) => SKU_MATCH_FIELDS.map((f) => (it.product || {})[f]);
    // Show every identifier we actually compared, so a real mismatch is diagnosable
    // (a bare sellerSkuId prints "?" whenever AJIO returns the SKU on another field).
    const skuList = () => list.map((it) => skuFields(it).filter(Boolean).join("|") || "?").join(", ");

    if (sku && norm(sku)) {
        // Pass 1 — exact.
        const match = list.find((it) => skuFields(it).some((v) => norm(v) === norm(sku)));
        if (match) return match;

        // Pass 2 — format-normalized retry.
        const target = loose(sku);
        const looseMatch = target && list.find((it) => skuFields(it).some((v) => loose(v) && loose(v) === target));
        if (looseMatch) {
            const matched = skuFields(looseMatch).find((v) => loose(v) === target);
            userLogger?.info(`🔁 SKU "${sku}" matched "${matched}" after format normalization (both → "${target}")`);
            return looseMatch;
        }

        // SKU given but not found in the return → validation failure, do NOT raise a wrong claim.
        throw new Error(`SKU validation failed: "${sku}" not found in the return's article(s) [${skuList()}] — claim not raised`);
    }

    // No sku provided.
    if (list.length > 1) {
        throw new Error(`Return has ${list.length} articles [${skuList()}] but no sku was provided — cannot pick the right one`);
    }
    return list[0] || {};
}

/** Assemble the /tickets/spf request body from the detail + POB + claim inputs. */
function buildSpfBody({ detail, pob, typeOfClaim, description, sellerEmailFallback, sku }) {
    const item = selectReturnItem(detail.returnOrderItems, sku);
    const product = item.product || {};
    return {
        assignmentGroup: `Primary_${pob.businessModel || "B2C"}`,
        description,
        issueTitle: `Claiming SPF | Return Order ID: ${detail.returnOrderId}`,
        subIssueType: typeOfClaim,
        orderId: detail.orderId,
        priority: "CRITICAL",
        sellerContactNo: pob.mobileNumber,
        sellerEmail: pob.emailId || sellerEmailFallback,
        storeName: pob.pincode ? `${pob.storeName} - ${pob.pincode}` : pob.storeName,
        issueType: "RETURNS",
        pobId: pob.id,
        fulfilmentType: pob.fulfilmentType || "DROPSHIP",
        tenant: "AJIO",
        ticketType: "SPF",
        orderDetail: {
            customerOrderId: detail.salesOrderId,
            forwardPONumber: detail.forwardPONumber,
            forwardShipmentId: detail.forwardShipmentId,
            forwardInvoiceNumber: detail.forwardInvoiceNumber,
            forwardAwbNumber: detail.forwardAwbNumber,
            forwardInvoiceAmount: item.fwdInvoiceBasePrice,
            returnOrderId: detail.returnOrderId,
            returnAwbNumber: detail.trackingNumber, // return AWB
            returnShipmentId: detail.returnShipmentId,
            productDescription: product.productName,
            jioCode: product.itemCode,
            ean: product.eanCode,
            skuId: product.sellerSkuId,
            quantity: item.returnQuantity,
            returnCarrier: detail.returnCarrier,
            forwardCarrier: detail.forwardCarrier,
            returnType: detail.returnType,
            returnCreationDate: detail.returnDate,
            returnItemId: item.returnItemId,
        },
    };
}

/** CREATE the SPF claim. Returns ticketId. */
async function createSpfClaim(page, { sellerId, body, userLogger }) {
    // Backstop for direct callers — raiseClaim already returns before reaching here
    // when DESABLE_SAVE=true.
    assertClaimSubmitEnabled("AJIO", "POST /tickets/spf (create claim)");
    const res = await apiJson(page, `${CASTELLAN}/spf`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json, text/plain, */*", ...castellanHeaders(sellerId) },
        body: JSON.stringify(body),
        userLogger,
    });
    if (res.status < 200 || res.status >= 300) throw apiError(res, "claim create failed");
    const ticketId = res.json?.result?.ticketId;
    if (!ticketId) throw apiError(res, "claim create returned no ticketId");
    return ticketId;
}

/** ATTACH the PDF (multipart). pdfBase64 = base64 of the file bytes. */
async function uploadClaimAttachment(page, { sellerId, ticketId, pdfBase64, fileName, userLogger }) {
    const res = await page.evaluate(async (url, headers, b64, fileName) => {
        try {
            const bin = atob(b64);
            const bytes = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
            const blob = new Blob([bytes], { type: "application/pdf" });
            const fd = new FormData();
            fd.append("files", blob, fileName);
            // NOTE: do NOT set Content-Type — the browser adds the multipart boundary.
            const r = await fetch(url, { method: "POST", headers, body: fd, credentials: "include" });
            const text = await r.text();
            return { status: r.status, text: text.slice(0, 2000) };
        } catch (e) {
            return { status: -1, text: String(e) };
        }
    }, `${CASTELLAN}/${ticketId}/attachments`, castellanHeaders(sellerId), pdfBase64, fileName);
    // This one builds its own multipart request rather than going through apiJson, so parse the
    // envelope and run the same >= 400 terminal log by hand.
    res.url = `${CASTELLAN}/${ticketId}/attachments`;
    res.method = "POST";
    try { res.json = JSON.parse(res.text); } catch (e) { res.json = null; }
    if (res.status === -1 || res.status >= 400) logApiError(res, userLogger);
    if (res.status < 200 || res.status >= 300) throw apiError(res, "attachment upload failed");
    return true;
}

/** COMMENT (PUT) — the fallback "activity" that flips UN_ATTENDED -> CUSTOMER_REPLIED. */
async function postClaimComment(page, { sellerId, ticketId, comment, userLogger }) {
    const res = await apiJson(page, `${CASTELLAN}/${ticketId}/comment`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Accept: "application/json, text/plain, */*", ...castellanHeaders(sellerId) },
        body: JSON.stringify({ comment }),
        userLogger,
    });
    return res.status >= 200 && res.status < 300;
}

/** STATUS: read the ticket's current status via the tickets list. */
async function getTicketStatus(page, { sellerId, ticketId, from, to, userLogger }) {
    const range = `${from.replace(/-/g, "/")}_${to.replace(/-/g, "/")}`;
    const url = `${CASTELLAN}?page=0&size=10&sort=desc&ticketId=${ticketId}&ticketDateRange=${encodeURIComponent(range)}`;
    const res = await apiJson(page, url, { headers: { Accept: "application/json", ...castellanHeaders(sellerId) }, userLogger });
    const row = (res.json?.result || []).find((r) => String(r.ticketId) === String(ticketId));
    return row ? row.status : null;
}

/**
 * Download the sixSideImages PDF (Node-side, S3) → base64.
 * Returns { base64, fileName } or throws.
 */
async function downloadAttachmentPdf(configEntry, saveCtx = {}) {
    const fileKey = configEntry.sixSideImages?.fileKey;
    if (!fileKey) throw new Error("no sixSideImages.fileKey in configEntry");
    const url = getObjectURL(fileKey);
    const resp = await axios.get(url, { responseType: "arraybuffer", timeout: 120000 });
    const buf = Buffer.from(resp.data);
    // Name the file by return AWB (matches the UI's "<AWB> - Side Images.pdf").
    const fileName = `${configEntry.awbNumber || "claim"} - Side Images.pdf`;
    // In-memory upload path — spill to a temp file only when SAVE_RESOURCE is on.
    if (isSaveResourceEnabled() && (saveCtx.awbNumber || configEntry.awbNumber)) {
        const tmp = path.join(os.tmpdir(), `updated-ac-${Date.now()}-${fileName}`);
        try {
            await fs.writeFile(tmp, buf);
            await saveClaimResource({
                srcPath: tmp,
                companyId: saveCtx.companyId,
                companyName: saveCtx.companyName,
                awbNumber: saveCtx.awbNumber || configEntry.awbNumber,
                filename: fileName,
            });
        } finally {
            await fs.remove(tmp).catch(() => { });
        }
    }
    return { base64: buf.toString("base64"), fileName };
}

/**
 * Ensure the ticket reaches CUSTOMER_REPLIED. Poll status; if it stays UN_ATTENDED, post a
 * comment (fallback) once, then keep polling. Returns the final status.
 */
async function ensureCustomerReplied(page, { sellerId, ticketId, from, to, maxWaitMs = 120000, userLogger }) {
    const deadline = Date.now() + maxWaitMs;
    let commented = false;
    let last = null;
    while (Date.now() < deadline) {
        const status = await getTicketStatus(page, { sellerId, ticketId, from, to, userLogger });
        last = status;
        if (status === "CUSTOMER_REPLIED") return status;
        if (!commented && (status === "UN_ATTENDED" || status == null)) {
            if (userLogger) userLogger.info(`💬 Ticket ${ticketId} still ${status || "unknown"} — posting comment to nudge to CUSTOMER_REPLIED...`);
            await postClaimComment(page, { sellerId, ticketId, comment: "Please check and review it as soon as possible", userLogger }).catch(() => { });
            commented = true;
        }
        await new Promise((r) => setTimeout(r, 6000));
    }
    return last;
}

/**
 * Attach the proof PDF to an EXISTING ticketId, then ensure it reaches CUSTOMER_REPLIED.
 * Shared by the create path, the resume path, and the temp_ticket retry — so `ticketId` is
 * ALWAYS returned (even on failure), letting the caller persist it + mark "Help Center Failed".
 */
async function attachAndFinalize(page, { sellerId, ticketId, configEntry, from, to, userLogger, saveCtx = {} }) {
    try {
        const { base64, fileName } = await downloadAttachmentPdf(configEntry, saveCtx);
        await uploadClaimAttachment(page, { sellerId, ticketId, pdfBase64: base64, fileName, userLogger });
        userLogger?.info(`📎 Attachment uploaded to ${ticketId}: ${fileName}`);
    } catch (err) {
        // Ticket exists but the attachment failed → NOT a lost claim; return the ticketId so the
        // caller records it as "Help Center Failed" and a temp_ticket retry can finish it later.
        if (isSessionRejection(err)) {
            // The ticket EXISTS. Carrying its id through matters more than the
            // status: a retry that did not know would raise a second claim for
            // the same return.
            return { status: "auth_expired", ticketId, message: `attachment failed: ${err.message}` };
        }

        return { status: "failed", ticketId, message: `attachment failed: ${err.message}` };
    }
    const finalStatus = await ensureCustomerReplied(page, { sellerId, ticketId, from, to, userLogger });
    if (finalStatus === "CUSTOMER_REPLIED") return { status: "success", ticketId, finalStatus, message: `ticket ${ticketId} CUSTOMER_REPLIED` };
    return { status: "failed", ticketId, finalStatus, message: `ticket ${ticketId} status ${finalStatus} (not CUSTOMER_REPLIED)` };
}

/**
 * Did AJIO reject the session itself, rather than the claim?
 *
 * A 401 from any step means the jar this run started with is no longer signed
 * in — the session died between the in-page probe and now. That is recoverable
 * and every other platform's flow says so with `.code = "AUTH_EXPIRED"`, which
 * is what lets the caller sign in again and retry once.
 *
 * AJIO could not say it, because `raiseClaim` reports statuses instead of
 * throwing. So it says it as a status, and the callers map it.
 *
 * 401 ONLY. A 403 from AJIO is a permission answer about the POB or the return,
 * not a dead session — signing in again cannot change it, and Delhivery's flow
 * has the scar from treating one as the other: a full re-login burned before
 * failing the claim exactly the same way.
 */
function isSessionRejection(err) {
    return err && err.status === 401;
}

/**
 * Full claim orchestration for one AWB. Returns:
 *   { status: 'success'|'already_raised'|'not_found'|'failed'|'dry_run', ticketId, finalStatus, message }
 * Never throws — caller maps status to the TrackVid callback.
 */
async function raiseClaim(page, { sellerId, configEntry, credentials, userLogger, returnOrderId: directReturnOrderId, saveCtx = {} }) {
    const pobid = String(configEntry.pobid || "").trim();
    const returnAwb = String(configEntry.awbNumber || "").trim();
    // Either identifier will do, and the caller may put it in either place:
    // `bulkSpfRunner` passes the parameter, a caller holding only a config entry
    // has it on the entry. Read both so neither has to know which the other uses.
    const directRon = String(directReturnOrderId || configEntry.return_order_no || "").trim();
    if (!pobid) return { status: "failed", message: "pobid missing in configEntry" };
    // NOT "awbNumber missing". The AWB is a search key, not part of the claim —
    // everything after step 1 goes by returnOrderId — so a caller that already
    // has the return order number needs no AWB at all. Demanding one here made
    // a self-ship return (which has no AWB to give) unclaimable, and dropped
    // the parameter `bulkSpfRunner` had been passing all along. The sibling
    // flow (returnDeliveredClaimApiFlow) never lost this.
    if (!directRon && !returnAwb) {
        return { status: "failed", message: "need a returnOrderId or awbNumber in configEntry" };
    }

    try {
        const pob = await getPobRecord(page, sellerId, pobid, { userLogger });
        const to = dayjs().format("YYYY-MM-DD");
        const from = dayjs().subtract(SEARCH_WINDOW_DAYS, "day").format("YYYY-MM-DD");

        // 1. Return AWB -> returnOrderId. AJIO exposes returns through two search endpoints and
        //    which one serves a POB is per-POB, not per-account — so try both (accountType only
        //    orders the attempts). See resolveReturnOrderId.
        const cred = Array.isArray(credentials) ? credentials[0] : credentials;
        const accountType = String(cred?.accountType || "").toUpperCase();
        // accountType (and, when it's missing, the POB's integrationType) only picks which endpoint
        // is tried FIRST — resolveReturnOrderId falls back to the other one on a clean miss.
        const preferVMS = accountType
            ? accountType === "VMS"
            : String(pob.integrationType || "").toUpperCase().startsWith("VMS");
        // `searchMisses` collects each endpoint's own reason — AJIO's errorMessage verbatim
        // ("No records found for pobId: {} DV00352054") rather than a generic "not found".
        const searchMisses = [];
        // The return order number, when the caller has it, IS the returnOrderId
        // — AJIO's two search endpoints spell the same value `returnOrderNo`
        // and `returnOrderId`, and both feed the same detail call. So skip the
        // search: one call fewer per article, and it reaches returns the search
        // cannot — a self-ship return has no AWB, and one older than
        // SEARCH_WINDOW_DAYS is outside the window the list endpoint accepts.
        let returnOrderId = directRon;

        if (returnOrderId) {
            userLogger?.info(`🔎 using Return Order No ${returnOrderId} (skipped AWB search)`);
        } else {
            returnOrderId = await resolveReturnOrderId(page, { pobid, returnAwb, from, to, preferVMS, userLogger, misses: searchMisses });
        }

        if (!returnOrderId) {
            // The RESULT message is the short, stable headline the BE stores and the Monitor
            // shows. The identifiers and per-endpoint reasons go to the terminal instead —
            // apiJson already logged the raw response, this line adds the search context.
            userLogger?.warn?.(
                `❌ NO AWB UNDER POB — AWB ${returnAwb}, POB ${pobid}, accountType ${accountType || "AUTO"}, tried vision + VMS` +
                (searchMisses.length ? ` → ${searchMisses.join("; ")}` : "")
            );
            return { status: "not_found", message: NOT_FOUND_MESSAGE };
        }
        userLogger?.info(`🔎 returnOrderId=${returnOrderId} for AWB ${returnAwb}`);

        // 2. Detail + pick the specific ARTICLE. A return AWB can hold multiple articles
        //    (returnOrderItems[]); the job's `sku` selects which one this claim is for.
        //    Some returns are searchable but have NO detail in AJIO — detail 404s (code 8020).
        //    These are old/incomplete returns (e.g. INCREFF, returnStatus:null) that cannot be
        //    claimed and can't be opened in the AJIO UI. Report NOT CLAIMABLE, not a hard failure.
        let detail;
        try {
            detail = await getReturnOrderDetail(page, { returnOrderId, pobid, integrationType: pob.integrationType, userLogger });
        } catch (e) {
            // apiError attaches the numeric status, so this no longer depends on the wording of
            // the thrown message (it used to string-match "status=404").
            if (e.status === 404) {
                // Same split as not_found: short headline in the result, full context in the log.
                userLogger?.warn?.(
                    `❌ SEARCHABLE BUT NOT CLAIMABLE — Return ${returnOrderId} (AWB ${returnAwb || "n/a"}) has no detail in AJIO: ` +
                    `${e.errorMessage || e.message} — old/incomplete return, no ticket can be raised`
                );
                return { status: "not_claimable", message: NOT_CLAIMABLE_MESSAGE };
            }
            throw e;
        }
        let targetItem;
        try {
            targetItem = selectReturnItem(detail.returnOrderItems, configEntry.sku, userLogger);
        } catch (e) {
            return { status: "failed", message: e.message };
        }
        const targetReturnItemId = targetItem.returnItemId;
        userLogger?.info(`🧾 Article returnItemId=${targetReturnItemId} sku=${targetItem.product?.sellerSkuId || "-"}`);

        // 3. Guard PER ARTICLE: each article gets its own ticket. Match an existing ticket for
        //    THIS returnItemId (only fall back to "any ticket" for a single-article return).
        const existing = await getExistingTickets(page, { sellerId, returnOrderId, userLogger });
        const singleArticle = (detail.returnOrderItems || []).length <= 1;
        const mine = existing.find((t) => (t.orderDetails?.returnItemId || "") === targetReturnItemId)
            || (singleArticle ? existing[0] : null);
        if (mine) {
            if (mine.status === "CUSTOMER_REPLIED") {
                return { status: "already_raised", ticketId: mine.ticketId, finalStatus: mine.status, message: `Claim already raised & CUSTOMER_REPLIED (ticket ${mine.ticketId}, item ${targetReturnItemId})` };
            }
            if (isClaimSubmitDisabled()) {
                userLogger?.info(`🛑 DESABLE_SAVE=true — would RESUME ticket ${mine.ticketId} (status ${mine.status}) for item ${targetReturnItemId}; not touching it`);
                return claimSubmitDisabledResult("AJIO", `resume of ticket ${mine.ticketId} (attach + finalize)`, { ticketId: mine.ticketId });
            }
            if (process.env.CLAIM_DRY_RUN === "true") {
                userLogger?.info(`🧪 CLAIM_DRY_RUN — would RESUME ticket ${mine.ticketId} (status ${mine.status}) for item ${targetReturnItemId}`);
                return { status: "dry_run", ticketId: mine.ticketId, message: `dry run — would resume ticket ${mine.ticketId} (status ${mine.status})` };
            }
            // Ticket exists but incomplete → resume (attach + finalize), don't re-create.
            userLogger?.info(`↻ Existing ticket ${mine.ticketId} for item ${targetReturnItemId} is ${mine.status} — resuming (attach + finalize)`);
            return await attachAndFinalize(page, { sellerId, ticketId: mine.ticketId, configEntry, from, to, userLogger, saveCtx });
        }

        // 4. Build body (selects the same article by sku) -> create.
        const description = htmlToText(configEntry.emailTemplate?.body) || "Claim raised for the returned order.";
        const body = buildSpfBody({ detail, pob, typeOfClaim: configEntry.typeOfClaim, description, sellerEmailFallback: credentials?.username, sku: configEntry.sku });

        // DESABLE_SAVE=true: same idea as the dry run below — everything up to the
        // assembled body runs, POST /tickets/spf does not.
        if (isClaimSubmitDisabled()) {
            userLogger?.info(`🛑 DESABLE_SAVE=true — would POST /tickets/spf with body:\n${JSON.stringify(body, null, 2)}`);
            return claimSubmitDisabledResult("AJIO", "POST /tickets/spf (create claim)", { returnOrderId, body });
        }

        // DRY RUN: validate search + detail + body assembly WITHOUT creating a real AJIO ticket.
        if (process.env.CLAIM_DRY_RUN === "true") {
            userLogger?.info(`🧪 CLAIM_DRY_RUN — would POST /tickets/spf with body:\n${JSON.stringify(body, null, 2)}`);
            return { status: "dry_run", returnOrderId, message: "dry run — body assembled, no ticket created", body };
        }

        const ticketId = await createSpfClaim(page, { sellerId, body, userLogger });
        userLogger?.info(`🎫 Claim created: ticket ${ticketId} (UN_ATTENDED)`);

        // 4 + 5. Attach proof + ensure CUSTOMER_REPLIED.
        return await attachAndFinalize(page, { sellerId, ticketId, configEntry, from, to, userLogger, saveCtx });
    } catch (err) {
        // Recoverable: the session died mid-claim. Reported as its own status so
        // the caller signs in again and retries, instead of recording a claim
        // that was never filed as broken.
        if (isSessionRejection(err)) {
            return { status: "auth_expired", message: err.message };
        }

        return { status: "failed", message: err.message };
    }
}

/**
 * temp_ticket retry: existing ticketId, just re-attach + ensure CUSTOMER_REPLIED.
 */
async function retryClaimAttachment(page, { sellerId, ticketId, configEntry, userLogger, saveCtx = {} }) {
    // DESABLE_SAVE=true → a temp_ticket retry also files claim content (attachment
    // + customer comment), so it is held back too.
    if (isClaimSubmitDisabled()) {
        return claimSubmitDisabledResult("AJIO", `attachment retry on ticket ${ticketId}`, { ticketId });
    }
    const to = dayjs().format("YYYY-MM-DD");
    const from = dayjs().subtract(SEARCH_WINDOW_DAYS, "day").format("YYYY-MM-DD");
    return attachAndFinalize(page, { sellerId, ticketId, configEntry, from, to, userLogger, saveCtx });
}

module.exports = {
    searchReturnRow,
    // The five identifiers a stored SKU is matched against. Exported so the
    // article picker can offer exactly what the claim will later accept —
    // deriving it there from a second list is how the two drift.
    SKU_MATCH_FIELDS,
    getUserId,
    getPobRecord,
    searchReturnByAwb,
    searchReturnByAwbVMS,
    resolveReturnOrderId,
    getReturnOrderDetail,
    getExistingTickets,
    buildSpfBody,
    createSpfClaim,
    uploadClaimAttachment,
    postClaimComment,
    getTicketStatus,
    ensureCustomerReplied,
    downloadAttachmentPdf,
    htmlToText,
    getObjectURL,
    raiseClaim,
    retryClaimAttachment,
};
