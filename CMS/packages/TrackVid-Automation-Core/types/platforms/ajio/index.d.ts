export const accountMapping: {
    readonly apiBasedFlow: {
        readonly probeAwb: typeof import("./account-mapping/api-based-flow/probeAwb");
    };
};
export const claimManagement: {
    readonly apiBasedFlow: {
        readonly bulkSpfBuckets: typeof import("./claim-management/api-based-flow/bulkSpfBuckets");
        readonly bulkSpfExcel: typeof import("./claim-management/api-based-flow/bulkSpfExcel");
        readonly bulkSpfRunner: typeof import("./claim-management/api-based-flow/bulkSpfRunner");
        readonly bulkSpfTemplates: typeof import("./claim-management/api-based-flow/bulkSpfTemplates");
        readonly common: typeof import("./claim-management/api-based-flow/common");
        readonly returnArticles: typeof import("./claim-management/api-based-flow/returnArticles");
        readonly returnDeliveredClaimApiFlow: typeof import("./claim-management/api-based-flow/returnDeliveredClaimApiFlow");
        readonly updatedClaimApiFlow: typeof import("./claim-management/api-based-flow/updatedClaimApiFlow");
    };
    readonly common: typeof import("./claim-management/common");
    readonly scriptBasedFlow: {
        readonly common: typeof import("./claim-management/script-based-flow/common");
    };
};
export const common: {
    readonly getOtp: typeof import("./common/getOtp");
    readonly login: typeof import("./common/login");
    readonly loginErrors: typeof import("./common/loginErrors");
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
    readonly loginPage: typeof import("./common/loginPage");
    readonly mfa: typeof import("./common/mfa");
    readonly pobSync: typeof import("./common/pobSync");
    readonly renewSession: typeof import("./common/renewSession");
    readonly salesChannel: typeof import("./common/salesChannel");
    readonly sessionExtras: {
        platform: string;
        required: string[];
        pageScript: string;
        USER_ID_EXPRESSION: "(function () {\n  var GUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;\n  try {\n    var direct = localStorage.getItem(\"activeSellerProfileId\");\n    if (direct && GUID.test(direct)) return direct.match(GUID)[0];\n    var blobs = [];\n    for (var i = 0; i < localStorage.length; i++) blobs.push(localStorage.getItem(localStorage.key(i)));\n    for (var j = 0; j < sessionStorage.length; j++) blobs.push(sessionStorage.getItem(sessionStorage.key(j)));\n    for (var k = 0; k < blobs.length; k++) {\n      var m = (blobs[k] || \"\").match(GUID);\n      if (m) return m[0];\n    }\n  } catch (e) { /* storage can be blocked mid-navigation */ }\n  return null;\n})()";
        pobPageExpression: typeof import("./common/sessionExtras").pobPageExpression;
        POB_PAGE_SIZE: 100;
    };
    readonly sessionStore: typeof import("./common/sessionStore");
    readonly unverifyCredential: typeof import("./common/unverifyCredential");
};
export const masterImport: {
    readonly apiBasedFlow: {
        readonly apiReportFlow: typeof import("./master-import/api-based-flow/apiReportFlow");
        readonly common: typeof import("./master-import/api-based-flow/common");
        readonly reportView: typeof import("./master-import/api-based-flow/reportView");
        readonly trackvidFunctions: typeof import("./master-import/api-based-flow/trackvidFunctions");
    };
    readonly common: {
        readonly reportPage: typeof import("./master-import/common/reportPage");
    };
    readonly scriptBasedFlow: {
        readonly common: typeof import("./master-import/script-based-flow/common");
        readonly downloadReportFlow: typeof import("./master-import/script-based-flow/downloadReportFlow");
    };
};
export const ticketDownload: {
    readonly apiBasedFlow: {
        readonly common: typeof import("./ticket-download/api-based-flow/common");
        readonly ticketApiFlow: typeof import("./ticket-download/api-based-flow/ticketApiFlow");
        readonly trackvidFunctions: typeof import("./ticket-download/api-based-flow/trackvidFunctions");
    };
    readonly common: typeof import("./ticket-download/common");
    readonly scriptBasedFlow: {
        readonly common: typeof import("./ticket-download/script-based-flow/common");
    };
};
