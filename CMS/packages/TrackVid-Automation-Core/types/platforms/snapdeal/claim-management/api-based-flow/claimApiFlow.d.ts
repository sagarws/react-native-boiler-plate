/**
 * @param credentials            the marketplace credential
 * @param opts.forceFresh        ignore any cached session and log in again
 * @param opts.session           a jar the caller already holds, e.g. one the
 *                               desktop app captured in its own browser window.
 *                               Used as-is: it skips both the session store and
 *                               Puppeteer, which is what lets this flow run
 *                               somewhere with no database access.
 * @param opts.fetchOtp          where an emailed code is read from, passed to
 *                               `snapdealLogin`. Omitted, it reads this
 *                               machine's mailbox as before; the desktop app
 *                               passes its own, having no IMAP environment.
 * @param opts.holdOnOtpFailureMs keep the browser open this long after an OTP
 *                               failure, so a person can see the page that
 *                               refused it. 0 (the default) closes at once.
 * @param opts.otpMailDelayMs    wait this long before reading the OTP mail.
 * @param opts.otpResends        on a refused code, "Resend OTP" up to this many
 *                               times. Both default 0: today's behaviour.
 */
export function loginSnapdealApi(credentials: any, { forceFresh, session, fetchOtp, holdOnOtpFailureMs, otpMailDelayMs, otpResends, }?: {
    forceFresh?: boolean;
    session?: any;
    holdOnOtpFailureMs?: number;
    otpMailDelayMs?: number;
    otpResends?: number;
}): Promise<{
    jar: any;
    sellerId: any;
}>;
/**
 * awbNumber → the return line item to raise a dispute against.
 *
 * Returns:
 *   { found: false, item: null }                      — nothing on this account
 *   { found: true,  item, alreadyDisputed: false }    — claimable
 *   { found: true,  item, alreadyDisputed: true, disputeId } — already raised
 *
 * `matchedBy` on a hit says which search answered — "awb" or "suborder".
 *
 * Pass `subOrderId` to enable the FALLBACK. The AWB search is not always the
 * way in: Snapdeal answers a term its edge dislikes with an HTTP 800 rather
 * than an empty result (a whole Snapdeal batch failed this way with "Global
 * search failed: HTTP 800"), and a return whose AWB was blank or re-issued
 * never matches on it at all. The suborder is present on the CMS row in both
 * cases, and is the portal's own second dropdown option — the same fallback
 * the Puppeteer runner has in `searchBySuborderId`. It is only tried when the
 * AWB search errored or matched nothing, and only when the suborder is a real
 * value, so a caller that has no suborder behaves exactly as before.
 *
 * The capture doesn't include response bodies, so the shape is inferred from
 * the portal's UI (Delivered Returns table columns: suborderCode, awbNumber,
 * status). If the response shape differs at runtime, adjust `extractReturnRow`.
 */
export function globalSearchAwb(ctx: any, awbNumber: any, { subOrderId }?: {
    subOrderId?: any;
}): Promise<{
    found: boolean;
    item: any;
    alreadyDisputed: boolean;
    disputeId: any;
    matchedBy: any;
    returnType: any;
} | {
    found: boolean;
    item: any;
    matchedBy: any;
    returnType: any;
    alreadyDisputed?: undefined;
    disputeId?: undefined;
}>;
/**
 * WHICH KIND OF RETURN THIS IS — and it is not always the same kind.
 *
 * `Courier_Return` was hard-coded here, in the issue-category lookup and in the
 * dispute itself, from the one capture we had. The portal sends the return's
 * OWN type: a manual claim that Snapdeal accepted carried `Buyer_Return`, and
 * every automated claim sending `Courier_Return` for the same kind of packet
 * came back HTTP 502 — a gateway error rather than a refusal, which is what a
 * backend does when the pair (returnType, issueType) does not resolve to
 * anything it can build a case from.
 *
 * It also decides the ISSUE VOCABULARY: `issueCategories` is fetched per return
 * type, so "Wrong Product Received" is not necessarily id 1 in both. Asking for
 * the wrong list means filing under the wrong id even when the request is
 * accepted, which is worse than a 502.
 *
 * Read from the row first, then from the response's own grouping (the capture
 * shows `returnType: { delivered: ["Courier_Return"], returnsList: [...] }` —
 * the arrays of STRINGS are the types, the array of objects is the rows), and
 * null when neither says. Null means the caller keeps today's default rather
 * than inventing one.
 */
export function returnTypeOf(item: any, data: any): any;
export function getSuborderCode(item: any): any;
/**
 * GET /returns/issueCategories?returnType=Courier_Return
 *
 * VERIFIED response (seller.snapdeal.com, Aug 2026) — rows are under `list`,
 * and the label key is `category`, not label/name:
 *   { list: [ { id: 1, category: "Wrong Product Received" },
 *             { id: 6, category: "Package Not Received" },
 *             { id: 4, category: "Empty Package Received" },
 *             { id: 2, category: "Damaged Product Received" },
 *             { id: 3, category: "Partial Package Received" } ] }
 * `id` is what raiseDispute takes as `issueType` (int).
 */
export function getIssueCategories(ctx: any, returnType?: string): Promise<{
    id: number;
    label: any;
}[]>;
export function resolveIssueCategory(cmsValue: any, vocabulary: any): any;
export function uploadAttachment(ctx: any, filePath: any): Promise<string>;
export function uploadVideoAttachment(ctx: any, filePath: any): Promise<string>;
/**
 * POST /returns/raiseDispute
 *
 * Body shape verified from the capture:
 *   {
 *     suborderCode:    "SDLC1077502060...",
 *     statusToBeMarked:"DISPUTE",
 *     returnType:      "Courier_Return",
 *     issueType:       <int, from issueCategories>,
 *     issueType_desc:  <string, the human label>,
 *     description:     <string>,
 *     imageUrls:       [ "<S3 url>", ... ],
 *     videoUrl:        "<S3 url or empty string>"
 *   }
 *
 * Response body isn't in the capture; the dispute id is looked up afterwards
 * via /returns/getDisputes (see getDisputeIdBySuborder).
 */
export function raiseDispute(ctx: any, { suborderCode, issueType, issueType_desc, description, imageUrls, videoUrl, returnType, }: {
    suborderCode: any;
    issueType: any;
    issueType_desc: any;
    description: any;
    imageUrls: any;
    videoUrl: any;
    returnType?: string;
}): Promise<any>;
/**
 * GET /queries/caseDetail?caseNumber=&pageNumber=&pageSize=
 * → { success, tktCase, lstCaseComments, lstCaseAttachments, noOfReopens, caseReopened }
 */
export function getCaseDetail(ctx: any, caseNumber: any, { pageNumber, pageSize }?: {
    pageNumber?: number;
    pageSize?: number;
}): Promise<any>;
/** POST multipart /queries/uploadAttachment — images and documents. Returns the link. */
export function uploadQueryAttachment(ctx: any, filePath: any): Promise<string>;
/** POST multipart /queries/uploadVideoAttachment — one video per comment. Returns the link. */
export function uploadQueryVideo(ctx: any, filePath: any): Promise<string>;
/**
 * POST /queries/addComment
 * Body: { caseNumber, comment, attachments: [{ name, url }], videoLink }
 * A comment on a closed case reopens it — the answer says so (caseReopened).
 */
export function addCaseComment(ctx: any, { caseNumber, comment, attachments, videoLink }: {
    caseNumber: any;
    comment?: string;
    attachments?: any[];
    videoLink: any;
}): Promise<any>;
/**
 * The query uploads answer `uploadedFileURL` with a token in front of the
 * link ("/N2CQLDnOc0= - https://snapdeal-sf-prod-mum…"); the comment carries
 * the link alone, as the panel sends it.
 */
export function queryUploadUrl(raw: any): string;
/**
 * POST /returns/getDisputes
 *
 * Body shape (verified):
 *   { caseId: null, subOrderId: "<sub>", status: null,
 *     dateRange: { start, end }, pageNumber: 1, pageSize: 10 }
 *
 * Returns the disputes for that suborder. We take the newest one's id as the
 * ticket id (the run we just filed created it).
 */
export function getDisputes(ctx: any, { subOrderId, pageSize }: {
    subOrderId: any;
    pageSize?: number;
}): Promise<any[]>;
export function getDisputeIdBySuborder(ctx: any, subOrderId: any): Promise<any>;
/**
 * The completed return for this AWB, and what it says about the claim.
 *
 * @returns {Promise<{found: boolean, row: object|null, status: string|null,
 *   amount: number|null, returnType: string|null}>}
 */
export function fetchSettledReturn(ctx: any, { awbNumber, subOrderNumber, returnType, pageSize }: {
    awbNumber: any;
    subOrderNumber?: any;
    returnType?: any;
    pageSize?: number;
}): Promise<{
    found: boolean;
    row: object | null;
    status: string | null;
    amount: number | null;
    returnType: string | null;
}>;
export function paidAmountOf(row: any): number;
/**
 * The newest dispute for `subOrderId`, or null.
 *
 * Filtered on the suborder as well as sorted: the endpoint is queried by
 * suborder, but a case carries `subOrderIds` (a list), and reporting another
 * packet's case as this claim's ticket would mark the wrong claim filed. A case
 * that lists no suborders at all is kept — the query already scoped it.
 */
export function newestDispute(disputes: any, subOrderId: any): any;
export function mapSnapdealStatus(snapdealStatus: any): any;
export function claimStatusToCmsStatus(snapdealStatus: any): any;
export namespace SNAPDEAL_TO_CMS_STATUS {
    let OPEN: string;
    let PROCESSING: string;
    let IN_REVIEW: string;
    let IN_PROGRESS: string;
    let PENDING: string;
    let AWAITING_SELLER_RESPONSE: string;
    let SELLER_ACTION_REQUIRED: string;
    let APPROVED: string;
    let RESOLVED: string;
    let CLOSED_APPROVED: string;
    let REJECTED: string;
    let CLOSED_REJECTED: string;
    let DENIED: string;
}
export function extractReturnRow(data: any, wanted: any, matchOn?: string[]): any;
export function apiHeaders(ctx: any, extra?: {}): {
    cookie: string;
    "sec-ch-ua": string;
    "sec-ch-ua-mobile": string;
    "sec-ch-ua-platform": string;
    "user-agent": string;
    accept: string;
    "accept-language": string;
    origin: string;
    Referer: string;
    "x-requested-with": string;
};
export function httpCall(ctx: any, { method, url, data, headers, step, responseType }: {
    method?: string;
    url: any;
    data: any;
    headers: any;
    step: any;
    responseType: any;
}): Promise<any>;
import { ORIGIN } from "../../common/sessionStore";
export { ORIGIN };
