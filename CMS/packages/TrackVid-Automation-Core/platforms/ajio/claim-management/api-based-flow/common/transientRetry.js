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
const TRANSIENT_RETRY_DELAYS_MS = [2000, 5000, 10000];

const BUSY_STATUSES = new Set([502, 503, 504]);
const UPSTREAM_BUSY_RE = /status\s*code\s*-?\s*50[234]\b|service\s+unavailable|gateway\s+time-?out|bad\s+gateway/i;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Whether `res` ({ status, text }) is AJIO saying "busy, try again". */
function isTransientFailure(res) {
    const status = res ? res.status : -1;

    if (status === -1 || BUSY_STATUSES.has(status)) return true;

    return status >= 500 && UPSTREAM_BUSY_RE.test(String((res && res.text) || ""));
}

/** Whether a request may be repeated without side effects. */
const isRetryableMethod = (method) => String(method || "GET").toUpperCase() === "GET";

/**
 * Runs `send` and, for a GET that came back busy, runs it again after each
 * delay. Returns the last response — a still-busy one included, so the caller
 * reports it exactly as it would have without the retry.
 *
 * @param {() => Promise<{status:number,text?:string}>} send
 * @param {{ method?: string, url?: string, delays?: number[], userLogger?: object }} [options]
 */
async function withTransientRetry(send, { method = "GET", url = "", delays = TRANSIENT_RETRY_DELAYS_MS, userLogger = null } = {}) {
    let res = await send();

    if (!isRetryableMethod(method)) return res;

    for (let i = 0; i < delays.length && isTransientFailure(res); i++) {
        const line = `⏳ AJIO busy (HTTP ${res ? res.status : "?"}) on ${url || "request"} — retry ${i + 1}/${delays.length} in ${Math.round(delays[i] / 1000)}s`;

        if (userLogger && typeof userLogger.warn === "function") userLogger.warn(line);
        else console.warn(line);

        await sleep(delays[i]);
        res = await send();
    }

    return res;
}

module.exports = {
    TRANSIENT_RETRY_DELAYS_MS,
    isTransientFailure,
    isRetryableMethod,
    withTransientRetry,
};
