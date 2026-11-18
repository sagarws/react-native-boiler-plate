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
        readonly claimFailure: typeof import("./claim-management/common/claimFailure");
        readonly utils: typeof import("./claim-management/common/utils");
    };
    readonly scriptBasedFlow: {
        readonly common: typeof import("./claim-management/script-based-flow/common");
        readonly fileClaim: typeof import("./claim-management/script-based-flow/fileClaim");
    };
};
export const common: {
    readonly domestics: typeof import("./common/domestics");
    readonly hqClient: typeof import("./common/hqClient");
    readonly loginErrors: typeof import("./common/loginErrors");
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
    readonly sessionStore: typeof import("./common/sessionStore");
};
