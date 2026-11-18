export const accountMapping: {
    readonly apiBasedFlow: {
        readonly probeAwb: typeof import("./account-mapping/api-based-flow/probeAwb");
    };
};
export const claimManagement: {
    readonly apiBasedFlow: {
        readonly claimApiFlow: {
            MYNTRA_TO_CMS_STATUS: {
                OPEN: string;
                IN_REVIEW: string;
                AWAITING_SELLER_RESPONSE: string;
                ACCEPT: string;
                AWAITING_AGENT_RESPONSE: string;
                REJECT: string;
                PAYMENT_COMPLETED: string;
            };
            mapMyntraStatus: (myntraStatus: any) => any;
            myntraCompensation: (row: {
                status?: string | null;
                compensationAmount?: number | null;
            } | null) => number | null;
            API_BASE: string;
            ISSUE_CATEGORIES: string[];
            TICKET_STATUSES: string[];
            mapIssueCategory: (value: any) => any;
            buildUpdateClaimPayload: ({ row, issueCategory, description, shippingLabelProofUrls, productProofUrls, videoProofUrls, disputedAmount, physicalReceivedSku, }: {
                row: any;
                issueCategory: any;
                description: any;
                shippingLabelProofUrls?: any[];
                productProofUrls?: any[];
                videoProofUrls?: any[];
                disputedAmount: any;
                physicalReceivedSku: any;
            }) => {
                orderId: any;
                returnId: any;
                trackingId: any;
                returnTrackingId: any;
                skuId: any;
                orderLineId: any;
                returnCreatedDate: any;
                rejectionReason: any;
                styleId: any;
                orderCreatedOn: any;
                orderStatus: any;
                orderCancelDate: any;
                warehouseId: any;
                orderPackedDate: any;
                orderShippedDate: any;
                orderDeliveredDate: any;
                isRefunded: any;
                orderCreatedBy: any;
                returnMode: any;
                returnReason: any;
                finalAmount: any;
                meta: any;
                isOCRVerified: boolean;
                issueCategory: any;
                status: string;
                description: any;
                shippingLabelProofUrl: any[];
                productProofUrl: any[];
                videoProofUrl: any[];
                replyComment: string;
                attachments: any[];
            };
            loginMyntraApi: (credentials: any, { forceFresh }?: {
                forceFresh?: boolean;
            }) => Promise<any>;
            fetchNewClaim: (jar: any, searchId: any) => Promise<{
                found: boolean;
                row: any;
                ticketId: string;
            }>;
            fetchClaimByTicketId: (jar: any, ticketId: any) => Promise<{
                found: boolean;
                status: string;
                originalStatus: string;
                validationReason: any;
                row: any;
            }>;
            getUploadToken: (jar: any, fileName: any) => Promise<{
                sasUrl: any;
                fileNameWithPath: any;
            }>;
            uploadProof: (jar: any, { filePath, orderId }: {
                filePath: any;
                orderId: any;
            }) => Promise<any>;
            updateClaim: (jar: any, payload: any) => Promise<{
                ticketId: string;
                row: any;
            }>;
            getTickets: (jar: any, { page, pageSize, statuses }?: {
                page?: number;
                pageSize?: number;
                statuses?: string[];
            }) => Promise<any>;
            findTicketIdByTrackingId: (jar: any, searchId: any, { pageSize, maxPages }?: {
                pageSize?: number;
                maxPages?: number;
            }) => Promise<string>;
            _cookieHeader: (jar: any) => string;
            _apiHeaders: (jar: any, extra: any) => any;
            _mimeForFile: (filePath: any) => any;
        };
        readonly common: typeof import("./claim-management/api-based-flow/common");
        readonly fileClaim: typeof import("./claim-management/api-based-flow/fileClaim");
    };
    readonly common: {
        readonly utils: typeof import("./claim-management/common/utils");
    };
    readonly scriptBasedFlow: {
        readonly common: typeof import("./claim-management/script-based-flow/common");
    };
};
export const common: {
    readonly browserIdentity: typeof import("./common/browserIdentity");
    readonly chromeBinary: typeof import("./common/chromeBinary");
    readonly headlessLogin: typeof import("./common/headlessLogin");
    readonly httpLog: typeof import("./common/httpLog");
    readonly loginErrors: typeof import("./common/loginErrors");
    readonly loginForm: {
        platform: string;
        steps: ({
            kind: string;
            ms: number;
            text?: undefined;
            label?: undefined;
            optional?: undefined;
            skipIfSelector?: undefined;
            match?: undefined;
            selector?: undefined;
            timeoutMs?: undefined;
            field?: undefined;
        } | {
            kind: string;
            text: string;
            label: string;
            optional: boolean;
            skipIfSelector: string;
            ms?: undefined;
            match?: undefined;
            selector?: undefined;
            timeoutMs?: undefined;
            field?: undefined;
        } | {
            kind: string;
            text: string;
            match: string;
            label: string;
            optional: boolean;
            skipIfSelector: string;
            ms?: undefined;
            selector?: undefined;
            timeoutMs?: undefined;
            field?: undefined;
        } | {
            kind: string;
            selector: string;
            label: string;
            timeoutMs: number;
            ms?: undefined;
            text?: undefined;
            optional?: undefined;
            skipIfSelector?: undefined;
            match?: undefined;
            field?: undefined;
        } | {
            kind: string;
            selector: string;
            field: string;
            ms?: undefined;
            text?: undefined;
            label?: undefined;
            optional?: undefined;
            skipIfSelector?: undefined;
            match?: undefined;
            timeoutMs?: undefined;
        } | {
            kind: string;
            text: string;
            ms?: undefined;
            label?: undefined;
            optional?: undefined;
            skipIfSelector?: undefined;
            match?: undefined;
            selector?: undefined;
            timeoutMs?: undefined;
            field?: undefined;
        })[];
        success: {
            urlExcludes: string[];
        };
    };
    readonly operatorLogin: typeof import("./common/operatorLogin");
    readonly osClickElement: typeof import("./common/osClickElement");
    readonly proxyAccounts: typeof import("./common/proxyAccounts");
    readonly proxyConfig: typeof import("./common/proxyConfig");
    readonly sessionExtras: {
        platform: string;
        required: any[];
        visitAfterLogin: string[];
        requiredCookies: string[];
    };
    readonly sessionStore: typeof import("./common/sessionStore");
};
export const masterImport: {
    readonly apiBasedFlow: {
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
        readonly common: typeof import("./master-import/api-based-flow/common");
        readonly trackvidFunctions: typeof import("./master-import/api-based-flow/trackvidFunctions");
    };
    readonly common: {
        readonly utils: typeof import("./master-import/common/utils");
    };
    readonly scriptBasedFlow: {
        readonly common: typeof import("./master-import/script-based-flow/common");
        readonly requestReportFlow: typeof import("./master-import/script-based-flow/requestReportFlow");
    };
};
export const reClaim: {
    readonly apiBasedFlow: {
        readonly reClaim: typeof import("./re-claim/api-based-flow/reClaim");
    };
};
