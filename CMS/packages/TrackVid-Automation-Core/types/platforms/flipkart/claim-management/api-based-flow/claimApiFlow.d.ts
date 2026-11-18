export namespace FLIPKART_TO_CMS_STATUS {
    let OPEN: string;
    let PROCESSING: string;
    let IN_REVIEW: string;
    let SELLER_PENDING: string;
    let APPROVED: string;
    let CLAIM_APPROVED: string;
    let REJECTED: string;
    let NOT_APPROVED: string;
    let CLAIM_REJECTED: string;
}
export function mapFlipkartStatus(flipkartStatus: any): any;
/**
 * Logs in with Selenium, harvests cookies + CSRF token, closes the browser.
 * Returns the ctx object every other function in this file takes.
 *
 * `maxAttempts` retries ONLY an OTP-stuck login, tearing the browser down in
 * between so the retry starts from clean cookies/storage. The caller scales it
 * with batch size for the same reason the Selenium runner does: one flaky OTP
 * otherwise fails every AWB that shares this login.
 *
 * `fetchOtp`, `operatorFallback` and `operatorTimeoutMs` go straight to
 * `flipkartLogin`, and only when given. Dropping them made the desktop app's
 * session capture read Gmail from an environment only the server has: it worked
 * in development (where .env is loaded) and failed every OTP in the packaged
 * app. Omitted, the login reads Gmail exactly as it always has.
 */
export function loginFlipkartApi(credentials: any, { maxAttempts, forceFresh, fetchOtp, operatorFallback, operatorTimeoutMs }?: {
    maxAttempts?: number;
    forceFresh?: boolean;
}): Promise<{
    jar: any;
    csrfToken: any;
    sellerId: any;
}>;
export function claimStatusToCmsStatus(claimStatus: any): any;
export function ineligibilityError(item: any): Error;
/**
 * trackingId (the CMS awbNumber) → the return line item to claim against.
 *
 * Returns:
 *   { found: false, item: null,  claimId: null }   — nothing on this account
 *   { found: true,  item, claimId: null }          — claimable
 *   { found: true,  item, claimId: "..." }         — already claimed; the caller
 *                                                    records the id instead of
 *                                                    filing a duplicate
 */
export function getOrderSearch(ctx: any, trackingId: any): Promise<{
    found: boolean;
    item: any;
    claimId: any;
}>;
export function getProductTypes(ctx: any): Promise<any>;
export function getIssueTypes(ctx: any, productType: any): Promise<any>;
export function resolveFromVocabulary(value: any, vocabulary: any, label: any): any;
/**
 * POST multipart to /napi/payments-rest/uploadSpfClaimFile → { url: "/attachments/..." }.
 * That `url` becomes the `path` of a createClaimV2 attachment entry.
 *
 * TWO different names are in play and they must not be conflated:
 *   - the multipart FILENAME, which Flipkart extension-checks, so it always
 *     comes from the file on disk (…_shipping_123.png), and
 *   - `displayName`, the label that goes in the createClaimV2 attachments array
 *     ("shipping-label" in the captured payload), which never touches the upload.
 *
 * NOTE: the capture recorded the response but not the multipart body (Chrome's
 * debugger omits binary payloads), so the form field name is not proven. "file"
 * is the overwhelming convention; override with FLIPKART_UPLOAD_FIELD if the
 * server rejects it.
 */
export function uploadSpfClaimFile(ctx: any, filePath: any, displayName: any): Promise<{
    name: any;
    path: any;
}>;
export function createClaimV2(ctx: any, variables: any): Promise<any>;
/**
 * Mirrors the UI: open SPF Claims, select the Processing tab, search by
 * tracking id, read the Claim ID off the single matching row.
 *
 * Kept for callers that already know the state. `findClaim` asks the counts
 * first and so does not need to.
 */
export function getClaimIdFromProcessing(ctx: any, trackingId: any, { status }?: {
    status?: string;
}): Promise<string>;
/**
 * Step 1 — how many claims match `searchText`, per state.
 * @returns {Promise<import("./flipkartApiTypes").ClaimStateCounts>}
 */
export function getClaimStateCounts(ctx: any, searchText: any): Promise<import("./flipkartApiTypes").ClaimStateCounts>;
/**
 * Step 2 — one page of the claims list for ONE state.
 * @returns {Promise<{ hasMore: boolean, nextUrl: string|null, claims: import("./flipkartApiTypes").SpfClaim[] }>}
 */
export function getSpfClaims(ctx: any, { search, searchOption, status, pageSize, startingPage }?: {
    search?: any;
    searchOption?: string;
    pageSize?: number;
    startingPage?: number;
}): Promise<{
    hasMore: boolean;
    nextUrl: string | null;
    claims: import("./flipkartApiTypes").SpfClaim[];
}>;
/**
 * tracking id → the claim Flipkart holds for it, with its state and amounts.
 * Returns null when there is no claim for it on this account.
 *
 * The two-step lookup above: counts name the state tabs, then each named tab is
 * searched. A parcel can carry more than one claim over its life (one rejected,
 * one re-filed) — `hint.claimId` picks a known one, otherwise the newest wins.
 *
 * @param {object} ctx
 * @param {string} trackingId
 * @param {{ claimId?: string|null, orderItemId?: string|null, returnId?: string|null }} [hint]
 * @returns {Promise<import("./flipkartApiTypes").FoundClaim|null>}
 */
export function findClaim(ctx: object, trackingId: string, hint?: {
    claimId?: string | null;
    orderItemId?: string | null;
    returnId?: string | null;
}): Promise<import("./flipkartApiTypes").FoundClaim | null>;
/**
 * Global AWB search. `searchBy` is "tracking_id" (the CMS AWB) or
 * "order_item_id", the two the portal uses.
 *
 * Returns { found, returns[] }, `returns` holding only rows that really are for
 * `searchValue`. What Flipkart answers for an unknown AWB is not in the capture:
 * an empty or null `response` is read as not found, and so is a GraphQL error
 * that says so — anything else is thrown, because "could not ask" is not "not on
 * this account".
 *
 * @returns {Promise<{ found: boolean, returns: import("./flipkartApiTypes").AccountReturn[] }>}
 */
export function searchReturnItem(ctx: any, searchValue: any, { searchBy }?: {
    searchBy?: string;
}): Promise<{
    found: boolean;
    returns: import("./flipkartApiTypes").AccountReturn[];
}>;
/**
 * The amount Flipkart approved, only when the claim IS approved. Every other
 * state carries approvedAmount 0, which is not a payout.
 * @param {{ status?: string|null, approvedAmount?: number|null }|null} claim
 * @returns {number|null}
 */
export function approvedAmountOf(claim: {
    status?: string | null;
    approvedAmount?: number | null;
} | null): number | null;
/**
 * Which of the returned rows is OUR claim.
 *
 * Strict. The filter is server-side, but a row is only accepted when something
 * on it ties it to this parcel: the tracking id itself, or — because older
 * claims come back with trackingId null — the claim id / order item id / return
 * id the caller already knows. Never rows[0]: a wrong ticket number stapled onto
 * a CMS row is worse than none.
 */
export function matchesClaim(row: any, trackingId: any, { claimId, orderItemId, returnId }?: {}): boolean;
export function cookieHeader(jar: any): string;
export function discoverCsrfToken(driver: any, jar: any): Promise<any>;
export const ORIGIN: "https://seller.flipkart.com";
