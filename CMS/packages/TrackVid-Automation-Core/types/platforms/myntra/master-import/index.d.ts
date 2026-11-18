export const apiBasedFlow: {
    readonly apiReportFlow: {
        MYNTRA_STORE_ID: number;
        MYNTRA_LOGIN_CIDX: string;
        REPORT_IDS: {
            Seller_Orders_Report: number;
            Seller_Returns_Report: number;
            Seller_Listings_Report: number;
            Seller_Inventory_Report: number;
        };
        MDIRECT_REPORT_IDS: {};
        IMPORT_TYPE_API_CONFIG: {
            returnOrderData: {
                reportId: number;
                portalReportName: string;
                trackvidReportType: string;
                lookbackDaysCap: number;
            };
            orderData: {
                reportId: number;
                portalReportName: string;
                trackvidReportType: any;
                lookbackDaysCap: number;
            };
            listingsData: {
                reportId: number;
                portalReportName: string;
                trackvidReportType: any;
                lookbackDaysCap: number;
            };
            inventoryData: {
                reportId: number;
                portalReportName: string;
                trackvidReportType: any;
                lookbackDaysCap: number;
            };
        };
        getImportTypeApiConfig: (importType: any) => any;
        computeDateRange: (scenario: any, lastSyncDate: any, lookbackDaysCap?: number) => {
            from: string;
            to: string;
        };
        loginMyntra: (email: any, password: any, { forceFresh }?: {
            forceFresh?: boolean;
        }) => Promise<any>;
        getPartnerBoot: (jar: any) => Promise<{
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
        scheduleReport: (jar: any, { reportId, storeId, partnerType, from, to }: {
            reportId: any;
            storeId: any;
            partnerType: any;
            from: any;
            to: any;
        }) => Promise<{
            jobId: any;
            status: any;
            reportName: any;
        }>;
        searchJobs: (jar: any, { pageSize, start }?: {
            pageSize?: number;
            start?: number;
        }) => Promise<any>;
        pollJob: (jar: any, jobId: any, { timeoutMs, pollMs, pageSize, maxPages }?: {
            timeoutMs?: number;
            pollMs?: number;
            pageSize?: number;
            maxPages?: number;
        }) => Promise<{
            successFile: any;
            row: any;
        }>;
        downloadReport: (jar: any, successFileUrl: any) => Promise<{
            buffer: Buffer<any>;
            contentType: any;
        }>;
        _cookieHeader: (jar: any) => string;
        _parseSetCookie: (headers: any) => {
            name: string;
            value: string;
        }[];
    };
    readonly common: typeof import("./api-based-flow/common");
    readonly trackvidFunctions: typeof import("./api-based-flow/trackvidFunctions");
};
export const common: {
    readonly utils: typeof import("./common/utils");
};
export const scriptBasedFlow: {
    readonly common: typeof import("./script-based-flow/common");
    readonly requestReportFlow: typeof import("./script-based-flow/requestReportFlow");
};
