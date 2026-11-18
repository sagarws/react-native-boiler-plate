export function loginDelhiveryApi(credentials: any, { forceFresh }?: {
    forceFresh?: boolean;
}): Promise<{
    accessToken: any;
    refreshToken: any;
    tokenType: any;
    realm: any;
    tenantId: any;
    hqClientId: any;
    clientId: any;
    idToken: any;
}>;
export function searchShipments(ctx: any, { awb, pageSize }?: {
    pageSize?: number;
}): Promise<any>;
/**
 * POST /web/api/forward_orders/global_search
 *
 * The search box at the top of the portal: `{ page, page_size, search_by:
 * "WBN", search_term }` and nothing else — no type filter, no status list.
 *
 * KEPT AS THE FALLBACK, not the primary. It finds a waybill the filtered
 * search cannot (a status outside the list above, a leg it does not cover),
 * which is exactly what a fallback is for. But its rows are a summary: no
 * `cod_amount`, no `client_name`, no addresses. The filtered search answers
 * with the whole shipment, and the claim needs the amount off it.
 */
export function globalSearchShipments(ctx: any, { awb, pageSize }?: {
    pageSize?: number;
}): Promise<any>;
/**
 * POST /web/api/forward_orders/hq_es_shipments_search/list — by AWB, no type.
 *
 * Body: { filter_awb_number: [awb], page, page_size, search_on: ["oid","wbn"] }
 *
 * THE LOOKUP THAT FINDS A RETURN. The filtered search above is FORWARD-only,
 * and a claim AWB is often the return leg: 26472713456644 (a DTO pickup)
 * answered the FORWARD search with nothing, then fell through to
 * `global_search`, whose summary rows carry no amount — so the claim would
 * have gone out with no `claim_amount`. The portal itself, right before it
 * uploads the evidence, asks this: the same endpoint, the AWB as a filter and
 * no shipment type at all. It returns the full row, REVERSE included, with
 * `grand_total_value`. Recorded 2026-10-28 on that AWB (→ J1793190060742161).
 */
export function lookupShipmentByAwb(ctx: any, { awb, pageSize }?: {
    pageSize?: number;
}): Promise<any>;
/**
 * Both searches on the client the ctx currently points at, the complete one
 * first. Exported because the account-mapping probe asks the same question —
 * "does this login hold this waybill" — and must not answer "no" to a shipment
 * the filtered search happens not to cover.
 */
export function findOnCurrentClient(ctx: any, awb: any): Promise<any>;
/**
 * EXPRESS or SURFACE, as the shipment itself reports it.
 *
 * `box_list[].shipping_mode` is the freight lane — the same word the CMS row
 * carries as `domestic` and the Selenium flow picks from the header dropdown.
 * `client_name` ("UNIVERSAL SPORTSBIZ EXPRESS") carries it too, and is the
 * fallback: the summary rows from `global_search` have no box list.
 */
export function shippingModeOf(shipment: any): string;
/**
 * What this claim is worth, according to Delhivery.
 *
 * NOBODY TYPES THIS. The portal's claim form fills the amount in as soon as an
 * AWB is entered — it is the shipment's own value, not a judgement about the
 * claim — and `cod_amount` is where it comes from (1384 on the shipment, 1384
 * on the ticket that was filed against it). `grand_total_value` is the same
 * figure for a prepaid parcel, where there is no COD to collect.
 *
 * So a CMS row does not need a claim-amount field, and asking an operator to
 * retype a number the marketplace already holds would only be a way to get it
 * wrong.
 */
export function shipmentAmountOf(shipment: any): number;
/**
 * POST /web/api/dashboard/claims/liability_preview — body { wbn }.
 *
 * What Delhivery will pay on this waybill, as its own claim form shows it:
 * `claim_amount`, `max_liability`, `product_value`, the liability rule. The
 * portal calls it when an AWB is entered (recorded 2026-10-28: 26472713456644 →
 * claim_amount 1020, "CN till claimed amount").
 *
 * The LAST source of a claim amount, not the first: the row's own figure and
 * the shipment's value are what earlier live submits were filed on, and this is
 * for the shipment that carries neither. Never throws — null when it cannot say.
 */
export function liabilityPreviewAmount(ctx: any, awb: any): Promise<number>;
/**
 * Find the AWB, trying every HQ client this login is allowed to act on.
 *
 * WHY IT HAS TO SWEEP. A Delhivery seller's shipments are split across HQ
 * clients — one per freight lane on this account, EXPRESS and SURFACE — and
 * every call is scoped to exactly one by `x-hq-client-id`. A shipment on the
 * other client is not "not found on a technicality": the search answers 200
 * with an EMPTY result, which is indistinguishable from an AWB that does not
 * exist. Verified on 29123116000212: found under
 * cms::client::f21a90b3-… (EXPRESS, "UNIVERSAL SPORTSBIZ EXPRESS"), zero
 * results under cms::client::0796af0f-… (SURFACE), same token, same body.
 *
 * The session's own client is asked first — it is right for most AWBs, and the
 * sweep then costs nothing. A hit on another client is REMEMBERED on the
 * session, so a batch from that lane pays for the discovery once.
 *
 * This is also why `resolveHqClientId`'s probe is not enough on its own: it
 * asks "may this login use the claims module at all", which both clients
 * answer yes to. Only the AWB can say which one owns it.
 */
export function findShipmentForAwb(ctx: any, awb: any): Promise<{
    shipment: any;
    hqClientId: any;
    switched: boolean;
}>;
/**
 * Assert the AWB exists on this account, and return the matching shipment.
 *
 * Throws AWB_NOT_FOUND when no client holds it — a permanent verdict for this
 * credential, so the runner reports it instead of retrying.
 *
 * @param {string} [options.domestic] the row's EXPRESS/SURFACE pick, compared
 *        against what the shipment says purely to report a disagreement.
 */
export function assertAwbExists(ctx: any, awb: any, { domestic }?: {
    domestic?: string;
}): Promise<any>;
export function getSupportCategories(ctx: any): Promise<any>;
/**
 * POST /web/api/claims/upload/presigned-urls
 * Body: { awb, files: [{ fileName, contentType, fileSize }] }
 * Returns: [{ presigned_url, post_fields, s3_key, max_file_size_bytes }]
 *
 * Then multipart POST to each presigned_url with the post_fields as form
 * fields plus the file as `file`.
 */
export function getPresignedUrls(ctx: any, awb: any, files: any): Promise<any[]>;
export function uploadToS3(upload: any, filePath: any): Promise<any>;
/**
 * Upload every file for a claim, return the array of s3_keys in the order
 * their filenames were requested. Delhivery names files with a convention
 * like `Unbox_Video_1.mp4`, `Unbox_Image_2.jpg`, ... so we mirror that.
 */
export function materializeAttachments(ctx: any, awb: any, files: any): Promise<{
    s3_key: any;
    content_type: any;
    file_size: any;
    identifier: any;
}[]>;
/**
 * POST /web/api/support/create_ticket — the claim submit.
 *
 * MULTIPART, NOT JSON, and that is the whole shape of this function. The
 * portal sends `multipart/form-data` with ONE part named `ticket_request`,
 * filename "blob", Content-Type application/json, whose body is:
 *
 *   {
 *     "category": "Claim LnD B2C",
 *     "sub_category": "Damaged",
 *     "ref_nums": "29123116000212",
 *     "claim_amount": 1384,
 *     "description": "…",
 *     "email_id": "seller@example.com",
 *     "media_context": "{\"upload_type\":\"CUSTOMER_UPLOAD\",\"source\":\"CMS\",
 *                        \"uploaded_files\":[{\"s3_key\":…,\"content_type\":…,
 *                        \"file_size\":…,\"identifier\":…}]}"
 *   }
 *
 * `media_context` is a STRING containing JSON, not an object — nested exactly
 * as the portal nests it. The previous shape here (flat JSON with
 * `raised_from`, `awb_number`, `attachment_keys`, `claim_type`, `domestic`) was
 * assembled by inference from what the Selenium drawer collects, because the
 * original capture had no request body. None of those field names appear in
 * the real request.
 *
 * Verified against a live submit on 2026-09-20 (AWB 29123116000212 →
 * J1789925203929469). Response is unchanged:
 *   { ticket_id, request_id, message, public_ticket_id, invalid, sync,
 *     duplicate, deflected }
 */
export function createTicket(ctx: any, { awbNumber, subcategory, claimType, description, claimAmount, files, category, subCategory, }: {
    awbNumber: any;
    subcategory: any;
    claimType: any;
    description: any;
    claimAmount: any;
    files: any;
    category?: string;
    subCategory?: any;
}): Promise<{
    publicTicketId: any;
    ticketUuid: any;
    duplicate: boolean;
    deflected: boolean;
    message: any;
}>;
/**
 * The row's subcategory (or claim type, when the subcategory is blank) → the
 * portal's own sub_category word.
 */
export function subCategoryFor({ subcategory, claimType }?: {}): string;
/**
 * The portal's category, and how the CMS row's wording reaches it.
 *
 * THE FORM AND THE API DO NOT SPEAK THE SAME WORDS. The drawer offers
 * "Damage / Missing / Mismatch" and "Damage in delivered/returned shipment";
 * the API that the drawer then calls sends `category: "Claim LnD B2C"` and
 * `sub_category: "Damaged"`. Passing the drawer's labels through — which is
 * what this used to do — hands the gateway strings it has never seen.
 *
 * "Damaged" is verified (live submit, 2026-09-20, ticket J1789925203929469).
 * "Missing" and "Mismatch" are the same transformation applied to the other two
 * options and are NOT yet confirmed against a live submit; `logCategoryChoice`
 * prints the portal's own list when one of them is used, so the first run on
 * either pins it down instead of guessing twice.
 */
export const CLAIM_CATEGORY: "Claim LnD B2C";
/**
 * POST {GATEWAY_HOST}/web/api/support/client_tickets
 *
 * VERIFIED (one.delhivery.com, 2026-09-18):
 *   → { public_ticket_id: "J1789715959679284", page: "1", status: "CLOSED" }
 *   ← { total_count: 1, results: [ { ticket_id, status: "rejected",
 *       public_ticket_id, tracking_id, subject, category, sub_category } ] }
 *
 * THE VERDICT IS ONE WORD, and it is not the one the claims list uses:
 * `accepted` and `rejected`, against that list's `claim_approved` /
 * `claim_rejected`. Two vocabularies for the same fact, so they are mapped
 * separately rather than folded into one table that would have to guess which
 * endpoint a string came from.
 *
 * ASKED TWICE WHEN IT HAS TO BE. The captured call filters on `status: CLOSED`,
 * which is the finished ticket — and a claim still being looked at is not
 * closed, so that filter alone would report every open claim as "no ticket".
 * The unfiltered call is tried second, in that order, because the filtered one
 * is the shape Delhivery actually answered.
 */
export function fetchClientTicket(ctx: any, publicTicketId: any): Promise<any>;
export function mapDelhiveryTicketStatus(ticketStatus: any): any;
export namespace DELHIVERY_TICKET_TO_CMS_STATUS {
    let accepted: string;
    let rejected: string;
}
/**
 * Every ticket this client holds for the AWB, across the status buckets.
 *
 * ONE REFUSED BUCKET IS NOT AN ANSWER. These calls are a recovery — they run
 * after a submit whose reply was lost — so a 400 or a 403 on one status must
 * not throw away the three that might hold the ticket. The error is kept and
 * reported only if NOTHING answered, where it is the whole explanation.
 */
export function listClientTickets(ctx: any, { awb, statuses, page }?: {
    statuses?: string[];
    page?: number;
}): Promise<any[]>;
/**
 * Find the ticket Delhivery already holds for this AWB.
 *
 * Returns null when there is none. Takes the FIRST row, as instructed — the
 * filter is already scoped to one AWB, and Delhivery returns newest first.
 */
export function findTicketByAwb(ctx: any, awb: any): Promise<{
    publicTicketId: any;
    ticketStatus: any;
    ticketCount: number;
    raw: any;
}>;
/**
 * A CLAIM ticket Delhivery already holds for this AWB, or null.
 *
 * THE SECOND DUPLICATE CHECK, and the one that catches a claim raised a minute
 * ago. `claims/lost_damage/list` is the first, and it does not show a claim
 * filed through Support straight away: after 26472713456644 was filed
 * (J1793190060742161, recorded 2026-10-28) the claims list still answered
 * empty for it, while this list already had the ticket. Without this a second
 * run on that AWB would have raised a second ticket.
 *
 * Differs from `findTicketByAwb` on purpose — that one is failure recovery and
 * takes whatever ticket the AWB has. This one decides whether to FILE, so:
 *
 *   - only claim tickets count (category "Claim …", e.g. "Claim LnD B2C") — a
 *     delivery query raised on the same AWB must not stop a claim;
 *   - every status bucket is read, not the first non-empty one — a closed
 *     query must not hide an open claim;
 *   - only a row whose `tracking_id` is this AWB counts.
 *
 * Throws only when every bucket was refused; the caller treats that as "could
 * not check", never as "no ticket".
 */
export function findClaimTicketByAwb(ctx: any, awb: any, { statuses }?: {
    statuses?: string[];
}): Promise<{
    publicTicketId: any;
    ticketStatus: any;
    category: any;
    raw: any;
}>;
/**
 * The public "J…" number for a ticket known only by its internal UUID.
 *
 * WHY THIS EXISTS. `claims/lost_damage/list` names a claim's ticket as
 * `jarvis_ticket_id` — Delhivery's internal UUID ("587232ca-22bb-…"), not the
 * J-number the portal, the seller and `fetchClientTicket` all use. A claim found
 * already filed was recorded with that UUID, and the status check then could
 * not read its ticket at all. The support-ticket list carries both:
 * `ticket_id` is the same UUID, `public_ticket_id` the J-number (recorded
 * 2026-10-28: 8a2e5b88-… ⇄ J1793190060742161).
 *
 * Every status bucket, matched on `ticket_id`. Null when no row matches or the
 * list cannot be read — the caller keeps what it had rather than guessing.
 */
export function resolvePublicTicketId(ctx: any, awb: any, ticketUuid: any, { statuses }?: {
    statuses?: string[];
}): Promise<any>;
export function isInternalTicketId(value: any): boolean;
export function mapTicketStatus(ticketStatus: any): any;
/**
 * POST /web/api/support/client_tickets
 * Body: { page, status: [...], ref_num: <awb> }
 *
 * The portal's own ticket list, filtered by AWB. Its value here is recovery: a
 * claim can fail on our side AFTER Delhivery already created the ticket — the
 * submit succeeds but the response is lost, create_ticket answers without a
 * public id, or the run dies between submit and DB write. In all of those the
 * ticket is real and re-running would file a duplicate. Asking by AWB is the
 * only way to find out.
 *
 * ⚠️ The response body was NOT in any capture (silent webRequest mode dropped
 * it), so only `public_ticket_id` is confirmed — from the create_ticket response
 * and from a live sample. Everything else here reads defensively: the result
 * array is looked for under each plausible key, and the ticket id and status
 * under each plausible field. DELHIVERY_API_DEBUG=true prints the real keys when
 * nothing matches, which is how to pin this down without another capture.
 */
/**
 * The status buckets, asked for ONE AT A TIME.
 *
 * All four in a single `status` array is what this used to send, and every call
 * came back 400 INVALID_OR_MISSING_PARAMS — the same "Could not load your
 * dashboard" the gateway gives for anything it dislikes, with nothing to say
 * which part. The portal's own request (captured 2026-10-01) sends exactly one:
 *
 *     {"page":1,"status":["CLOSED"],"ref_num":"55406810335613"}
 *
 * So each is asked separately and the first hit wins. CLOSED leads because a
 * ticket this lookup is for has usually been decided already — it runs after a
 * submit whose answer was lost, which means minutes or hours have passed.
 *
 * THE FILTER IS NOT THE ROW'S OWN WORD. The ticket that came back under
 * `status: ["CLOSED"]` reads `"status": "rejected"`. The filter names a bucket;
 * the row names an outcome, and the two vocabularies do not match — which is
 * why a ticket is never searched for by the status it reports.
 */
export const TICKET_STATUSES: string[];
/**
 * POST /web/api/claims/lost_damage/list
 *
 * Body: search_on ["awb_number"], search_type "CONTAINS", search_term, page,
 *       page_size, only_count, range_created_at, range_updated_at
 * Response: { results: [{ claim_id, wbn, closing_remark, status,
 *             jarvis_ticket_id, ... }] }
 *
 * status values observed: "claim_rejected". Others inferred:
 *   open / claim_approved / in_review / (pending?)
 * The mapping table below leaves unknowns as null so the CMS status is
 * untouched rather than mis-labelled.
 */
export function listLostDamageClaims(ctx: any, { awb, monthsWindow }?: {
    monthsWindow?: number;
}): Promise<any>;
export function mapDelhiveryStatus(delhiveryStatus: any): any;
export function claimStatusToCmsStatus(delhiveryStatus: any): any;
export namespace DELHIVERY_TO_CMS_STATUS {
    export let claim_rejected: string;
    export let claim_approved: string;
    export let approved: string;
    export let resolved: string;
    let rejected_1: string;
    export { rejected_1 as rejected };
    export let open: string;
    export let in_review: string;
    export let pending: string;
    export let processing: string;
    export let awaiting_response: string;
    export let seller_action_required: string;
}
import { GATEWAY_HOST } from "../../common/sessionStore";
export function apiHeaders(ctx: any, extra?: {}): {
    "user-agent": string;
    accept: string;
    "accept-language": string;
    authorization: string;
    "content-type": string;
    origin: string;
    referer: string;
    "x-ucp-request-id": `${string}-${string}-${string}-${string}-${string}`;
};
export function httpCall(ctx: any, { method, url, data, headers, step }: {
    method?: string;
    url: any;
    data: any;
    headers: any;
    step: any;
}): Promise<any>;
export { GATEWAY_HOST };
