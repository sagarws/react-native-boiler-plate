/**
 * AJIO answering "busy" — and asking again instead of failing the claim.
 *
 * THE FAILURE THIS ENDS (2026-11-04). A bulk NDR run of 400+ claims had most
 * rows fail on
 *
 *   work-places failed: <html><body><b>Http/1.1 Service Unavailable</b></body></html> (HTTP 503)
 *   return-order detail failed: Seller data could not be retrieved! Response status code - 503, …
 *
 * and nearly every one of them filed on a manual Retry minutes later. Nothing
 * was wrong with the rows: AJIO's gateway (or the seller service behind it)
 * was shedding load. Each request was tried once, so a momentary 503 became a
 * failed claim and an operator's Retry.
 *
 * GET ONLY. A read can be repeated with no effect on AJIO's side. A POST or
 * PUT (raising the SPF ticket, commenting, attaching) may have been processed
 * before the gateway answered 503 — repeating it is how one return gets two
 * claims — so those are never retried here and fail exactly as before.
 *
 * WHAT COUNTS AS BUSY: 502 / 503 / 504, a transport failure (status -1), and a
 * 5xx whose body says the service behind it answered 503 — AJIO wraps the
 * seller service's 503 in its own error ("Response status code - 503"), and
 * that is the same condition one hop further in. A 4xx, or a 500 that names a
 * real reason, is an answer and is returned at once.
 */
/** Waits before each retry. Three retries, ~17 s in all — a burst, not an outage. */
export const TRANSIENT_RETRY_DELAYS_MS: number[];
/** Whether `res` ({ status, text }) is AJIO saying "busy, try again". */
export function isTransientFailure(res: any): boolean;
/** Whether a request may be repeated without side effects. */
export function isRetryableMethod(method: any): boolean;
/**
 * Runs `send` and, for a GET that came back busy, runs it again after each
 * delay. Returns the last response — a still-busy one included, so the caller
 * reports it exactly as it would have without the retry.
 *
 * @param {() => Promise<{status:number,text?:string}>} send
 * @param {{ method?: string, url?: string, delays?: number[], userLogger?: object }} [options]
 */
export function withTransientRetry(send: () => Promise<{
    status: number;
    text?: string;
}>, { method, url, delays, userLogger }?: {
    method?: string;
    url?: string;
    delays?: number[];
    userLogger?: object;
}): Promise<{
    status: number;
    text?: string;
}>;
