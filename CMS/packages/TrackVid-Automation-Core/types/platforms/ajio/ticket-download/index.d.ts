export const apiBasedFlow: {
    readonly common: typeof import("./api-based-flow/common");
    readonly ticketApiFlow: typeof import("./api-based-flow/ticketApiFlow");
    readonly trackvidFunctions: typeof import("./api-based-flow/trackvidFunctions");
};
export const common: typeof import("./common");
export const scriptBasedFlow: {
    readonly common: typeof import("./script-based-flow/common");
};
