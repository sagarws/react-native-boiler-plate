/**
 * Run the full returns flow for one config.
 * Assumes the user is already logged in.
 *
 * @param {import('puppeteer').Page} page
 * @param {object} config — must include scenario, tempFilePath
 * @returns {Promise<{ filePath: string, fileName: string }>}
 */
export function runReturnsFlow(page: any, config: object): Promise<{
    filePath: string;
    fileName: string;
}>;
export function clickReturnExportData(page: any): Promise<boolean>;
export function downloadExportedReturnFile(page: any, targetLabel: any, downloadPath: any): Promise<{
    filePath: string;
    fileName: string;
}>;
