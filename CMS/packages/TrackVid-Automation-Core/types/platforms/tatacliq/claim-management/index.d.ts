export const apiBasedFlow: {
    readonly claimApiFlow: typeof import("./api-based-flow/claimApiFlow");
    readonly fileClaim: typeof import("./api-based-flow/fileClaim");
};
export const common: {
    readonly qcReasons: typeof import("./common/qcReasons");
};
