export let platform: string;
export let frameSelector: string;
export let steps: ({
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
export namespace success {
    let urlExcludes: string[];
}
export namespace failure {
    let anySelector: string[];
}
