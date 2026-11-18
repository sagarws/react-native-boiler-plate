export let platform: string;
export let steps: ({
    kind: string;
    selector: string;
    label: string;
    optional: boolean;
    skipIfSelector: string;
    text?: undefined;
    match?: undefined;
    timeoutMs?: undefined;
    field?: undefined;
    ms?: undefined;
} | {
    kind: string;
    text: string;
    match: string;
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
    optional?: undefined;
    skipIfSelector?: undefined;
    text?: undefined;
    match?: undefined;
    field?: undefined;
    ms?: undefined;
} | {
    kind: string;
    selector: string;
    field: string;
    label?: undefined;
    optional?: undefined;
    skipIfSelector?: undefined;
    text?: undefined;
    match?: undefined;
    timeoutMs?: undefined;
    ms?: undefined;
} | {
    kind: string;
    ms: number;
    selector?: undefined;
    label?: undefined;
    optional?: undefined;
    skipIfSelector?: undefined;
    text?: undefined;
    match?: undefined;
    timeoutMs?: undefined;
    field?: undefined;
} | {
    kind: string;
    selector: string;
    label: string;
    optional?: undefined;
    skipIfSelector?: undefined;
    text?: undefined;
    match?: undefined;
    timeoutMs?: undefined;
    field?: undefined;
    ms?: undefined;
})[];
export namespace success {
    let urlIncludes: string[];
}
export namespace failure {
    let anySelector: string[];
}
export namespace otp {
    let anySelector_1: string[];
    export { anySelector_1 as anySelector };
    let urlIncludes_1: string[];
    export { urlIncludes_1 as urlIncludes };
}
export namespace otpEntry {
    let input: string;
    let submit: string;
}
export let interstitials: {
    whenText: string;
    clickText: string;
}[];
