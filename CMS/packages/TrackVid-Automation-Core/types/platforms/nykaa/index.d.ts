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
        readonly fileClaim: typeof import("./claim-management/script-based-flow/fileClaim");
    };
};
export const common: {
    readonly loginErrors: typeof import("./common/loginErrors");
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
    readonly portal: typeof import("./common/portal");
    readonly sessionExtras: {
        platform: string;
        required: string[];
        fromJar: () => {
            portalId: string;
        };
    };
    readonly sessionStore: typeof import("./common/sessionStore");
};
