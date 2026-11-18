export const apiBasedFlow: {
    readonly claimApiFlow: typeof import("./api-based-flow/claimApiFlow");
    readonly common: typeof import("./api-based-flow/common");
    readonly fileClaim: typeof import("./api-based-flow/fileClaim");
    readonly meeshoApiTypes: typeof import("./api-based-flow/meeshoApiTypes");
};
export const common: {
    readonly utils: typeof import("./common/utils");
};
export const scriptBasedFlow: {
    readonly common: typeof import("./script-based-flow/common");
    readonly fileClaim: typeof import("./script-based-flow/fileClaim");
};
