export const accountMapping: {
    readonly apiBasedFlow: {
        readonly probeAwb: typeof import("./account-mapping/api-based-flow/probeAwb");
    };
};
export const claimManagement: {
    readonly apiBasedFlow: {
        readonly claimApiFlow: typeof import("./claim-management/api-based-flow/claimApiFlow");
        readonly common: typeof import("./claim-management/api-based-flow/common");
        readonly fileClaim: typeof import("./claim-management/api-based-flow/fileClaim");
        readonly flipkartApiTypes: typeof import("./claim-management/api-based-flow/flipkartApiTypes");
    };
    readonly common: {
        readonly attachments: typeof import("./claim-management/common/attachments");
        readonly utils: typeof import("./claim-management/common/utils");
    };
    readonly scriptBasedFlow: {
        readonly common: typeof import("./claim-management/script-based-flow/common");
        readonly fileClaim: typeof import("./claim-management/script-based-flow/fileClaim");
        readonly signedInDriver: typeof import("./claim-management/script-based-flow/signedInDriver");
    };
};
export const common: {
    readonly getOtp: typeof import("./common/getOtp");
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
    readonly sessionStore: typeof import("./common/sessionStore");
};
export const masterImport: {
    readonly apiBasedFlow: {
        readonly apiReportFlow: typeof import("./master-import/api-based-flow/apiReportFlow");
    };
};
