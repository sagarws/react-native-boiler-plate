export let platform: string;
export let steps: ({
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
export namespace success {
    let urlExcludes: string[];
}
