export let platform: string;
export let steps: ({
    kind: string;
    text: string;
    label: string;
    optional: boolean;
    skipIfSelector: string;
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
    field?: undefined;
} | {
    kind: string;
    selector: string;
    field: string;
    text?: undefined;
    label?: undefined;
    optional?: undefined;
    skipIfSelector?: undefined;
    timeoutMs?: undefined;
} | {
    kind: string;
    selector: string;
    label: string;
    text?: undefined;
    optional?: undefined;
    skipIfSelector?: undefined;
    timeoutMs?: undefined;
    field?: undefined;
})[];
export namespace success {
    let urlExcludes: string[];
}
export namespace failure {
    let anySelector: string[];
}
