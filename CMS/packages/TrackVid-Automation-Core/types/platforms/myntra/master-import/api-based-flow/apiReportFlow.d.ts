export const MYNTRA_STORE_ID: 2297;
export const MYNTRA_LOGIN_CIDX: string;
export namespace REPORT_IDS {
    let Seller_Orders_Report: number;
    let Seller_Returns_Report: number;
    let Seller_Listings_Report: number;
    let Seller_Inventory_Report: number;
}
export const MDIRECT_REPORT_IDS: {};
export namespace IMPORT_TYPE_API_CONFIG {
    namespace returnOrderData {
        import reportId = REPORT_IDS.Seller_Returns_Report;
        export { reportId };
        export let portalReportName: string;
        export let trackvidReportType: string;
        export let lookbackDaysCap: number;
    }
    namespace orderData {
        import reportId_1 = REPORT_IDS.Seller_Orders_Report;
        export { reportId_1 as reportId };
        let portalReportName_1: string;
        export { portalReportName_1 as portalReportName };
        let trackvidReportType_1: any;
        export { trackvidReportType_1 as trackvidReportType };
        let lookbackDaysCap_1: number;
        export { lookbackDaysCap_1 as lookbackDaysCap };
    }
    namespace listingsData {
        import reportId_2 = REPORT_IDS.Seller_Listings_Report;
        export { reportId_2 as reportId };
        let portalReportName_2: string;
        export { portalReportName_2 as portalReportName };
        let trackvidReportType_2: any;
        export { trackvidReportType_2 as trackvidReportType };
        let lookbackDaysCap_2: number;
        export { lookbackDaysCap_2 as lookbackDaysCap };
    }
    namespace inventoryData {
        import reportId_3 = REPORT_IDS.Seller_Inventory_Report;
        export { reportId_3 as reportId };
        let portalReportName_3: string;
        export { portalReportName_3 as portalReportName };
        let trackvidReportType_3: any;
        export { trackvidReportType_3 as trackvidReportType };
        let lookbackDaysCap_3: number;
        export { lookbackDaysCap_3 as lookbackDaysCap };
    }
}
export function getImportTypeApiConfig(importType: any): any;
export function computeDateRange(scenario: any, lastSyncDate: any, lookbackDaysCap?: number): {
    from: string;
    to: string;
};
/**
 * Log a seller in via Selenium (real browser), extract cookies, close the
 * browser, and return a jar usable by the other axios-based functions.
 *
 * Selenium is required because Akamai on accounts.myntra.com hard-blocks
 * pure Node HTTP at the TLS-handshake level — verified by empty 60s timeouts.
 * A real Chrome sails through. Once we have the session cookies, partnersapi
 * accepts axios requests fine (Akamai on the API subdomain is much more lax).
 *
 * Delegates to the CLAIM folder's buildDriverAndLogin — Chrome is always
 * visible (HEADLESS is hard-coded false there), Bright Data proxy is used
 * for mapped accounts, Network-Error retry is included. Same browser + login
 * behavior as the running myntraAutoClaim flow.
 */
export function loginMyntra(email: any, password: any, { forceFresh }?: {
    forceFresh?: boolean;
}): Promise<any>;
/**
 * Discover the current seller's partnerId, sellerType, etc. from the boot API.
 * `sellerType` here is an array like ["PPMP"] — used AS-IS as `partnerType` in
 * the schedule POST (this is distinct from the top-level `partnerType`: "SELLER").
 */
export function getPartnerBoot(jar: any): Promise<{
    partnerId: string;
    sellerId: number;
    sellerType: any;
    sellerTypes: any;
    partnerCode: any;
    firstlogin: boolean;
    hasAccess: boolean;
    isAdmin: boolean;
    raw: any;
}>;
/**
 * Ask Myntra to build a report for [from, to]. Returns the job id to poll.
 * `partnerType` is the sellerType from getPartnerBoot() (e.g. "PPMP"), NOT
 * the boot response's top-level partnerType ("SELLER").
 */
export function scheduleReport(jar: any, { reportId, storeId, partnerType, from, to }: {
    reportId: any;
    storeId: any;
    partnerType: any;
    from: any;
    to: any;
}): Promise<{
    jobId: any;
    status: any;
    reportName: any;
}>;
/**
 * One-shot list of the seller's most recent report jobs (all statuses).
 * The queue-based runner calls this ONCE per seller per poll round: the
 * response contains status + successFile for every recently-submitted job,
 * so N pending jobs for one seller = one HTTP call, not N.
 */
export function searchJobs(jar: any, { pageSize, start }?: {
    pageSize?: number;
    start?: number;
}): Promise<any>;
/**
 * Poll the jobs/search endpoint until our jobId reaches COMPLETED (or FAILED).
 * pageSize=25 covers the case where a busy seller has other jobs queued in
 * front of ours; we page (using `start`) up to a safe cap if not found.
 */
export function pollJob(jar: any, jobId: any, { timeoutMs, pollMs, pageSize, maxPages }?: {
    timeoutMs?: number;
    pollMs?: number;
    pageSize?: number;
    maxPages?: number;
}): Promise<{
    successFile: any;
    row: any;
}>;
/**
 * Download the completed report file. The endpoint wraps a signed Azure blob URL
 * and returns the raw CSV bytes directly (verified: text/csv, ~26k rows).
 */
export function downloadReport(jar: any, successFileUrl: any): Promise<{
    buffer: Buffer<any>;
    contentType: any;
}>;
declare function cookieHeader(jar: any): string;
declare function parseSetCookie(headers: any): {
    name: string;
    value: string;
}[];
export { cookieHeader as _cookieHeader, parseSetCookie as _parseSetCookie };
