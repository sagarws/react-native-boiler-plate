export const apiBasedFlow: {
    readonly claimApiFlow: typeof import("./api-based-flow/claimApiFlow");
    readonly common: typeof import("./api-based-flow/common");
    readonly fileClaim: typeof import("./api-based-flow/fileClaim");
    readonly flipkartApiTypes: typeof import("./api-based-flow/flipkartApiTypes");
};
export const common: {
    readonly attachments: typeof import("./common/attachments");
    readonly utils: typeof import("./common/utils");
};
export const scriptBasedFlow: {
    readonly common: typeof import("./script-based-flow/common");
    readonly fileClaim: typeof import("./script-based-flow/fileClaim");
    readonly signedInDriver: typeof import("./script-based-flow/signedInDriver");
};
