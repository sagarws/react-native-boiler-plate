export const browserIdentity: typeof import("./browserIdentity");
export const chromeBinary: typeof import("./chromeBinary");
export const headlessLogin: typeof import("./headlessLogin");
export const httpLog: typeof import("./httpLog");
export const loginErrors: typeof import("./loginErrors");
export const loginForm: {
    platform: string;
    steps: ({
        kind: string;
        ms: number;
        text?: undefined;
        label?: undefined;
        optional?: undefined;
        skipIfSelector?: undefined;
        match?: undefined;
        selector?: undefined;
        timeoutMs?: undefined;
        field?: undefined;
    } | {
        kind: string;
        text: string;
        label: string;
        optional: boolean;
        skipIfSelector: string;
        ms?: undefined;
        match?: undefined;
        selector?: undefined;
        timeoutMs?: undefined;
        field?: undefined;
    } | {
        kind: string;
        text: string;
        match: string;
        label: string;
        optional: boolean;
        skipIfSelector: string;
        ms?: undefined;
        selector?: undefined;
        timeoutMs?: undefined;
        field?: undefined;
    } | {
        kind: string;
        selector: string;
        label: string;
        timeoutMs: number;
        ms?: undefined;
        text?: undefined;
        optional?: undefined;
        skipIfSelector?: undefined;
        match?: undefined;
        field?: undefined;
    } | {
        kind: string;
        selector: string;
        field: string;
        ms?: undefined;
        text?: undefined;
        label?: undefined;
        optional?: undefined;
        skipIfSelector?: undefined;
        match?: undefined;
        timeoutMs?: undefined;
    } | {
        kind: string;
        text: string;
        ms?: undefined;
        label?: undefined;
        optional?: undefined;
        skipIfSelector?: undefined;
        match?: undefined;
        selector?: undefined;
        timeoutMs?: undefined;
        field?: undefined;
    })[];
    success: {
        urlExcludes: string[];
    };
};
export const operatorLogin: typeof import("./operatorLogin");
export const osClickElement: typeof import("./osClickElement");
export const proxyAccounts: typeof import("./proxyAccounts");
export const proxyConfig: typeof import("./proxyConfig");
export const sessionExtras: {
    platform: string;
    required: any[];
    visitAfterLogin: string[];
    requiredCookies: string[];
};
export const sessionStore: typeof import("./sessionStore");
