export const loginErrors: typeof import("./loginErrors");
export const loginForm: {
    platform: string;
    frameSelector: string;
    steps: ({
        kind: string;
        selector: string;
        label: string;
        timeoutMs: number;
        field?: undefined;
        ms?: undefined;
    } | {
        kind: string;
        selector: string;
        field: string;
        label?: undefined;
        timeoutMs?: undefined;
        ms?: undefined;
    } | {
        kind: string;
        selector: string;
        label: string;
        timeoutMs?: undefined;
        field?: undefined;
        ms?: undefined;
    } | {
        kind: string;
        ms: number;
        selector?: undefined;
        label?: undefined;
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
export const portal: typeof import("./portal");
export const sessionExtras: {
    platform: string;
    required: string[];
    fromJar: () => {
        portalId: string;
    };
};
export const sessionStore: typeof import("./sessionStore");
