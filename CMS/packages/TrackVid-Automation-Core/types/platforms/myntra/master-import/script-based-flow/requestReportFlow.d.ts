export namespace IMPORT_TYPE_CONFIG {
    namespace returnOrderData {
        let store: string;
        let portalReportName: string;
        namespace portalReportNameByPartnerType {
            let MDIRECT: string;
        }
        let lookbackDaysCap: number;
        let trackvidReportType: string;
    }
}
export function getImportTypeSpec(importType: any): any;
export function parseMyntraTimestamp(raw: any): Date;
export function runRequestReportFlow(driver: any, config: any): Promise<{
    store: any;
    reportName: any;
    partnerType: any;
    dateRange: string;
    queryDate: any;
    status: any;
    expectedFinishRaw: any;
    expectedFinishAt: Date;
    trackvidReportType: any;
}>;
