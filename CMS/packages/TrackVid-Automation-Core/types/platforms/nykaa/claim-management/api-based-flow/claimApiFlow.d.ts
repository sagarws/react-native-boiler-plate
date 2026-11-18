/**
 * @param {object} credentials
 * @param {object} [options]
 * @param {boolean} [options.forceFresh] ignore every cached session and sign in
 * @param {{jar: object, portalId?: string, userId?: string}} [options.session]
 *        A session the caller already holds. Used when it can still write; see
 *        `usableSuppliedSession`. A caller that passes nothing behaves exactly
 *        as before.
 * @returns {Promise<{jar: object, portalId: string, userId: string|null, reused?: boolean}>}
 */
export function loginNykaaApi(credentials: object, { forceFresh, session }?: {
    forceFresh?: boolean;
    session?: {
        jar: object;
        portalId?: string;
        userId?: string;
    };
}): Promise<{
    jar: object;
    portalId: string;
    userId: string | null;
    reused?: boolean;
}>;
export function getMe(ctx: any): Promise<any>;
/**
 * POST /portal/api/tickets?portalId=<PORTAL_ID>
 *
 * Body verified from the capture:
 *   {
 *     departmentId: "77727000009728717",
 *     layoutId:     "77727000009743998",
 *     subject:      "Wrong Product Returned - Same Brand",
 *     cf: {
 *       cf_vendor_code, cf_sku_id, cf_awb_dto_rto, cf_issue,
 *       cf_return_type, cf_evidence_url
 *     },
 *     description:  "<html-formatted body>"
 *   }
 *
 * Response includes `ticketNumber` directly — that's the "#6721437" the UI
 * shows. No readback round-trip needed.
 */
export function createTicket(ctx: any, { subject, vendorCode, skuId, reverseAwb, issue, returnType, description, evidenceUrl, departmentId, layoutId, }: {
    subject: any;
    vendorCode: any;
    skuId: any;
    reverseAwb: any;
    issue: any;
    returnType: any;
    description: any;
    evidenceUrl: any;
    departmentId?: string;
    layoutId?: string;
}): Promise<{
    ticketNumber: string;
    internalId: any;
    status: any;
    raw: any;
}>;
export function listTickets(ctx: any, { from, limit }?: {
    from?: number;
    limit?: number;
}): Promise<any>;
export function getTicketDetail(ctx: any, internalId: any): Promise<any>;
export function findTicketByReverseAwb(ctx: any, reverseAwb: any): Promise<any>;
/**
 * Find ONE ticket by its number, the way the portal's search box does.
 *
 *   GET /portal/api/tickets/search?portalId=…&searchStr=<number>&from=1&limit=10
 *       &type=Mytickets&sortBy=relevance&departmentId=…
 *   → { data: [{ ticketNumber, id, status, … }], numberOfRecords }
 *
 * One request per ticket, and no page cap: an old claim is found as easily as
 * a new one, which the reverse-AWB index cannot promise.
 *
 * `searchStr` is a full-text search, so a number can also hit a ticket that
 * merely MENTIONS it. Only an exact `ticketNumber` match is returned; anything
 * else is null, and the caller decides what null means.
 *
 * @param {object} ctx            a session from loginNykaaApi
 * @param {string|number} ticketNumber  the visible number, e.g. "7061852"
 * @param {{ departmentId?: string }} [options]
 * @returns {Promise<object|null>}
 */
export function findTicketByNumber(ctx: object, ticketNumber: string | number, { departmentId }?: {
    departmentId?: string;
}): Promise<object | null>;
/**
 * Build (once per account) a reverseAwb -> ticket index.
 *
 * The list endpoint has NO per-AWB filter — the match on cf.cf_awb_dto_rto
 * happens client-side. So looking a ticket up "by AWB" means downloading the
 * account's ticket list, and doing that per AWB re-downloads the SAME pages
 * once per row: an orphan sweep of 66 rows fired 66 identical requests in ~5
 * seconds and tripped Zoho's per-minute cap on the very first one, which then
 * failed every subsequent probe AND the claim's own dedupe check.
 *
 * Fetching once and answering every lookup from memory turns that back into a
 * handful of requests, and it is the same data either way — the list is
 * account-wide, not per-AWB.
 *
 * Cached on `ctx`, which is per-credential, so accounts never share an index.
 */
export function loadTicketIndex(ctx: any, { force }?: {
    force?: boolean;
}): Promise<any>;
/**
 * Nykaa's ticket status → the CMS status, or null when it says nothing we
 * recognise. Null LEAVES THE ROW ALONE: a status nobody has taught this app is
 * not a reason to overwrite what the row already says.
 */
export function mapNaykaaStatus(s: any): string | RegExp;
export function claimStatusToCmsStatus(s: any): string | RegExp;
/**
 * Kept as a map for callers that want to see the mapping at a glance, built
 * from the patterns so the two cannot say different things.
 */
export const NAYKAA_TO_CMS_STATUS: {
    [k: string]: string | RegExp;
};
export function resolveIssue(cmsValue: any): any;
export const NAYKAA_ISSUE_ALIAS: {
    "Damaged / Defective Product Received": string;
    "Damaged / Defective Product Recieved": string;
};
import DEFAULT_PORTAL_ID_1 = require("../../common/portal.js");
import DEFAULT_PORTAL_ID = DEFAULT_PORTAL_ID_1.NYKAA_PORTAL_ID;
export const DEFAULT_DEPARTMENT_ID: string;
export const DEFAULT_LAYOUT_ID: string;
export function apiHeaders(ctx: any, extra?: {}): {
    "user-agent": string;
    accept: string;
    "accept-language": string;
    origin: string;
    Referer: string;
    cookie: string;
};
export function httpCall(ctx: any, { method, url, data, headers, step }: {
    method?: string;
    url: any;
    data: any;
    headers: any;
    step: any;
}): Promise<any>;
import { ORIGIN } from "../../common/sessionStore";
export function csrfToken(jar: any, param?: string): string;
export function isSessionLive(ctx: any): Promise<boolean>;
import { resolveCsrfCookie } from "../../common/sessionStore";
import { CSRF_COOKIE_CANDIDATES } from "../../common/sessionStore";
export const CSRF_PARAM: string;
export const CSRF_PARAM_ALT: string;
export function rateLimitWaitMs(res: any, attempt: any): number;
export function throttle(): Promise<void>;
export const RATE_LIMIT_MIN_WAIT_MS: number;
export const RATE_LIMIT_MAX_WAIT_MS: 60000;
export function paceClaim(): Promise<void>;
export function humanClaimGapMs(): number;
export const CLAIMS_PER_MINUTE: number;
export const CLAIM_JITTER: number;
export { DEFAULT_PORTAL_ID, ORIGIN, resolveCsrfCookie, CSRF_COOKIE_CANDIDATES };
