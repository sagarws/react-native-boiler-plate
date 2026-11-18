export namespace IMPORT_TYPE_API_CONFIG {
    namespace returnOrderData {
        let reportType: string;
        let queryType: string;
        let state: string;
        let fulfillmentMode: string;
        let subCategory: string;
        let listCategory: string;
        let subArea: string;
        let portalReportName: string;
        let trackvidReportType: string;
        let lookbackDaysCap: number;
    }
}
export function getImportTypeApiConfig(importType: any): any;
export function computeDateRange(scenario: any, lastSyncDate: any, lookbackDaysCap: any): {
    fromDate: Date;
    toDate: Date;
    from: string;
    to: string;
};
export function formatSnapdealDate(d: any): string;
/**
 * Locate the report we scheduled.
 *
 * Matched on `name` plus recency, NOT on requestId: the list rows carry no id
 * of any kind, so the requestId the schedule returns has nothing to match
 * against. `notBefore` keeps yesterday's identically-named report from being
 * mistaken for today's — without it the newest row wins even when our own
 * request has not appeared yet, and the import silently loads stale data.
 */
export function findReport(list: any, { reportName, notBefore }: {
    reportName: any;
    notBefore: any;
}): any;
export function loginMasterData(email: any, password: any, credentialId: any, { forceFresh }?: {
    forceFresh?: boolean;
}): Promise<any>;
/**
 * POST /report/generateReport
 *
 * Body verified from capture (see file header). Returns { requestId,
 * initiationText, scheduledAt } — requestId is the report's row id in the
 * Reports list, initiationText is the human string the Puppeteer runner
 * matches on (portalReportName + " Created between <from> and <to>").
 */
export function scheduleReport(jar: any, importType: any, { from, to, fromDate, toDate }: {
    from: any;
    to: any;
    fromDate: any;
    toDate: any;
}): Promise<{
    requestId: any;
    reportName: any;
    scheduledAt: Date;
    listCategory: any;
    subArea: any;
    portalReportName: any;
    trackvidReportType: any;
}>;
/**
 * GET /report/get?category=Returns&pageSize=10&start=0
 *
 * Verified response:
 *   { reports: [{ name, status, startTime, endTime, code, area, subArea }] }
 *
 * `code` is null while the report is building and becomes the download token
 * when it completes, so downloadHref is derived rather than read.
 */
export function listReports(jar: any, { category, pageSize, start }?: {
    pageSize?: number;
    start?: number;
}): Promise<any>;
/**
 * Download the completed report. Snapdeal's downloadHref is either a full
 * URL or a path relative to seller.snapdeal.com — normalise here.
 * Returns { buffer, contentType, filename }.
 */
export function downloadReport(jar: any, downloadHref: any): Promise<{
    buffer: Buffer<any>;
    contentType: any;
    filename: string;
}>;
