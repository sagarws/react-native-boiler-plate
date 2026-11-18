export const apiBasedFlow: {
    readonly apiReportFlow: typeof import("./api-based-flow/apiReportFlow");
    readonly common: typeof import("./api-based-flow/common");
    readonly trackvidFunctions: typeof import("./api-based-flow/trackvidFunctions");
};
export const common: {
    readonly utils: typeof import("./common/utils");
};
export const scriptBasedFlow: {
    readonly common: typeof import("./script-based-flow/common");
    readonly requestReportFlow: typeof import("./script-based-flow/requestReportFlow");
};
