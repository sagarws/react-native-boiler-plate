export let platform: string;
export let steps: ({
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
export namespace success {
    let urlExcludes: string[];
}
export namespace failure {
    let anySelector: string[];
}
