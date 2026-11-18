export namespace IMPORT_TYPE_CONFIG {
    namespace returnOrderData {
        let fulfilmentMode: string;
        let reportOption: string;
        let reportVariable: string;
        let filterBy: string;
        const portalReportName: string;
        let trackvidReportType: string;
    }
}
export function getImportTypeSpec(importType: any): any;
export function runRequestReportFlow(page: any, config: any): Promise<{
    reportName: any;
    initiationText: any;
    requestedAt: Date;
    trackvidReportType: any;
}>;
