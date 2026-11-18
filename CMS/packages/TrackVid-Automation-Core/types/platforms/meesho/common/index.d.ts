export const browserHelpers: typeof import("./browserHelpers");
export const browserId: typeof import("./browserId");
export const dismissPopup: typeof import("./dismissPopup");
export const identifiers: typeof import("./identifiers");
export const loginErrors: typeof import("./loginErrors");
export const loginForm: {
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
export const returnsSearch: typeof import("./returnsSearch");
export const sessionExtras: {
    platform: string;
    required: string[];
    pageScript: string;
};
export const sessionStore: typeof import("./sessionStore");
export const supplierIdentity: typeof import("./supplierIdentity");
