/**
 * Run the full forward-orders flow for one config.
 * Assumes the user is already logged in.
 *
 * @param {import('puppeteer').Page} page
 * @param {object} config — must include scenario, lastSyncDate?, tempFilePath
 * @returns {Promise<{ chunks: Array }>}
 */
export function runForwardFlow(page: any, config: object): Promise<{
    chunks: any[];
}>;
export function navigateToDashboard(page: any): Promise<boolean>;
export function navigateToTab(page: any, tabName: any): Promise<boolean>;
export function navigateToManageOrders(page: any): Promise<boolean>;
export function openDownloadOrdersDropdown(page: any): Promise<boolean>;
export function openingDateRangeModal(page: any): Promise<void>;
export function selectDateRange(page: any, fromDate: any, toDate: any): Promise<boolean>;
export function downloadLast28Days(page: any, downloadPath: any, config: any): Promise<({
    success: boolean;
    filePath: string;
    fileName: string;
    fromDate: string;
    toDate: string;
} | {
    success: boolean;
    error: any;
    fromDate: string;
    toDate: string;
})[]>;
export function downloadIncrementalData(page: any, lastSyncDate: any, downloadPath: any, config: any): Promise<{
    success: boolean;
    filePath: string;
    fileName: string;
    fromDate: string;
    toDate: string;
}[]>;
/** Format Date → "DD/MM/YYYY" (Meesho's display format). */
export function formatDate(date: any): string;
/**
 * Last 28 days as a single chunk: (today - 28 days) → today.
 * Returned as a one-element array to keep the retry-loop shape consistent
 * with the incremental flow.
 */
export function getLast28DaysChunk(toDate?: Date): {
    fromDate: string;
    toDate: string;
}[];
/** Single chunk: lastSync → today. */
export function getIncrementalChunk(lastSyncDate: any, toDate?: Date): {
    fromDate: string;
    toDate: string;
}[];
