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
export const REPORT_ENDPOINTS: {
    "Dropship Order Report": string;
    "Dropship Rtv Report": string;
};
export const MAX_CHUNK_DAYS: 30;
/**
 * Read the seller's AJIO userId from browser storage after login.
 * Primary source: localStorage "activeSellerProfileId". Falls back to the first GUID
 * found across local/session storage. Returns null if none found.
 */
export function getUserId(page: any, { maxWaitMs, pollMs }?: {
    maxWaitMs?: number;
    pollMs?: number;
}): Promise<any>;
/**
 * Fetch the seller's PoB (place-of-business) ids via the work-places API, in-page.
 * Pages through results (size=100) in case a seller has many PoBs.
 * Returns { pobIds: string[], stores: [{id, storeName}] }.
 * Throws on a non-2xx first-page response so the caller can fail the account cleanly.
 */
export function getPobIds(page: any, userId: any): Promise<{
    pobIds: any[];
    stores: {
        id: any;
        storeName: any;
    }[];
}>;
/**
 * Download one report for a single date window (must be <= 31 days), in-page.
 * Returns:
 *   { ok: true,  buffer: Buffer, contentType }            on 200 (xlsx)
 *   { ok: false, noData: true, status, body }             on 404 "No records found"
 *   { ok: false, noData: false, status, body }            on any other status / error
 */
export function downloadReport(page: any, { reportType, pobIds, from, to }: {
    reportType: any;
    pobIds: any;
    from: any;
    to: any;
}): Promise<{
    ok: boolean;
    noData: boolean;
    status: any;
    body: any;
    buffer?: undefined;
    contentType?: undefined;
} | {
    ok: boolean;
    buffer: Buffer<ArrayBuffer>;
    contentType: any;
    noData?: undefined;
    status?: undefined;
    body?: undefined;
}>;
