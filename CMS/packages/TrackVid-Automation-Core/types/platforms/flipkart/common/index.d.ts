export const getOtp: typeof import("./getOtp");
export const loginForm: {
    platform: string;
    steps: ({
        kind: string;
        text: string;
        label: string;
        optional: boolean;
        skipIfSelector: string;
        selector?: undefined;
        timeoutMs?: undefined;
        field?: undefined;
        ms?: undefined;
    } | {
        kind: string;
        selector: string;
        label: string;
        timeoutMs: number;
        text?: undefined;
        optional?: undefined;
        skipIfSelector?: undefined;
        field?: undefined;
        ms?: undefined;
    } | {
        kind: string;
        selector: string;
        field: string;
        text?: undefined;
        label?: undefined;
        optional?: undefined;
        skipIfSelector?: undefined;
        timeoutMs?: undefined;
        ms?: undefined;
    } | {
        kind: string;
        ms: number;
        text?: undefined;
        label?: undefined;
        optional?: undefined;
        skipIfSelector?: undefined;
        selector?: undefined;
        timeoutMs?: undefined;
        field?: undefined;
    } | {
        kind: string;
        selector: string;
        label: string;
        text?: undefined;
        optional?: undefined;
        skipIfSelector?: undefined;
        timeoutMs?: undefined;
        field?: undefined;
        ms?: undefined;
    })[];
    success: {
        urlExcludes: string[];
    };
};
export const sessionExtras: {
    platform: string;
    required: string[];
    fromJar: (jar: Array<{
        name: string;
        value: string;
    }>) => {
        csrfToken?: string;
        error?: string;
    };
    CSRF_COOKIE_NAME: string;
    CSRF_PATTERN: RegExp;
};
export const sessionStore: typeof import("./sessionStore");
