export const common: {
    readonly accountMapping: typeof import("./common/accountMapping");
    readonly apiError: typeof import("./common/apiError");
    readonly apiResponseLogger: typeof import("./common/apiResponseLogger");
    readonly attachmentCompress: typeof import("./common/attachmentCompress");
    readonly automationRouting: typeof import("./common/automationRouting");
    readonly awbGlobleSearch: typeof import("./common/awbGlobleSearch");
    readonly browserRuntime: typeof import("./common/browserRuntime");
    readonly claimAccount: typeof import("./common/claimAccount");
    readonly claimContext: typeof import("./common/claimContext");
    readonly claimErrors: typeof import("./common/claimErrors");
    readonly claimFailureStore: typeof import("./common/claimFailureStore");
    readonly claimStatuses: typeof import("./common/claimStatuses");
    readonly claimSteps: typeof import("./common/claimSteps");
    readonly claimSubmitGuard: typeof import("./common/claimSubmitGuard");
    readonly constants: typeof import("./common/constants");
    readonly cookieHarvest: typeof import("./common/cookieHarvest");
    readonly credentialErrors: typeof import("./common/credentialErrors");
    readonly db: typeof import("./common/db");
    readonly errorHandler: typeof import("./common/errorHandler");
    readonly filterUnverifiedCredentials: typeof import("./common/filterUnverifiedCredentials");
    readonly gmailReader: typeof import("./common/gmailReader");
    readonly headless: typeof import("./common/headless");
    readonly humanPace: typeof import("./common/humanPace");
    readonly loadEnv: typeof import("./common/loadEnv");
    readonly logger: import("pino").Logger<never, boolean>;
    readonly loginForms: typeof import("./common/loginForms");
    readonly markCredentialsUnverified: typeof import("./common/markCredentialsUnverified");
    readonly mattermostNotifier: typeof import("./common/mattermostNotifier");
    readonly networkRoute: typeof import("./common/networkRoute");
    readonly openBrowsers: typeof import("./common/openBrowsers");
    readonly operatorSignIn: typeof import("./common/operatorSignIn");
    readonly osInput: typeof import("./common/osInput");
    readonly otpModal: typeof import("./common/otpModal");
    readonly otpTiming: typeof import("./common/otpTiming");
    readonly pageEval: typeof import("./common/pageEval");
    readonly platforms: typeof import("./common/platforms");
    readonly probeSession: typeof import("./common/probeSession");
    readonly processLog: typeof import("./common/processLog");
    readonly redactingLogger: import("pino").Logger<never, boolean>;
    readonly refillConfig: typeof import("./common/refillConfig");
    readonly renewSession: typeof import("./common/renewSession");
    readonly reportWorkbook: typeof import("./common/reportWorkbook");
    readonly resourceSaver: {
        isEnabled: () => boolean;
        saveClaimResource: ({ srcPath, companyId, companyName, awbNumber, filename }?: {}) => Promise<string>;
        saveReportResource: ({ srcPath, companyId, companyName, direction, filename }?: {}) => Promise<string>;
        resolveCompanyLabel: ({ companyId, companyName }?: {}) => Promise<any>;
        _internals: {
            sanitizePathSegment: (value: any, fallback?: string) => string;
            sanitizeFilename: (value: any, fallback?: string) => string;
            todayLocalDate: () => string;
            ROOT_DIR: string;
        };
    };
    readonly sessionExtras: typeof import("./common/sessionExtras");
    readonly sessionHelpers: typeof import("./common/sessionHelpers");
    readonly sessionIdentity: typeof import("./common/sessionIdentity");
    readonly sessionPageProbe: typeof import("./common/sessionPageProbe");
    readonly sessionPersistence: typeof import("./common/sessionPersistence");
    readonly text: typeof import("./common/text");
    readonly trackvidQueries: typeof import("./common/trackvidQueries");
    readonly uploadLimits: typeof import("./common/uploadLimits");
    readonly videoCompress: typeof import("./common/videoCompress");
};
export const platforms: {
    readonly ajio: {
        readonly accountMapping: {
            readonly apiBasedFlow: {
                readonly probeAwb: typeof import("./platforms/ajio/account-mapping/api-based-flow/probeAwb");
            };
        };
        readonly claimManagement: {
            readonly apiBasedFlow: {
                readonly bulkSpfBuckets: typeof import("./platforms/ajio/claim-management/api-based-flow/bulkSpfBuckets");
                readonly bulkSpfExcel: typeof import("./platforms/ajio/claim-management/api-based-flow/bulkSpfExcel");
                readonly bulkSpfRunner: typeof import("./platforms/ajio/claim-management/api-based-flow/bulkSpfRunner");
                readonly bulkSpfTemplates: typeof import("./platforms/ajio/claim-management/api-based-flow/bulkSpfTemplates");
                readonly common: typeof import("./platforms/ajio/claim-management/api-based-flow/common");
                readonly returnArticles: typeof import("./platforms/ajio/claim-management/api-based-flow/returnArticles");
                readonly returnDeliveredClaimApiFlow: typeof import("./platforms/ajio/claim-management/api-based-flow/returnDeliveredClaimApiFlow");
                readonly updatedClaimApiFlow: typeof import("./platforms/ajio/claim-management/api-based-flow/updatedClaimApiFlow");
            };
            readonly common: typeof import("./platforms/ajio/claim-management/common");
            readonly scriptBasedFlow: {
                readonly common: typeof import("./platforms/ajio/claim-management/script-based-flow/common");
            };
        };
        readonly common: {
            readonly getOtp: typeof import("./platforms/ajio/common/getOtp");
            readonly login: typeof import("./platforms/ajio/common/login");
            readonly loginErrors: typeof import("./platforms/ajio/common/loginErrors");
            readonly loginForm: {
                platform: string;
                steps: ({
                    kind: string;
                    selector: string;
                    label: string;
                    optional: boolean;
                    skipIfSelector: string;
                    text?: undefined;
                    match?: undefined;
                    timeoutMs?: undefined;
                    field?: undefined;
                    ms?: undefined;
                } | {
                    kind: string;
                    text: string;
                    match: string;
                    label: string;
                    optional: boolean;
                    skipIfSelector: string;
                    selector?: undefined;
                    timeoutMs?: undefined;
                    field?: undefined;
                    ms?: undefined;
                } | {
                    kind: string;
                    selector: string;
                    label: string;
                    timeoutMs: number;
                    optional?: undefined;
                    skipIfSelector?: undefined;
                    text?: undefined;
                    match?: undefined;
                    field?: undefined;
                    ms?: undefined;
                } | {
                    kind: string;
                    selector: string;
                    field: string;
                    label?: undefined;
                    optional?: undefined;
                    skipIfSelector?: undefined;
                    text?: undefined;
                    match?: undefined;
                    timeoutMs?: undefined;
                    ms?: undefined;
                } | {
                    kind: string;
                    ms: number;
                    selector?: undefined;
                    label?: undefined;
                    optional?: undefined;
                    skipIfSelector?: undefined;
                    text?: undefined;
                    match?: undefined;
                    timeoutMs?: undefined;
                    field?: undefined;
                } | {
                    kind: string;
                    selector: string;
                    label: string;
                    optional?: undefined;
                    skipIfSelector?: undefined;
                    text?: undefined;
                    match?: undefined;
                    timeoutMs?: undefined;
                    field?: undefined;
                    ms?: undefined;
                })[];
                success: {
                    urlIncludes: string[];
                };
                failure: {
                    anySelector: string[];
                };
                otp: {
                    anySelector: string[];
                    urlIncludes: string[];
                };
                otpEntry: {
                    input: string;
                    submit: string;
                };
                interstitials: {
                    whenText: string;
                    clickText: string;
                }[];
            };
            readonly loginPage: typeof import("./platforms/ajio/common/loginPage");
            readonly mfa: typeof import("./platforms/ajio/common/mfa");
            readonly pobSync: typeof import("./platforms/ajio/common/pobSync");
            readonly renewSession: typeof import("./platforms/ajio/common/renewSession");
            readonly salesChannel: typeof import("./platforms/ajio/common/salesChannel");
            readonly sessionExtras: {
                platform: string;
                required: string[];
                pageScript: string;
                USER_ID_EXPRESSION: "(function () {\n  var GUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;\n  try {\n    var direct = localStorage.getItem(\"activeSellerProfileId\");\n    if (direct && GUID.test(direct)) return direct.match(GUID)[0];\n    var blobs = [];\n    for (var i = 0; i < localStorage.length; i++) blobs.push(localStorage.getItem(localStorage.key(i)));\n    for (var j = 0; j < sessionStorage.length; j++) blobs.push(sessionStorage.getItem(sessionStorage.key(j)));\n    for (var k = 0; k < blobs.length; k++) {\n      var m = (blobs[k] || \"\").match(GUID);\n      if (m) return m[0];\n    }\n  } catch (e) { /* storage can be blocked mid-navigation */ }\n  return null;\n})()";
                pobPageExpression: typeof import("./platforms/ajio/common/sessionExtras").pobPageExpression;
                POB_PAGE_SIZE: 100;
            };
            readonly sessionStore: typeof import("./platforms/ajio/common/sessionStore");
            readonly unverifyCredential: typeof import("./platforms/ajio/common/unverifyCredential");
        };
        readonly masterImport: {
            readonly apiBasedFlow: {
                readonly apiReportFlow: typeof import("./platforms/ajio/master-import/api-based-flow/apiReportFlow");
                readonly common: typeof import("./platforms/ajio/master-import/api-based-flow/common");
                readonly reportView: typeof import("./platforms/ajio/master-import/api-based-flow/reportView");
                readonly trackvidFunctions: typeof import("./platforms/ajio/master-import/api-based-flow/trackvidFunctions");
            };
            readonly common: {
                readonly reportPage: typeof import("./platforms/ajio/master-import/common/reportPage");
            };
            readonly scriptBasedFlow: {
                readonly common: typeof import("./platforms/ajio/master-import/script-based-flow/common");
                readonly downloadReportFlow: typeof import("./platforms/ajio/master-import/script-based-flow/downloadReportFlow");
            };
        };
        readonly ticketDownload: {
            readonly apiBasedFlow: {
                readonly common: typeof import("./platforms/ajio/ticket-download/api-based-flow/common");
                readonly ticketApiFlow: typeof import("./platforms/ajio/ticket-download/api-based-flow/ticketApiFlow");
                readonly trackvidFunctions: typeof import("./platforms/ajio/ticket-download/api-based-flow/trackvidFunctions");
            };
            readonly common: typeof import("./platforms/ajio/ticket-download/common");
            readonly scriptBasedFlow: {
                readonly common: typeof import("./platforms/ajio/ticket-download/script-based-flow/common");
            };
        };
    };
    readonly delhivery: {
        readonly accountMapping: {
            readonly apiBasedFlow: {
                readonly probeAwb: typeof import("./platforms/delhivery/account-mapping/api-based-flow/probeAwb");
            };
        };
        readonly claimManagement: {
            readonly apiBasedFlow: {
                readonly claimApiFlow: typeof import("./platforms/delhivery/claim-management/api-based-flow/claimApiFlow");
                readonly common: typeof import("./platforms/delhivery/claim-management/api-based-flow/common");
                readonly fileClaim: typeof import("./platforms/delhivery/claim-management/api-based-flow/fileClaim");
            };
            readonly common: {
                readonly claimFailure: typeof import("./platforms/delhivery/claim-management/common/claimFailure");
                readonly utils: typeof import("./platforms/delhivery/claim-management/common/utils");
            };
            readonly scriptBasedFlow: {
                readonly common: typeof import("./platforms/delhivery/claim-management/script-based-flow/common");
                readonly fileClaim: typeof import("./platforms/delhivery/claim-management/script-based-flow/fileClaim");
            };
        };
        readonly common: {
            readonly domestics: typeof import("./platforms/delhivery/common/domestics");
            readonly hqClient: typeof import("./platforms/delhivery/common/hqClient");
            readonly loginErrors: typeof import("./platforms/delhivery/common/loginErrors");
            readonly loginForm: {
                platform: string;
                steps: ({
                    kind: string;
                    ms: number;
                    selector?: undefined;
                    label?: undefined;
                    timeoutMs?: undefined;
                    field?: undefined;
                    text?: undefined;
                    visibleOnly?: undefined;
                } | {
                    kind: string;
                    selector: string;
                    label: string;
                    timeoutMs: number;
                    ms?: undefined;
                    field?: undefined;
                    text?: undefined;
                    visibleOnly?: undefined;
                } | {
                    kind: string;
                    selector: string;
                    field: string;
                    ms?: undefined;
                    label?: undefined;
                    timeoutMs?: undefined;
                    text?: undefined;
                    visibleOnly?: undefined;
                } | {
                    kind: string;
                    text: string;
                    label: string;
                    ms?: undefined;
                    selector?: undefined;
                    timeoutMs?: undefined;
                    field?: undefined;
                    visibleOnly?: undefined;
                } | {
                    kind: string;
                    selector: string;
                    field: string;
                    visibleOnly: boolean;
                    ms?: undefined;
                    label?: undefined;
                    timeoutMs?: undefined;
                    text?: undefined;
                } | {
                    kind: string;
                    text: string;
                    ms?: undefined;
                    selector?: undefined;
                    label?: undefined;
                    timeoutMs?: undefined;
                    field?: undefined;
                    visibleOnly?: undefined;
                })[];
                success: {
                    urlExcludes: string[];
                };
            };
            readonly sessionStore: typeof import("./platforms/delhivery/common/sessionStore");
        };
    };
    readonly flipkart: {
        readonly accountMapping: {
            readonly apiBasedFlow: {
                readonly probeAwb: typeof import("./platforms/flipkart/account-mapping/api-based-flow/probeAwb");
            };
        };
        readonly claimManagement: {
            readonly apiBasedFlow: {
                readonly claimApiFlow: typeof import("./platforms/flipkart/claim-management/api-based-flow/claimApiFlow");
                readonly common: typeof import("./platforms/flipkart/claim-management/api-based-flow/common");
                readonly fileClaim: typeof import("./platforms/flipkart/claim-management/api-based-flow/fileClaim");
                readonly flipkartApiTypes: typeof import("./platforms/flipkart/claim-management/api-based-flow/flipkartApiTypes");
            };
            readonly common: {
                readonly attachments: typeof import("./platforms/flipkart/claim-management/common/attachments");
                readonly utils: typeof import("./platforms/flipkart/claim-management/common/utils");
            };
            readonly scriptBasedFlow: {
                readonly common: typeof import("./platforms/flipkart/claim-management/script-based-flow/common");
                readonly fileClaim: typeof import("./platforms/flipkart/claim-management/script-based-flow/fileClaim");
                readonly signedInDriver: typeof import("./platforms/flipkart/claim-management/script-based-flow/signedInDriver");
            };
        };
        readonly common: {
            readonly getOtp: typeof import("./platforms/flipkart/common/getOtp");
            readonly loginForm: {
                platform: string;
                steps: ({
                    kind: string;
                    text: string;
                    label: string;
                    optional: boolean;
                    skipIfSelector: string;
                    selector?: undefined;
                    timeoutMs?: undefined;
                    field?: undefined;
                    ms?: undefined;
                } | {
                    kind: string;
                    selector: string;
                    label: string;
                    timeoutMs: number;
                    text?: undefined;
                    optional?: undefined;
                    skipIfSelector?: undefined;
                    field?: undefined;
                    ms?: undefined;
                } | {
                    kind: string;
                    selector: string;
                    field: string;
                    text?: undefined;
                    label?: undefined;
                    optional?: undefined;
                    skipIfSelector?: undefined;
                    timeoutMs?: undefined;
                    ms?: undefined;
                } | {
                    kind: string;
                    ms: number;
                    text?: undefined;
                    label?: undefined;
                    optional?: undefined;
                    skipIfSelector?: undefined;
                    selector?: undefined;
                    timeoutMs?: undefined;
                    field?: undefined;
                } | {
                    kind: string;
                    selector: string;
                    label: string;
                    text?: undefined;
                    optional?: undefined;
                    skipIfSelector?: undefined;
                    timeoutMs?: undefined;
                    field?: undefined;
                    ms?: undefined;
                })[];
                success: {
                    urlExcludes: string[];
                };
            };
            readonly sessionExtras: {
                platform: string;
                required: string[];
                fromJar: (jar: Array<{
                    name: string;
                    value: string;
                }>) => {
                    csrfToken?: string;
                    error?: string;
                };
                CSRF_COOKIE_NAME: string;
                CSRF_PATTERN: RegExp;
            };
            readonly sessionStore: typeof import("./platforms/flipkart/common/sessionStore");
        };
        readonly masterImport: {
            readonly apiBasedFlow: {
                readonly apiReportFlow: typeof import("./platforms/flipkart/master-import/api-based-flow/apiReportFlow");
            };
        };
    };
    readonly meesho: {
        readonly accountMapping: {
            readonly apiBasedFlow: {
                readonly probeAwb: typeof import("./platforms/meesho/account-mapping/api-based-flow/probeAwb");
            };
            readonly scriptBasedFlow: {
                readonly probeAwb: typeof import("./platforms/meesho/account-mapping/script-based-flow/probeAwb");
            };
        };
        readonly claimManagement: {
            readonly apiBasedFlow: {
                readonly claimApiFlow: typeof import("./platforms/meesho/claim-management/api-based-flow/claimApiFlow");
                readonly common: typeof import("./platforms/meesho/claim-management/api-based-flow/common");
                readonly fileClaim: typeof import("./platforms/meesho/claim-management/api-based-flow/fileClaim");
                readonly meeshoApiTypes: typeof import("./platforms/meesho/claim-management/api-based-flow/meeshoApiTypes");
            };
            readonly common: {
                readonly utils: typeof import("./platforms/meesho/claim-management/common/utils");
            };
            readonly scriptBasedFlow: {
                readonly common: typeof import("./platforms/meesho/claim-management/script-based-flow/common");
                readonly fileClaim: typeof import("./platforms/meesho/claim-management/script-based-flow/fileClaim");
            };
        };
        readonly common: {
            readonly browserHelpers: typeof import("./platforms/meesho/common/browserHelpers");
            readonly browserId: typeof import("./platforms/meesho/common/browserId");
            readonly dismissPopup: typeof import("./platforms/meesho/common/dismissPopup");
            readonly identifiers: typeof import("./platforms/meesho/common/identifiers");
            readonly loginErrors: typeof import("./platforms/meesho/common/loginErrors");
            readonly loginForm: {
                platform: string;
                steps: ({
                    kind: string;
                    selector: string;
                    label: string;
                    optional: boolean;
                    skipIfSelector: string;
                    ms?: undefined;
                    timeoutMs?: undefined;
                    field?: undefined;
                } | {
                    kind: string;
                    ms: number;
                    selector?: undefined;
                    label?: undefined;
                    optional?: undefined;
                    skipIfSelector?: undefined;
                    timeoutMs?: undefined;
                    field?: undefined;
                } | {
                    kind: string;
                    selector: string;
                    label: string;
                    timeoutMs: number;
                    optional?: undefined;
                    skipIfSelector?: undefined;
                    ms?: undefined;
                    field?: undefined;
                } | {
                    kind: string;
                    selector: string;
                    field: string;
                    label?: undefined;
                    optional?: undefined;
                    skipIfSelector?: undefined;
                    ms?: undefined;
                    timeoutMs?: undefined;
                } | {
                    kind: string;
                    selector: string;
                    label: string;
                    optional?: undefined;
                    skipIfSelector?: undefined;
                    ms?: undefined;
                    timeoutMs?: undefined;
                    field?: undefined;
                })[];
                success: {
                    urlExcludes: string[];
                };
                failure: {
                    anySelector: string[];
                };
            };
            readonly returnsSearch: typeof import("./platforms/meesho/common/returnsSearch");
            readonly sessionExtras: {
                platform: string;
                required: string[];
                pageScript: string;
            };
            readonly sessionStore: typeof import("./platforms/meesho/common/sessionStore");
            readonly supplierIdentity: typeof import("./platforms/meesho/common/supplierIdentity");
        };
        readonly masterImport: {
            readonly apiBasedFlow: {
                readonly apiReportFlow: typeof import("./platforms/meesho/master-import/api-based-flow/apiReportFlow");
                readonly common: typeof import("./platforms/meesho/master-import/api-based-flow/common");
                readonly trackvidFunctions: typeof import("./platforms/meesho/master-import/api-based-flow/trackvidFunctions");
            };
            readonly common: {
                readonly meeshoLogin: typeof import("./platforms/meesho/master-import/common/meeshoLogin");
            };
            readonly scriptBasedFlow: {
                readonly common: typeof import("./platforms/meesho/master-import/script-based-flow/common");
                readonly forwardOrdersFlow: typeof import("./platforms/meesho/master-import/script-based-flow/forwardOrdersFlow");
                readonly puppeteerHelpers: typeof import("./platforms/meesho/master-import/script-based-flow/puppeteerHelpers");
                readonly returnOrdersFlow: typeof import("./platforms/meesho/master-import/script-based-flow/returnOrdersFlow");
            };
            readonly tempFiles: typeof import("./platforms/meesho/master-import/tempFiles");
        };
    };
    readonly myntra: {
        readonly accountMapping: {
            readonly apiBasedFlow: {
                readonly probeAwb: typeof import("./platforms/myntra/account-mapping/api-based-flow/probeAwb");
            };
        };
        readonly claimManagement: {
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
                readonly common: typeof import("./platforms/myntra/claim-management/api-based-flow/common");
                readonly fileClaim: typeof import("./platforms/myntra/claim-management/api-based-flow/fileClaim");
            };
            readonly common: {
                readonly utils: typeof import("./platforms/myntra/claim-management/common/utils");
            };
            readonly scriptBasedFlow: {
                readonly common: typeof import("./platforms/myntra/claim-management/script-based-flow/common");
            };
        };
        readonly common: {
            readonly browserIdentity: typeof import("./platforms/myntra/common/browserIdentity");
            readonly chromeBinary: typeof import("./platforms/myntra/common/chromeBinary");
            readonly headlessLogin: typeof import("./platforms/myntra/common/headlessLogin");
            readonly httpLog: typeof import("./platforms/myntra/common/httpLog");
            readonly loginErrors: typeof import("./platforms/myntra/common/loginErrors");
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
            readonly operatorLogin: typeof import("./platforms/myntra/common/operatorLogin");
            readonly osClickElement: typeof import("./platforms/myntra/common/osClickElement");
            readonly proxyAccounts: typeof import("./platforms/myntra/common/proxyAccounts");
            readonly proxyConfig: typeof import("./platforms/myntra/common/proxyConfig");
            readonly sessionExtras: {
                platform: string;
                required: any[];
                visitAfterLogin: string[];
                requiredCookies: string[];
            };
            readonly sessionStore: typeof import("./platforms/myntra/common/sessionStore");
        };
        readonly masterImport: {
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
                readonly common: typeof import("./platforms/myntra/master-import/api-based-flow/common");
                readonly trackvidFunctions: typeof import("./platforms/myntra/master-import/api-based-flow/trackvidFunctions");
            };
            readonly common: {
                readonly utils: typeof import("./platforms/myntra/master-import/common/utils");
            };
            readonly scriptBasedFlow: {
                readonly common: typeof import("./platforms/myntra/master-import/script-based-flow/common");
                readonly requestReportFlow: typeof import("./platforms/myntra/master-import/script-based-flow/requestReportFlow");
            };
        };
        readonly reClaim: {
            readonly apiBasedFlow: {
                readonly reClaim: typeof import("./platforms/myntra/re-claim/api-based-flow/reClaim");
            };
        };
    };
    readonly nykaa: {
        readonly claimManagement: {
            readonly apiBasedFlow: {
                readonly claimApiFlow: typeof import("./platforms/nykaa/claim-management/api-based-flow/claimApiFlow");
                readonly common: typeof import("./platforms/nykaa/claim-management/api-based-flow/common");
                readonly fileClaim: typeof import("./platforms/nykaa/claim-management/api-based-flow/fileClaim");
            };
            readonly common: {
                readonly utils: typeof import("./platforms/nykaa/claim-management/common/utils");
            };
            readonly scriptBasedFlow: {
                readonly common: typeof import("./platforms/nykaa/claim-management/script-based-flow/common");
                readonly fileClaim: typeof import("./platforms/nykaa/claim-management/script-based-flow/fileClaim");
            };
        };
        readonly common: {
            readonly loginErrors: typeof import("./platforms/nykaa/common/loginErrors");
            readonly loginForm: {
                platform: string;
                frameSelector: string;
                steps: ({
                    kind: string;
                    selector: string;
                    label: string;
                    timeoutMs: number;
                    field?: undefined;
                    ms?: undefined;
                } | {
                    kind: string;
                    selector: string;
                    field: string;
                    label?: undefined;
                    timeoutMs?: undefined;
                    ms?: undefined;
                } | {
                    kind: string;
                    selector: string;
                    label: string;
                    timeoutMs?: undefined;
                    field?: undefined;
                    ms?: undefined;
                } | {
                    kind: string;
                    ms: number;
                    selector?: undefined;
                    label?: undefined;
                    timeoutMs?: undefined;
                    field?: undefined;
                })[];
                success: {
                    urlExcludes: string[];
                };
                failure: {
                    anySelector: string[];
                };
            };
            readonly portal: typeof import("./platforms/nykaa/common/portal");
            readonly sessionExtras: {
                platform: string;
                required: string[];
                fromJar: () => {
                    portalId: string;
                };
            };
            readonly sessionStore: typeof import("./platforms/nykaa/common/sessionStore");
        };
    };
    readonly snapdeal: {
        readonly accountMapping: {
            readonly apiBasedFlow: {
                readonly probeAwb: typeof import("./platforms/snapdeal/account-mapping/api-based-flow/probeAwb");
            };
        };
        readonly claimManagement: {
            readonly apiBasedFlow: {
                readonly claimApiFlow: typeof import("./platforms/snapdeal/claim-management/api-based-flow/claimApiFlow");
                readonly common: typeof import("./platforms/snapdeal/claim-management/api-based-flow/common");
                readonly fileClaim: typeof import("./platforms/snapdeal/claim-management/api-based-flow/fileClaim");
            };
            readonly common: {
                readonly utils: typeof import("./platforms/snapdeal/claim-management/common/utils");
            };
            readonly scriptBasedFlow: {
                readonly common: typeof import("./platforms/snapdeal/claim-management/script-based-flow/common");
            };
        };
        readonly common: {
            readonly getOtp: typeof import("./platforms/snapdeal/common/getOtp");
            readonly loginErrors: typeof import("./platforms/snapdeal/common/loginErrors");
            readonly loginForm: {
                platform: string;
                steps: ({
                    kind: string;
                    text: string;
                    label: string;
                    optional: boolean;
                    skipIfSelector: string;
                    ms?: undefined;
                    selector?: undefined;
                    timeoutMs?: undefined;
                    field?: undefined;
                } | {
                    kind: string;
                    ms: number;
                    text?: undefined;
                    label?: undefined;
                    optional?: undefined;
                    skipIfSelector?: undefined;
                    selector?: undefined;
                    timeoutMs?: undefined;
                    field?: undefined;
                } | {
                    kind: string;
                    selector: string;
                    label: string;
                    timeoutMs: number;
                    text?: undefined;
                    optional?: undefined;
                    skipIfSelector?: undefined;
                    ms?: undefined;
                    field?: undefined;
                } | {
                    kind: string;
                    selector: string;
                    field: string;
                    text?: undefined;
                    label?: undefined;
                    optional?: undefined;
                    skipIfSelector?: undefined;
                    ms?: undefined;
                    timeoutMs?: undefined;
                } | {
                    kind: string;
                    text: string;
                    label?: undefined;
                    optional?: undefined;
                    skipIfSelector?: undefined;
                    ms?: undefined;
                    selector?: undefined;
                    timeoutMs?: undefined;
                    field?: undefined;
                })[];
                success: {
                    anySelector: string[];
                };
                otp: {
                    anySelector: string[];
                };
                otpEntry: {
                    input: string;
                    submit: string;
                };
            };
            readonly sessionStore: typeof import("./platforms/snapdeal/common/sessionStore");
        };
        readonly masterImport: {
            readonly apiBasedFlow: {
                readonly apiReportFlow: typeof import("./platforms/snapdeal/master-import/api-based-flow/apiReportFlow");
                readonly common: typeof import("./platforms/snapdeal/master-import/api-based-flow/common");
                readonly trackvidFunctions: typeof import("./platforms/snapdeal/master-import/api-based-flow/trackvidFunctions");
            };
            readonly common: {
                readonly utils: typeof import("./platforms/snapdeal/master-import/common/utils");
            };
            readonly scriptBasedFlow: {
                readonly common: typeof import("./platforms/snapdeal/master-import/script-based-flow/common");
                readonly requestReportFlow: typeof import("./platforms/snapdeal/master-import/script-based-flow/requestReportFlow");
            };
        };
    };
    readonly tatacliq: {
        readonly accountMapping: {
            readonly apiBasedFlow: {
                readonly probeAwb: typeof import("./platforms/tatacliq/account-mapping/api-based-flow/probeAwb");
            };
        };
        readonly claimManagement: {
            readonly apiBasedFlow: {
                readonly claimApiFlow: typeof import("./platforms/tatacliq/claim-management/api-based-flow/claimApiFlow");
                readonly fileClaim: typeof import("./platforms/tatacliq/claim-management/api-based-flow/fileClaim");
            };
            readonly common: {
                readonly qcReasons: typeof import("./platforms/tatacliq/claim-management/common/qcReasons");
            };
        };
        readonly common: {
            readonly getOtp: typeof import("./platforms/tatacliq/common/getOtp");
            readonly login: typeof import("./platforms/tatacliq/common/login");
            readonly renewSession: typeof import("./platforms/tatacliq/common/renewSession");
            readonly sessionStore: {
                SESSION_FIELD: string;
                COOKIE_DOMAINS: string[];
                isSessionCacheEnabled: () => boolean;
                harvestCookies: (page: any, { logger }?: {
                    logger?: Console;
                }) => Promise<{
                    name: string;
                    value: string;
                    domain: string;
                }[]>;
                hydrateCookies: (page: any, jar: any) => Promise<number>;
                saveSession: ({ credentialId, username, jar, slaves, ip, source }: {
                    credentialId: any;
                    username: any;
                    jar: any;
                    slaves?: any[];
                    ip?: any;
                    source?: string;
                }) => Promise<boolean>;
                loadSession: ({ credentialId, username }: {
                    credentialId: any;
                    username: any;
                }) => Promise<any>;
                clearSession: ({ credentialId, username }: {
                    credentialId: any;
                    username: any;
                }, reason?: string) => Promise<boolean>;
                probeSessionInPage: (page: any) => Promise<{
                    alive: boolean;
                    slaves: any[];
                }>;
                reuseSessionRecord: (page: any, record: any, { username }?: {}) => Promise<{
                    jar: any[];
                    slaves: any[];
                } | null>;
                tryReuseSession: (page: any, { credentialId, username }: {
                    credentialId: any;
                    username: any;
                }) => Promise<{
                    jar: any[];
                    slaves: any[];
                }>;
            };
            readonly slaveSync: typeof import("./platforms/tatacliq/common/slaveSync");
        };
    };
    readonly xbees: {
        readonly accountMapping: {
            readonly apiBasedFlow: {
                readonly probeAwb: typeof import("./platforms/xbees/account-mapping/api-based-flow/probeAwb");
            };
        };
        readonly claimManagement: {
            readonly apiBasedFlow: {
                readonly claimApiFlow: typeof import("./platforms/xbees/claim-management/api-based-flow/claimApiFlow");
                readonly common: typeof import("./platforms/xbees/claim-management/api-based-flow/common");
                readonly fileClaim: typeof import("./platforms/xbees/claim-management/api-based-flow/fileClaim");
            };
            readonly common: {
                readonly utils: typeof import("./platforms/xbees/claim-management/common/utils");
            };
            readonly scriptBasedFlow: {
                readonly common: typeof import("./platforms/xbees/claim-management/script-based-flow/common");
            };
        };
        readonly common: {
            readonly loginErrors: typeof import("./platforms/xbees/common/loginErrors");
            readonly loginForm: {
                platform: string;
                steps: ({
                    kind: string;
                    text: string;
                    label: string;
                    optional: boolean;
                    skipIfSelector: string;
                    selector?: undefined;
                    timeoutMs?: undefined;
                    field?: undefined;
                } | {
                    kind: string;
                    selector: string;
                    label: string;
                    timeoutMs: number;
                    text?: undefined;
                    optional?: undefined;
                    skipIfSelector?: undefined;
                    field?: undefined;
                } | {
                    kind: string;
                    selector: string;
                    field: string;
                    text?: undefined;
                    label?: undefined;
                    optional?: undefined;
                    skipIfSelector?: undefined;
                    timeoutMs?: undefined;
                } | {
                    kind: string;
                    selector: string;
                    label: string;
                    text?: undefined;
                    optional?: undefined;
                    skipIfSelector?: undefined;
                    timeoutMs?: undefined;
                    field?: undefined;
                })[];
                success: {
                    urlExcludes: string[];
                };
                failure: {
                    anySelector: string[];
                };
            };
            readonly sessionStore: typeof import("./platforms/xbees/common/sessionStore");
        };
    };
};
