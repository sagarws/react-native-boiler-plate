export namespace REPORTS {
    export namespace forward {
        let reportName: string;
        let sheet: string;
    }
    export namespace _return {
        let reportName_1: string;
        export { reportName_1 as reportName };
        let sheet_1: string;
        export { sheet_1 as sheet };
    }
    export { _return as return };
}
/** The group both reports are listed under. */
export const REPORT_GROUP: "Fulfilment Reports";
/** The list status that means "there is a file". */
export const FILE_READY: "FILE_STORED";
export function reportConfig(report: any): any;
/** The seller id the download URL needs: the context, else the cookie. */
export function sellerIdOf(ctx: any): string;
/**
 * Ask Flipkart to build one report for a window (`yyyy-MM-dd`, inclusive).
 * Returns `{ requestId, eta }`. Throws when the portal answers without an id —
 * a request nobody can find again is not a request.
 */
export function submitReport(ctx: any, report: any, { from, to }: {
    from: any;
    to: any;
}): Promise<{
    requestId: any;
    eta: any;
}>;
/**
 * The Fulfilment Reports list, newest first, across `pages` pages.
 * Rows keep their status — "still building" and "failed" are both answers.
 */
export function listReports(ctx: any, { pageSize, pages }?: {
    pageSize?: number;
    pages?: number;
}): Promise<{
    requestId: any;
    reportName: any;
    status: string;
    createdAt: number;
    size: number;
    from: any;
    to: any;
    sellerId: any;
}[]>;
export function isReady(row: any): boolean;
export function isFailed(row: any): boolean;
/** The download URL for a finished list row. */
export function downloadUrl(row: any, sellerId: any): string;
/** Fetch one finished report. Returns `{ buffer, filename }`. */
export function downloadReport(ctx: any, row: any): Promise<{
    buffer: Buffer<any>;
    filename: string;
}>;
/** One list row, reduced to what a caller needs. */
export function toListRow(raw: any): {
    requestId: any;
    reportName: any;
    status: string;
    createdAt: number;
    size: number;
    from: any;
    to: any;
    sellerId: any;
};
