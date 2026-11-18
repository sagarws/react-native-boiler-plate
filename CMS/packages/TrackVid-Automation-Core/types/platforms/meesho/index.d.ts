export const accountMapping: {
    readonly apiBasedFlow: {
        readonly probeAwb: typeof import("./account-mapping/api-based-flow/probeAwb");
    };
    readonly scriptBasedFlow: {
        readonly probeAwb: typeof import("./account-mapping/script-based-flow/probeAwb");
    };
};
export const claimManagement: {
    readonly apiBasedFlow: {
        readonly claimApiFlow: typeof import("./claim-management/api-based-flow/claimApiFlow");
        readonly common: typeof import("./claim-management/api-based-flow/common");
        readonly fileClaim: typeof import("./claim-management/api-based-flow/fileClaim");
        readonly meeshoApiTypes: typeof import("./claim-management/api-based-flow/meeshoApiTypes");
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
    readonly browserHelpers: typeof import("./common/browserHelpers");
    readonly browserId: typeof import("./common/browserId");
    readonly dismissPopup: typeof import("./common/dismissPopup");
    readonly identifiers: typeof import("./common/identifiers");
    readonly loginErrors: typeof import("./common/loginErrors");
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
    readonly returnsSearch: typeof import("./common/returnsSearch");
    readonly sessionExtras: {
        platform: string;
        required: string[];
        pageScript: string;
    };
    readonly sessionStore: typeof import("./common/sessionStore");
    readonly supplierIdentity: typeof import("./common/supplierIdentity");
};
export const masterImport: {
    readonly apiBasedFlow: {
        readonly apiReportFlow: typeof import("./master-import/api-based-flow/apiReportFlow");
        readonly common: typeof import("./master-import/api-based-flow/common");
        readonly trackvidFunctions: typeof import("./master-import/api-based-flow/trackvidFunctions");
    };
    readonly common: {
        readonly meeshoLogin: typeof import("./master-import/common/meeshoLogin");
    };
    readonly scriptBasedFlow: {
        readonly common: typeof import("./master-import/script-based-flow/common");
        readonly forwardOrdersFlow: typeof import("./master-import/script-based-flow/forwardOrdersFlow");
        readonly puppeteerHelpers: typeof import("./master-import/script-based-flow/puppeteerHelpers");
        readonly returnOrdersFlow: typeof import("./master-import/script-based-flow/returnOrdersFlow");
    };
    readonly tempFiles: typeof import("./master-import/tempFiles");
};
