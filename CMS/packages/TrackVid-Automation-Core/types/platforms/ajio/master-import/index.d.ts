export const apiBasedFlow: {
    readonly apiReportFlow: typeof import("./api-based-flow/apiReportFlow");
    readonly common: typeof import("./api-based-flow/common");
    readonly reportView: typeof import("./api-based-flow/reportView");
    readonly trackvidFunctions: typeof import("./api-based-flow/trackvidFunctions");
};
export const common: {
    readonly reportPage: typeof import("./common/reportPage");
};
export const scriptBasedFlow: {
    readonly common: typeof import("./script-based-flow/common");
    readonly downloadReportFlow: typeof import("./script-based-flow/downloadReportFlow");
};
