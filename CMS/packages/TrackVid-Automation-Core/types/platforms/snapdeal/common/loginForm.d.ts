export let platform: string;
export let steps: ({
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
export namespace success {
    let anySelector: string[];
}
export namespace otp {
    let anySelector_1: string[];
    export { anySelector_1 as anySelector };
}
export namespace otpEntry {
    let input: string;
    let submit: string;
}
