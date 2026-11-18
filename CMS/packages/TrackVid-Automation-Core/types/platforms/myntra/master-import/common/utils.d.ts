export function sleep(ms: any): Promise<any>;
export function waitFor(driver: any, label: any, condition: any, timeout?: number): Promise<any>;
export function clickWhenReady(driver: any, locator: any, label: any): Promise<any>;
export function hoverElement(driver: any, locator: any, label: any): Promise<void>;
export function typeWhenReady(driver: any, locator: any, value: any, label: any, { perCharMs }?: {
    perCharMs?: number;
}): Promise<void>;
export function formatYMD(d: any): string;
export function dateTitle(d: any): any;
export function buildDriver({ headless, downloadDir, sessionId, accountEmail }?: {
    headless?: any;
    downloadDir?: any;
    sessionId?: any;
    accountEmail?: any;
}): Promise<any>;
export function destroyDriver(driver: any): Promise<void>;
export function setDownloadDir(driver: any, downloadDir: any): Promise<void>;
export function getCurrentIp(driver: any, label: any): Promise<string>;
export function buildDriverAndLogin(credentials: any, { accountEmail, headless, downloadDir, maxAttempts, postLogin, postLoginOptions, }?: {
    headless?: any;
    downloadDir?: any;
    maxAttempts?: number;
    postLogin?: boolean;
    postLoginOptions?: {};
}): Promise<{
    driver: any;
    sessionId: any;
    ip: string;
}>;
export function myntraLogin(driver: any, credentials: any): Promise<boolean>;
export function myntraLoginWithRetry(driver: any, credentials: any, maxAttempts?: number): Promise<boolean>;
export function completePostLogin(driver: any, credentials: any, { modalBestEffort }?: {
    modalBestEffort?: boolean;
}): Promise<boolean>;
export function handleRelationshipTypeModal(driver: any, partnerType: any): Promise<boolean>;
export function navigateToOperationalReports(driver: any): Promise<void>;
export function selectUDropdownOption(driver: any, fieldLabel: any, optionText: any): Promise<void>;
export function fillDateRange(driver: any, fromDate: any, toDate: any): Promise<{
    fromDate: any;
    toDate: any;
}>;
export function clickGenerateReport(driver: any): Promise<void>;
export function getMyntraBannerError(driver: any): Promise<any>;
export function findReportRowByDateRange(driver: any, { store, reportName, partnerType, dateRange }: {
    store: any;
    reportName: any;
    partnerType: any;
    dateRange: any;
}): Promise<{
    store: any;
    reportName: any;
    partnerType: any;
    dateRange: any;
    queryDate: any;
    status: any;
    expectedFinish: any;
}>;
export function findAndClickDownload(driver: any, { store, reportName, partnerType, dateRange }: {
    store: any;
    reportName: any;
    partnerType: any;
    dateRange: any;
}): Promise<boolean>;
