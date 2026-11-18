export namespace MYNTRA_TO_CMS_STATUS {
    let OPEN: string;
    let IN_REVIEW: string;
    let AWAITING_SELLER_RESPONSE: string;
    let ACCEPT: string;
    let AWAITING_AGENT_RESPONSE: string;
    let REJECT: string;
    let PAYMENT_COMPLETED: string;
}
export function mapMyntraStatus(myntraStatus: any): any;
/**
 * The payout Myntra settled, and only once it has.
 * @param {{ status?: string|null, compensationAmount?: number|null }|null} row
 * @returns {number|null}
 */
export function myntraCompensation(row: {
    status?: string | null;
    compensationAmount?: number | null;
} | null): number | null;
export const API_BASE: "https://partnersapi.myntrainfo.com";
export const ISSUE_CATEGORIES: string[];
export const TICKET_STATUSES: string[];
/**
 * CMS display text (or an already-correct enum key) → API issueCategory enum.
 * Throws when the value can't be resolved — filing under the wrong category
 * would produce a claim ops has to withdraw manually.
 */
export function mapIssueCategory(value: any): any;
/**
 * The PUT body is the fetchNewClaim row (sans server-only decoration like
 * styleInfo / sellerId) plus the claim fields the form collects.
 *
 * `attachments` repeats every image/video URL — the portal sends both the
 * per-section arrays and a flat attachments list.
 */
export function buildUpdateClaimPayload({ row, issueCategory, description, shippingLabelProofUrls, productProofUrls, videoProofUrls, disputedAmount, physicalReceivedSku, }: {
    row: any;
    issueCategory: any;
    description: any;
    shippingLabelProofUrls?: any[];
    productProofUrls?: any[];
    videoProofUrls?: any[];
    disputedAmount: any;
    physicalReceivedSku: any;
}): {
    orderId: any;
    returnId: any;
    trackingId: any;
    returnTrackingId: any;
    skuId: any;
    orderLineId: any;
    returnCreatedDate: any;
    rejectionReason: any;
    styleId: any;
    orderCreatedOn: any;
    orderStatus: any;
    orderCancelDate: any;
    warehouseId: any;
    orderPackedDate: any;
    orderShippedDate: any;
    orderDeliveredDate: any;
    isRefunded: any;
    orderCreatedBy: any;
    returnMode: any;
    returnReason: any;
    finalAmount: any;
    meta: any;
    isOCRVerified: boolean;
    issueCategory: any;
    status: string;
    description: any;
    shippingLabelProofUrl: any[];
    productProofUrl: any[];
    videoProofUrl: any[];
    replyComment: string;
    attachments: any[];
};
export function loginMyntraApi(credentials: any, { forceFresh }?: {
    forceFresh?: boolean;
}): Promise<any>;
/**
 * GET /api/spf/fetchNewClaim?fetchAccio=true&id=<orderId|returnId|trackingId>
 *
 * Returns:
 *   { found: true,  row, ticketId: null }         — can raise a claim
 *   { found: true,  row, ticketId: <id> }         — already claimed; the caller
 *                                                   records the ticket instead
 *                                                   of filing again
 *
 * Throws (both mean "this id is not claimable on this account", by different
 * routes — Myntra reports the same verdict three ways, see below):
 *   NO_VALID_CLAIM "Invalid AWB Number"   — "No valid orders found", arriving
 *                                           either as a real 400 or as a 200
 *                                           carrying an ERROR envelope
 *   AWB_NOT_FOUND  "No AWB number found"  — 200 SUCCESS envelope, empty data[]
 *
 * `found` is therefore always true on return; it is kept so existing callers
 * and the orphan probe's three-way mapping still read naturally.
 */
export function fetchNewClaim(jar: any, searchId: any): Promise<{
    found: boolean;
    row: any;
    ticketId: string;
}>;
/**
 * GET /api/spf/fetchClaimByTicketId?fetchAccio=true&id=<ticketId>
 *
 * Reads back a claim we already filed, to learn Myntra's current decision on
 * it. Same auth/session as every other call here — the status-sync job runs
 * inside an already-open account session, so this costs one GET per open
 * claim and no extra login.
 *
 * Returns { found, status, originalStatus, validationReason, row }.
 *   status          — Myntra's live claim state (OPEN / ACCEPT / REJECT / …)
 *   originalStatus  — their pre-override value; kept for logging only
 *   validationReason— why it landed there (e.g. VMS_Footage_Not_Available_FWRD)
 *
 * A ticket Myntra no longer returns (deleted, wrong seller account, bad id)
 * comes back { found: false } rather than throwing — the caller treats that as
 * "nothing to update" and moves on to the next ticket.
 */
export function fetchClaimByTicketId(jar: any, ticketId: any): Promise<{
    found: boolean;
    status: string;
    originalStatus: string;
    validationReason: any;
    row: any;
}>;
/**
 * GET /api/file-manager/getUploadToken/spfTest — ask for a write SAS.
 * The response is keyed by the requested file name.
 */
export function getUploadToken(jar: any, fileName: any): Promise<{
    sasUrl: any;
    fileNameWithPath: any;
}>;
/**
 * Uploads one proof file and returns the public blob URL for updateClaim.
 * Presign and PUT happen back to back because the SAS only lives ~15 minutes.
 */
export function uploadProof(jar: any, { filePath, orderId }: {
    filePath: any;
    orderId: any;
}): Promise<any>;
/**
 * PUT /api/spf/updateClaim — files the claim. Returns the created ticket id.
 * Success is `status.statusCode` 200/201 with `data[0].ticketId`.
 */
export function updateClaim(jar: any, payload: any): Promise<{
    ticketId: string;
    row: any;
}>;
/** GET /api/spf/getTickets — one page of this seller's SPF tickets. */
export function getTickets(jar: any, { page, pageSize, statuses }?: {
    page?: number;
    pageSize?: number;
    statuses?: string[];
}): Promise<any>;
/**
 * Find an existing ticket id for an AWB / order id / return id. Used when
 * updateClaim's response didn't carry one (shouldn't happen) and as a
 * best-effort re-check. Pages until a match or `maxPages` is exhausted.
 */
export function findTicketIdByTrackingId(jar: any, searchId: any, { pageSize, maxPages }?: {
    pageSize?: number;
    maxPages?: number;
}): Promise<string>;
declare function cookieHeader(jar: any): string;
declare function apiHeaders(jar: any, extra: any): any;
declare function mimeForFile(filePath: any): any;
export { cookieHeader as _cookieHeader, apiHeaders as _apiHeaders, mimeForFile as _mimeForFile };
