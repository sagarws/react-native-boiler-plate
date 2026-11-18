export const apiBasedFlow: {
    readonly bulkSpfBuckets: typeof import("./api-based-flow/bulkSpfBuckets");
    readonly bulkSpfExcel: typeof import("./api-based-flow/bulkSpfExcel");
    readonly bulkSpfRunner: typeof import("./api-based-flow/bulkSpfRunner");
    readonly bulkSpfTemplates: typeof import("./api-based-flow/bulkSpfTemplates");
    readonly common: typeof import("./api-based-flow/common");
    readonly returnArticles: typeof import("./api-based-flow/returnArticles");
    readonly returnDeliveredClaimApiFlow: typeof import("./api-based-flow/returnDeliveredClaimApiFlow");
    readonly updatedClaimApiFlow: typeof import("./api-based-flow/updatedClaimApiFlow");
};
export const common: typeof import("./common");
export const scriptBasedFlow: {
    readonly common: typeof import("./script-based-flow/common");
};
