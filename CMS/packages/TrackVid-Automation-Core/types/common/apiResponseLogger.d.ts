/**
 * Print one line for a failed API response. Call it at the HTTP choke point, right
 * before throwing, for any status >= 400 (auth 401/403 included — those are the
 * ones worth seeing most).
 *
 * @param {object}  o
 * @param {string}  o.platform  "MEESHO" | "NYKAA" | …  (shown upper-cased)
 * @param {string} [o.step]     the call site, e.g. "Create ticket"
 * @param {string} [o.method]   HTTP verb
 * @param {string}  o.url       endpoint (query secrets are redacted)
 * @param {number}  o.status    HTTP status
 * @param {*}      [o.data]     response body (secret-looking keys are redacted)
 * @param {object} [o.logger]   per-AWB logger; falls back to console.error
 */
export function logApiFailure({ platform, step, method, url, status, data, logger }?: {
    platform: string;
    step?: string;
    method?: string;
    url: string;
    status: number;
    data?: any;
    logger?: object;
}): void;
/** The platform's own wording for the failure, or "" when it did not give one. */
export function extractApiMessage(data: any): string;
/** The id support asks for, when the platform returns one. */
export function extractCorrelationId(data: any): string;
/** A one-line, size-capped, secret-free rendering of the response body. */
export function bodySnippet(data: any): string;
/** Keep the endpoint identifiable without printing a presigned-upload signature. */
export function safeUrl(url: any): string;
export function redact(value: any, depth?: number): any;
