export const getOtp: typeof import("./getOtp");
export const loginErrors: typeof import("./loginErrors");
export const loginForm: {
    platform: string;
    steps: ({
        kind: string;
        text: string;
        label: string;
        optional: boolean;
        skipIfSelector: string;
        ms?: undefined;
        selector?: undefined;
        timeoutMs?: undefined;
        field?: undefined;
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
        timeoutMs: number;
        text?: undefined;
        optional?: undefined;
        skipIfSelector?: undefined;
        ms?: undefined;
        field?: undefined;
    } | {
        kind: string;
        selector: string;
        field: string;
        text?: undefined;
        label?: undefined;
        optional?: undefined;
        skipIfSelector?: undefined;
        ms?: undefined;
        timeoutMs?: undefined;
    } | {
        kind: string;
        text: string;
        label?: undefined;
        optional?: undefined;
        skipIfSelector?: undefined;
        ms?: undefined;
        selector?: undefined;
        timeoutMs?: undefined;
        field?: undefined;
    })[];
    success: {
        anySelector: string[];
    };
    otp: {
        anySelector: string[];
    };
    otpEntry: {
        input: string;
        submit: string;
    };
};
export const sessionStore: typeof import("./sessionStore");
