import { getUserId } from "../../master-import/api-based-flow/apiReportFlow";
/**
 * Full POB record from work-places (storeName, pincode, integrationType, contact, businessModel).
 * These populate the claim body's storeName / seller contact / x-integration-type header.
 */
export function getPobRecord(page: any, sellerId: any, pobid: any, { userLogger, pobCache }?: {
    pobCache?: any;
}): Promise<any>;
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
 * server-side by `trackingNumber` (the return AWB). orderDateRange=YYYY/MM/DD_YYYY/MM/DD (slashes),
 * headers X-Tenant + x-pob-id (no businessModel), result[].{returnOrderId,trackingNumber}.
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
/** ATTACH a file (multipart "files"). fileBase64 = base64 of the bytes; mimeType sets the Blob type. */
export function uploadClaimAttachment(page: any, { sellerId, ticketId, fileBase64, fileName, mimeType, userLogger }: {
    sellerId: any;
    ticketId: any;
    fileBase64: any;
    fileName: any;
    mimeType: any;
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
 * READ one ticket in full — what the seller portal's ticket window shows:
 * status, description, the order it is about, attachments and the comment
 * thread (agent and seller). GET /tickets/{ticketId}, captured 2026-10-26.
 *
 * Unlike getTicketStatus this needs no date range: the detail endpoint answers
 * for any ticket the seller owns. Throws with AJIO's own wording on failure.
 *
 * @returns {Promise<object>} the `result` object as AJIO sends it
 */
export function getTicket(page: any, { sellerId, ticketId, userLogger }: {
    sellerId: any;
    ticketId: any;
    userLogger: any;
}): Promise<object>;
export function mapAjioTicketStatus(ticketStatus: any): any;
export namespace AJIO_TICKET_TO_CMS_STATUS {
    let approved: string;
    let rejected: string;
    let closed_approved: string;
    let closed_rejected: string;
}
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
 * Download the claim screenshot (Node-side) from the Drive `imageUrl` -> base64.
 * Validates magic bytes so an HTML login/permission/interstitial page (Drive file not public)
 * is rejected instead of uploaded as a broken image. Returns { base64, fileName, mimeType }.
 */
export function downloadAttachmentImage(configEntry: any, saveCtx?: {}): Promise<{
    base64: string;
    fileName: string;
    mimeType: string;
}>;
/**
 * Google-Drive "viewable" link -> a direct-download URL that returns the raw bytes.
 * Handles /file/d/{id}/view and ?id={id} forms. Uses drive.usercontent.google.com (the current
 * direct-content host; the legacy uc?export=download simply 302s here and axios follows it).
 * Non-Drive URLs are returned unchanged (already a direct link).
 */
export function toDirectDownloadUrl(url: any): any;
/**
 * Sniff the file type from magic bytes. Returns { mime, ext } for supported image types, or null.
 * Used to (a) set the upload Blob's mime and (b) reject an HTML page (Drive login/permission/
 * interstitial) that would otherwise be uploaded as a broken "image".
 */
export function sniffImageType(buf: any): {
    mime: string;
    ext: string;
};
export function htmlToText(html: any): any;
/**
 * Full claim orchestration for one AWB. Returns:
 *   { status: 'success'|'already_raised'|'not_found'|'failed'|'dry_run', ticketId, finalStatus, message }
 * Never throws — caller maps status to the MasterImport callback.
 */
export function raiseClaim(page: any, { sellerId, configEntry, credentials, userLogger, returnOrderId: directReturnOrderId, saveCtx, pobCache }: {
    sellerId: any;
    configEntry: any;
    credentials: any;
    userLogger: any;
    returnOrderId: any;
    saveCtx?: {};
    pobCache?: any;
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
    returnOrderId: any;
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
