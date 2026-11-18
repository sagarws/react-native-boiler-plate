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
export function searchReturnRow(page: any, { pobid, returnOrderNo, returnAwb, from, to, userLogger, misses }: {
    pobid: any;
    returnOrderNo: any;
    returnAwb: any;
    from: any;
    to: any;
    userLogger: any;
    misses: any;
}): Promise<any>;
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
export const SKU_MATCH_FIELDS: string[];
import { getUserId } from "../../master-import/api-based-flow/apiReportFlow";
/**
 * Full POB record from work-places (storeName, pincode, integrationType, contact, businessModel).
 * These populate the claim body's storeName / seller contact / x-integration-type header.
 */
export function getPobRecord(page: any, sellerId: any, pobid: any, { userLogger }?: {}): Promise<{
    id: any;
    storeName: any;
    pincode: any;
    integrationType: any;
    businessModel: any;
    mobileNumber: any;
    emailId: any;
    fulfilmentType: any;
}>;
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
export function searchReturnByAwb(page: any, { pobid, returnAwb, from, to, userLogger, misses }: {
    pobid: any;
    returnAwb: any;
    from: any;
    to: any;
    userLogger: any;
    misses: any;
}): Promise<any>;
/**
 * SEARCH (VMS accounts): Return AWB -> returnOrderId.
 * VMS accounts use a different endpoint (/malekith/gamora/vms/v1/return-orders) which filters
 * server-side by `trackingNumber` (the return AWB). Differences vs the API/vision endpoint:
 * orderDateRange=YYYY/MM/DD_YYYY/MM/DD (slashes), headers X-Tenant + x-pob-id (no businessModel),
 * result[].{returnOrderId,trackingNumber}. Returns null if not found in the window.
 */
export function searchReturnByAwbVMS(page: any, { pobid, returnAwb, userLogger, misses }: {
    pobid: any;
    returnAwb: any;
    userLogger: any;
    misses: any;
}): Promise<any>;
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
export function resolveReturnOrderId(page: any, { pobid, returnAwb, from, to, preferVMS, userLogger, misses }: {
    pobid: any;
    returnAwb: any;
    from: any;
    to: any;
    preferVMS?: boolean;
    userLogger: any;
    misses?: any[];
}): Promise<any>;
/** DETAIL: return-order details for the claim body. */
export function getReturnOrderDetail(page: any, { returnOrderId, pobid, integrationType, userLogger }: {
    returnOrderId: any;
    pobid: any;
    integrationType: any;
    userLogger: any;
}): Promise<any>;
/** GUARD: existing tickets for this return order (already-raised check). */
export function getExistingTickets(page: any, { sellerId, returnOrderId, userLogger }: {
    sellerId: any;
    returnOrderId: any;
    userLogger: any;
}): Promise<any>;
/** Assemble the /tickets/spf request body from the detail + POB + claim inputs. */
export function buildSpfBody({ detail, pob, typeOfClaim, description, sellerEmailFallback, sku }: {
    detail: any;
    pob: any;
    typeOfClaim: any;
    description: any;
    sellerEmailFallback: any;
    sku: any;
}): {
    assignmentGroup: string;
    description: any;
    issueTitle: string;
    subIssueType: any;
    orderId: any;
    priority: string;
    sellerContactNo: any;
    sellerEmail: any;
    storeName: any;
    issueType: string;
    pobId: any;
    fulfilmentType: any;
    tenant: string;
    ticketType: string;
    orderDetail: {
        customerOrderId: any;
        forwardPONumber: any;
        forwardShipmentId: any;
        forwardInvoiceNumber: any;
        forwardAwbNumber: any;
        forwardInvoiceAmount: any;
        returnOrderId: any;
        returnAwbNumber: any;
        returnShipmentId: any;
        productDescription: any;
        jioCode: any;
        ean: any;
        skuId: any;
        quantity: any;
        returnCarrier: any;
        forwardCarrier: any;
        returnType: any;
        returnCreationDate: any;
        returnItemId: any;
    };
};
/** CREATE the SPF claim. Returns ticketId. */
export function createSpfClaim(page: any, { sellerId, body, userLogger }: {
    sellerId: any;
    body: any;
    userLogger: any;
}): Promise<any>;
/** ATTACH the PDF (multipart). pdfBase64 = base64 of the file bytes. */
export function uploadClaimAttachment(page: any, { sellerId, ticketId, pdfBase64, fileName, userLogger }: {
    sellerId: any;
    ticketId: any;
    pdfBase64: any;
    fileName: any;
    userLogger: any;
}): Promise<boolean>;
/** COMMENT (PUT) — the fallback "activity" that flips UN_ATTENDED -> CUSTOMER_REPLIED. */
export function postClaimComment(page: any, { sellerId, ticketId, comment, userLogger }: {
    sellerId: any;
    ticketId: any;
    comment: any;
    userLogger: any;
}): Promise<boolean>;
/** STATUS: read the ticket's current status via the tickets list. */
export function getTicketStatus(page: any, { sellerId, ticketId, from, to, userLogger }: {
    sellerId: any;
    ticketId: any;
    from: any;
    to: any;
    userLogger: any;
}): Promise<any>;
/**
 * Ensure the ticket reaches CUSTOMER_REPLIED. Poll status; if it stays UN_ATTENDED, post a
 * comment (fallback) once, then keep polling. Returns the final status.
 */
export function ensureCustomerReplied(page: any, { sellerId, ticketId, from, to, maxWaitMs, userLogger }: {
    sellerId: any;
    ticketId: any;
    from: any;
    to: any;
    maxWaitMs?: number;
    userLogger: any;
}): Promise<any>;
/**
 * Download the sixSideImages PDF (Node-side, S3) → base64.
 * Returns { base64, fileName } or throws.
 */
export function downloadAttachmentPdf(configEntry: any, saveCtx?: {}): Promise<{
    base64: string;
    fileName: string;
}>;
export function htmlToText(html: any): any;
export function getObjectURL(fileKey: any): string;
/**
 * Full claim orchestration for one AWB. Returns:
 *   { status: 'success'|'already_raised'|'not_found'|'failed'|'dry_run', ticketId, finalStatus, message }
 * Never throws — caller maps status to the TrackVid callback.
 */
export function raiseClaim(page: any, { sellerId, configEntry, credentials, userLogger, returnOrderId: directReturnOrderId, saveCtx }: {
    sellerId: any;
    configEntry: any;
    credentials: any;
    userLogger: any;
    returnOrderId: any;
    saveCtx?: {};
}): Promise<{
    status: string;
    message: any;
    ticketId?: undefined;
    finalStatus?: undefined;
    returnOrderId?: undefined;
    body?: undefined;
} | {
    status: string;
    ticketId: any;
    finalStatus: any;
    message: string;
    returnOrderId?: undefined;
    body?: undefined;
} | {
    status: string;
    ticketId: any;
    message: string;
    finalStatus?: undefined;
    returnOrderId?: undefined;
    body?: undefined;
} | {
    status: string;
    returnOrderId: string;
    message: string;
    body: {
        assignmentGroup: string;
        description: any;
        issueTitle: string;
        subIssueType: any;
        orderId: any;
        priority: string;
        sellerContactNo: any;
        sellerEmail: any;
        storeName: any;
        issueType: string;
        pobId: any;
        fulfilmentType: any;
        tenant: string;
        ticketType: string;
        orderDetail: {
            customerOrderId: any;
            forwardPONumber: any;
            forwardShipmentId: any;
            forwardInvoiceNumber: any;
            forwardAwbNumber: any;
            forwardInvoiceAmount: any;
            returnOrderId: any;
            returnAwbNumber: any;
            returnShipmentId: any;
            productDescription: any;
            jioCode: any;
            ean: any;
            skuId: any;
            quantity: any;
            returnCarrier: any;
            forwardCarrier: any;
            returnType: any;
            returnCreationDate: any;
            returnItemId: any;
        };
    };
    ticketId?: undefined;
    finalStatus?: undefined;
}>;
/**
 * temp_ticket retry: existing ticketId, just re-attach + ensure CUSTOMER_REPLIED.
 */
export function retryClaimAttachment(page: any, { sellerId, ticketId, configEntry, userLogger, saveCtx }: {
    sellerId: any;
    ticketId: any;
    configEntry: any;
    userLogger: any;
    saveCtx?: {};
}): Promise<{
    status: string;
    message: string;
}>;
export { getUserId };
