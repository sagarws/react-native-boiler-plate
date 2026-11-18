export const domestics: typeof import("./domestics");
export const hqClient: typeof import("./hqClient");
export const loginErrors: typeof import("./loginErrors");
export const loginForm: {
    platform: string;
    steps: ({
        kind: string;
        ms: number;
        selector?: undefined;
        label?: undefined;
        timeoutMs?: undefined;
        field?: undefined;
        text?: undefined;
        visibleOnly?: undefined;
    } | {
        kind: string;
        selector: string;
        label: string;
        timeoutMs: number;
        ms?: undefined;
        field?: undefined;
        text?: undefined;
        visibleOnly?: undefined;
    } | {
        kind: string;
        selector: string;
        field: string;
        ms?: undefined;
        label?: undefined;
        timeoutMs?: undefined;
        text?: undefined;
        visibleOnly?: undefined;
    } | {
        kind: string;
        text: string;
        label: string;
        ms?: undefined;
        selector?: undefined;
        timeoutMs?: undefined;
        field?: undefined;
        visibleOnly?: undefined;
    } | {
        kind: string;
        selector: string;
        field: string;
        visibleOnly: boolean;
        ms?: undefined;
        label?: undefined;
        timeoutMs?: undefined;
        text?: undefined;
    } | {
        kind: string;
        text: string;
        ms?: undefined;
        selector?: undefined;
        label?: undefined;
        timeoutMs?: undefined;
        field?: undefined;
        visibleOnly?: undefined;
    })[];
    success: {
        urlExcludes: string[];
    };
};
export const sessionStore: typeof import("./sessionStore");
