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
    };
    readonly common: {
        readonly utils: typeof import("./claim-management/common/utils");
    };
    readonly scriptBasedFlow: {
        readonly common: typeof import("./claim-management/script-based-flow/common");
    };
};
export const common: {
    readonly getOtp: typeof import("./common/getOtp");
    readonly loginErrors: typeof import("./common/loginErrors");
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
    readonly sessionStore: typeof import("./common/sessionStore");
};
export const masterImport: {
    readonly apiBasedFlow: {
        readonly apiReportFlow: typeof import("./master-import/api-based-flow/apiReportFlow");
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
