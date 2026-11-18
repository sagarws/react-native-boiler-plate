/**
 * POST /api/experience/support/api/v1/upload/supplier-support/input-attachment
 * Multipart → { url, is_valid, errors } where `url` is a GCS link of the form
 *   https://gcs-supl-…/TicketInputAttachments/<supplierId>/<epochMs>/<filename>
 *
 * FOUR form fields, not one. Verified from a capture that recorded the
 * multipart body (2026-09-16, a claim filed by hand):
 *
 *   { entity_id: "4645181", entity_type: "SUPPLIER",
 *     file: <the file>, is_validation_required: "false" }
 *
 * The earlier capture dropped multipart bodies entirely, which is why this
 * shipped with the file alone and every claim died on its first attachment:
 *   400 {"error":"Required SupportEntityType parameter 'entity_type' is not present"}
 * `entity_id` is the supplier id, so the upload is addressed as explicitly as
 * every other call. Override the two names with MEESHO_UPLOAD_FIELD and
 * MEESHO_UPLOAD_ENTITY_TYPE if Meesho renames them.
 */
/**
 * What to add to an upload refusal, so the sentence names something actionable.
 *
 * A rejected FORM FIELD is fixable without a release, which is why the hint
 * exists — but only when the field is what Meesho objected to. The test used to
 * be /file|multipart|part/, and "File too large. Maximum size: 25MB" contains
 * the word "File". So a size refusal came back as
 *
 *     HTTP 400 File too large. Maximum size: 25MB
 *     — set MEESHO_UPLOAD_FIELD (currently "file")
 *
 * pointing an operator at a form field that was never wrong, about a video that
 * was several megabytes over. A hint that fires on the wrong failure is worse
 * than no hint: it is a wrong answer in the place the right one belongs.
 *
 * So the refusals Meesho states plainly are recognised first, and a size
 * refusal answers the question its own message leaves open — how big was the
 * file we sent? Meesho names only its limit.
 *
 * Pure and exported for tests: the regexes are the whole behaviour.
 *
 * @returns {{hint: string, tooLarge: boolean}}
 */
export function uploadFailureHint({ detail, sentBytes, field, entityType }: {
    detail: any;
    sentBytes?: number;
    field?: string;
    entityType?: string;
}): {
    hint: string;
    tooLarge: boolean;
};
/**
 * Only the images out of whatever TrackVid put in `attachments`.
 *
 * A URL with NO extension is kept: an S3 key often has none, and dropping one
 * would quietly file a claim with less evidence than the row carries. Only a
 * recognisably non-image extension is removed.
 */
export function imageAttachments(urls: any): any[];
export function loginMeeshoApi(credentials: any, { forceFresh }?: {
    forceFresh?: boolean;
}): Promise<{
    jar: any;
    supplierId: any;
    supplierIdentifier: any;
}>;
/**
 * POST /api/experience/support/subcategorySchema
 * Body: { supplier_id, identifier, sub_category_id: "1", is_pre_tp_enabled: false,
 *         faq_classification_info: { faq_classification_id: "", misc: {} } }
 * Response: schema for the ticket form (fields + accepted values).
 *
 * `sub_category_id` is Meesho's internal id for the claim type. Common ones:
 *   "1" = wrong return / damaged / RTO issue (the "typeOfClaim" bucket in CMS)
 *
 * The CMS-side typeOfClaim → Meesho sub_category_id mapping isn't in the
 * capture; we send sub_category_id="1" by default (matches the observed
 * capture) and log the response so ops can extend the mapping.
 */
export function getSubCategorySchema(ctx: any, subCategoryId?: string): Promise<any>;
export function resolveSubCategoryId(typeOfClaim: any): any;
export const MEESHO_SUBCATEGORY_IDS: {
    "I have received wrong return": string;
    "Item/s are missing in my return": string;
    "I have received damaged return": string;
};
/**
 * POST /api/experience/support/fetchSubCategory — every sub-category under this
 * category, with its id, title and TAT.
 *
 * The TAT here is the SUPPORT tat (hours until an agent replies, 168 in the
 * capture), not the claim window. The claim window is prose in `description`
 * ("…claim the dispute within 7 days of return delivery") and is enforced by
 * createTicket.
 *
 * @returns {Promise<import("./meeshoApiTypes").MeeshoSubCategory[]>}
 */
export function getSubCategoryList(ctx: any, { subCategoryId }?: {
    subCategoryId?: string;
}): Promise<import("./meeshoApiTypes").MeeshoSubCategory[]>;
/**
 * The sub-category id for a CMS claim type, asking Meesho rather than trusting
 * the table above. Falls back to the table (and then to "1") whenever the live
 * list cannot be read or holds no matching title, so a lookup failure never
 * stops a claim.
 */
export function resolveSubCategoryIdLive(ctx: any, typeOfClaim: any, { shipmentType }?: {
    shipmentType?: any;
}): Promise<any>;
/**
 * The same claim, on an RTO shipment: Meesho files it on a DIFFERENT form.
 *
 * A return-to-origin (the Returns search's `type: "RTO"` — a forward parcel
 * that came back undelivered) is not a customer return, and form 1 ("I have
 * received wrong return") is for customer returns only. Filed there, Meesho
 * looks for a delivered RETURN ORDER, finds none, and refuses with "You can
 * create this ticket only if your return order has been delivered" — on a
 * parcel its own Returns search says is Delivered. Verified 2026-10-30: five
 * Delivered RTOs refused on form 1, and the same kind of claim accepted by
 * hand on form 139.
 *
 * Keyed by the claim type, valued by the RTO form's id and the title Meesho
 * gives it, which the live check below confirms before use.
 */
export const MEESHO_RTO_SUBCATEGORIES: {
    "I have received wrong return": {
        id: string;
        title: string;
    };
};
/** The RTO form for a CMS claim type, or null when the type has none. */
export function rtoSubCategoryFor(typeOfClaim: any): any;
/** Whether a sub-category id is one of the RTO forms above. */
export function isRtoSubCategory(subCategoryId: any): boolean;
/**
 * Fill in supplierId / supplierIdentifier when the session arrived without them.
 *
 * A stored session is cookies plus these two ids. Cookies that still work but
 * no ids used to mean a full browser sign-in — for two numbers the panel will
 * hand over for a cookie. Now it asks over HTTP, once per context, and the
 * sign-in is only for cookies that are genuinely dead.
 *
 * Best effort: a failure here leaves the ids null, the call that follows 403s,
 * and the runner re-logs in exactly as it did before.
 */
export function ensureSupplierIdentity(ctx: any): Promise<any>;
export function meeshoErrorDetail(body: any): any;
/**
 * What this app calls an opaque server error.
 *
 * Meesho's gateway answers a claim it cannot process with a bare 500 and
 * `{"error":"Request failed with status code 500","options":{"backendData":{"error":""}}}`
 * — no field, no message, nothing to show an operator. Exported because the
 * shape is the whole test: a 500 that DOES carry a backend message is a
 * different problem and must not be relabelled.
 */
export function isOpaqueServerError(error: any): boolean;
import { TAT_EXPIRED as TAT_EXPIRED_MESSAGE } from "../../../../common/claimErrors";
import { INVALID_SUB_ORDER as INVALID_SUB_ORDER_MESSAGE } from "../../../../common/claimErrors";
import { MEESHO_INVALID_PACKET_ID } from "../../../../common/claimErrors";
/**
 * POST /api/fulfillment/returnRto/fetchReturnClaims — the Returns page's own
 * search box, filtered to the returns tab. The session IS the account, so a
 * return that comes back here is on this login and one that does not is not.
 *
 * Note this endpoint is in the fulfillment area, which runs its own SPA build —
 * hence the different client-package-version.
 *
 * ASKED BY AWB, THEN BY SUB-ORDER NUMBER. A CMS row's AWB can be stale — a
 * re-booked return gets a new waybill, a scanned row can carry the forward leg's
 * — and the search then answers empty, which reads as "not on this account" and
 * fails the claim. The sub-order number is the identifier Meesho keys on and it
 * does not change, so it is the second question. See `findReturn`.
 *
 * `matchedBy` names which identifier answered, and the row's `awb` is Meesho's
 * current waybill — the caller should file with THAT, not with what it asked.
 *
 * @returns {Promise<{ found: boolean, matchedBy: string|null, tried: string[],
 *                     returns: import("./meeshoApiTypes").AccountReturn[] }>}
 */
export function searchReturnClaims(ctx: any, awbNumber: any, { pageSize, subOrderNumber, orderNumber, logger }?: {
    pageSize?: number;
    subOrderNumber?: any;
    orderNumber?: any;
    logger?: any;
}): Promise<{
    found: boolean;
    matchedBy: string | null;
    tried: string[];
    returns: import("./meeshoApiTypes").AccountReturn[];
}>;
/**
 * @returns {Promise<import("./meeshoApiTypes").TicketFieldValidation>}
 */
export function validateTicketField(ctx: any, { subOrderNumber, awbNumber, categoryId, subCategoryId, }: {
    subOrderNumber: any;
    awbNumber: any;
    categoryId?: string;
    subCategoryId?: string;
}): Promise<import("./meeshoApiTypes").TicketFieldValidation>;
/**
 * Does this validation say the claim window has closed?
 *
 * Deliberately narrow: only a message that talks about a window, a day count or
 * an expiry counts. Every other validation failure (a wrong AWB, a sub-order
 * that is not this seller's) is a different problem and must not be filed away
 * as "TAT Expired".
 *
 * @param {import("./meeshoApiTypes").TicketFieldValidation} validation
 * @returns {{ expired: boolean, message: string|null }}
 */
export function tatVerdict(validation: import("./meeshoApiTypes").TicketFieldValidation): {
    expired: boolean;
    message: string | null;
};
/**
 * Ask about the SUB-ORDER NUMBER on its own.
 *
 * The same endpoint, with only that field in `ticket_details` — which is what
 * the panel sends while somebody is still typing, before an AWB exists. It
 * matters because the two questions do not always give the same answer: a form
 * carrying both fields can come back valid, or refused for the window, while
 * the number by itself is one Meesho does not recognise at all. That is the
 * case behind a `createTicket` that answers 500 with nothing in it.
 *
 * Verified 2026-09-18 against a claim whose number was wrong:
 *   → { is_valid: false, errors: [{ field_name: "sub_order_number",
 *       error_message: "Please enter a valid sub order number." }] }
 *
 * @returns {Promise<import("./meeshoApiTypes").TicketFieldValidation>}
 */
export function validateSubOrderNumber(ctx: any, { subOrderNumber, categoryId, subCategoryId, }: {
    subOrderNumber: any;
    categoryId?: string;
    subCategoryId?: string;
}): Promise<import("./meeshoApiTypes").TicketFieldValidation>;
/**
 * Does this validation say the sub-order number itself is wrong?
 *
 * As narrow as `tatVerdict`, and for the same reason: everything else Meesho
 * can refuse is a different problem, and filing it under a code that points at
 * the sub-order number sends somebody to correct a number that was right.
 *
 * @param {import("./meeshoApiTypes").TicketFieldValidation} validation
 * @returns {{ invalid: boolean, message: string|null }}
 */
export function subOrderVerdict(validation: import("./meeshoApiTypes").TicketFieldValidation): {
    invalid: boolean;
    message: string | null;
};
export function uploadAttachment(ctx: any, filePath: any): Promise<any>;
export function createTicket(ctx: any, { subCategoryId, categoryId, supplierEmail, subOrderNumber, awbNumber, stateOfPacket, packetId, barcodeImageUrl, productImageUrls, reverseWaybillUrls, videoUrl, description, attachments, callbackNumber, }: {
    subCategoryId?: string;
    categoryId?: string;
    supplierEmail: any;
    subOrderNumber: any;
    awbNumber: any;
    stateOfPacket: any;
    packetId: any;
    barcodeImageUrl: any;
    productImageUrls?: any[];
    reverseWaybillUrls?: any[];
    videoUrl: any;
    description: any;
    attachments?: any[];
    callbackNumber: any;
}): Promise<{
    ticketId: string;
    message: any;
    ticketType: any;
    raw: any;
}>;
/**
 * POST /api/experience/support/searchTickets
 * Body: { supplier_id, page_num: 0, page_size: 10, search_ids: ["<sub_order_number>_1"] }
 * The suffix "_1" is the split index — the capture used it verbatim. Response
 * body isn't visible in the capture; probe common shapes to pull the ticket id.
 */
export function searchTicketsBySubOrder(ctx: any, subOrderNumber: any): Promise<any>;
export function extractTicketId(ticket: any): any;
export function extractTicketStatus(ticket: any): any;
/**
 * READ one ticket in full — what the panel's ticket page shows: title,
 * description, the claim's own form fields (with the evidence links), the
 * update thread, status and whether it takes a reply.
 *
 * POST /api/experience/support/fetchTicket
 * Body: { ticket_id, supplier_id, identifier } — captured 2026-10-26.
 *
 * @returns {Promise<object>} the `data` object as Meesho sends it
 */
export function fetchTicket(ctx: any, ticketId: any): Promise<object>;
/**
 * REPLY on a ticket — text, attachments, or both. The attachments are URLs
 * already returned by `uploadAttachment`, exactly as the panel sends them.
 *
 * POST /api/experience/support/replyTicket
 * Body: { ticket_reply, ticket_id: <number>, s3_attachment_urls: [], supplier_id }
 * Success is meta.status === "SUCCESS" — captured 2026-10-26.
 */
export function replyTicket(ctx: any, { ticketId, reply, attachmentUrls }: {
    ticketId: any;
    reply?: string;
    attachmentUrls?: any[];
}): Promise<any>;
export function mapMeeshoStatus(s: any): any;
export function claimStatusToCmsStatus(s: any): any;
export namespace MEESHO_TO_CMS_STATUS {
    let open: string;
    let in_progress: string;
    let in_review: string;
    let pending: string;
    let resolved: string;
    let approved: string;
    let closed: string;
    let rejected: string;
    let denied: string;
    let awaiting_response: string;
    let seller_action_required: string;
}
/**
 * The headers the supplier panel sends, as closely as this process can.
 *
 * `browser-id` IS SENT NOW, and its absence is the most likely reason claims
 * that had been filing started answering a bare HTTP 500 while the same claim
 * filed by hand went through. It was left out deliberately, as a fingerprint
 * nothing here could honestly supply — but the session already carries it, in
 * the `browser_id` cookie, so forwarding it is not inventing anything. See
 * platforms/meesho/common/browserId.js and Error_Case/MeeshoClaim.
 *
 * The rest of this set is what the browser sends around it. A backend that has
 * started checking one header is a backend worth looking ordinary to.
 */
export function apiHeaders(ctx: any, extra?: {}): {
    cookie: string;
    identifier?: any;
    "sec-ch-ua": string;
    "sec-ch-ua-mobile": string;
    "sec-ch-ua-platform": string;
    "sec-fetch-dest": string;
    "sec-fetch-mode": string;
    "sec-fetch-site": string;
    priority: string;
    "browser-id": string;
    "user-agent": string;
    accept: string;
    "accept-language": string;
    origin: string;
    Referer: string;
    "content-type": string;
    "client-type": string;
    "client-package-version": string;
} | {
    cookie: string;
    identifier?: any;
    "sec-ch-ua": string;
    "sec-ch-ua-mobile": string;
    "sec-ch-ua-platform": string;
    "sec-fetch-dest": string;
    "sec-fetch-mode": string;
    "sec-fetch-site": string;
    priority: string;
    "browser-id"?: undefined;
    "user-agent": string;
    accept: string;
    "accept-language": string;
    origin: string;
    Referer: string;
    "content-type": string;
    "client-type": string;
    "client-package-version": string;
};
export function httpCall(ctx: any, { method, url, data, headers, step }: {
    method?: string;
    url: any;
    data: any;
    headers: any;
    step: any;
}): Promise<any>;
import { ORIGIN } from "../../common/sessionStore";
export { TAT_EXPIRED_MESSAGE, INVALID_SUB_ORDER_MESSAGE, MEESHO_INVALID_PACKET_ID, ORIGIN };
