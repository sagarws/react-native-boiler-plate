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
    readonly loginErrors: typeof import("./common/loginErrors");
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
    readonly sessionStore: typeof import("./common/sessionStore");
};
