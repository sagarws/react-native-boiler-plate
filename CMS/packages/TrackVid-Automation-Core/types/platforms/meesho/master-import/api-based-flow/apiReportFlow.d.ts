export function loginMasterData(email: any, password: any, credentialId: any, { forceFresh }?: {
    forceFresh?: boolean;
}): Promise<{
    jar: any;
    supplierId: any;
    supplierIdentifier: any;
}>;
export function requestOrderReport(ctx: any, { from, to }: {
    from: any;
    to: any;
}): Promise<any>;
export function listReportHistory(ctx: any): Promise<any>;
export function findMatchingReport(history: any, { from, to, requestedAt }: {
    from: any;
    to: any;
    requestedAt: any;
}): any;
export function getReportStatus(record: any): string;
export function getReportDownloadUrl(record: any): any;
export function downloadReportFile(ctx: any, url: any): Promise<{
    buffer: Buffer<any>;
    contentType: any;
    filename: string;
}>;
export function runReturnReport(): Promise<void>;
export function computeDateRange(scenario: any, lastSyncDate: any, lookbackDaysCap?: number): {
    from: string;
    to: string;
};
