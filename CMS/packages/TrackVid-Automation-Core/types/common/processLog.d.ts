/**
 * Builds the sentence. Exported so tests assert on the wording rather than on
 * a logger being called.
 *
 * @param {string} name    what ran, e.g. "Snapdeal master import"
 * @param {string} action  "started" | "closed" | "failed"
 * @param {string} [reason] appended to a failure
 */
export function processLine(name: string, action: string, reason?: string): string;
/**
 * Builds the `name` the lines above print, so every caller spells it the same.
 *
 * Hand-written names drift immediately — "Ajio Master Import", "ajio import",
 * "AJIO master-import" — and a log you cannot grep for one platform is the
 * failure this whole module exists to avoid.
 *
 *   processName("ajio", "master import", "seller@example.com")
 *     → "Ajio master import (seller@example.com)"
 *
 * @param {string} platform  platform key, any casing
 * @param {string} kind      "master import" | "session capture" | "claim"
 * @param {string} [subject] the account it runs for, when there is one
 */
export function processName(platform: string, kind: string, subject?: string): string;
/**
 * @param {string} name
 * @param {{info?: Function, error?: Function}} [logger]
 */
export function logProcessStarted(name: string, logger?: {
    info?: Function;
    error?: Function;
}): void;
/**
 * @param {string} name
 * @param {{info?: Function, error?: Function}} [logger]
 */
export function logProcessClosed(name: string, logger?: {
    info?: Function;
    error?: Function;
}): void;
/**
 * @param {string} name
 * @param {string} [reason]
 * @param {{info?: Function, error?: Function}} [logger]
 */
export function logProcessFailed(name: string, reason?: string, logger?: {
    info?: Function;
    error?: Function;
}): void;
/**
 * Wraps a process so the pair can never go missing.
 *
 * The primitives above are fine when a function has one exit, but most of these
 * have several — an early return for "nothing to do", a throw, a partial
 * failure. Whichever way `fn` leaves, exactly one closing line is written:
 *
 *   await withProcessLog("Snapdeal master import", () => run(), { logger })
 *
 * Note it reports "closed", not "succeeded". This says the process ran to
 * completion, not that every credential inside it worked — those outcomes are
 * reported per credential by the runner and would be a different claim.
 *
 * `rethrow: false` logs the failure and returns undefined instead of rejecting.
 * The server's cron jobs are called without a `.catch()` — several of them
 * already absorb their own fatal error and notify Mattermost — so making them
 * reject to get an accurate log line would trade a wrong sentence for an
 * unhandled rejection. They rethrow to HERE, and stop here.
 *
 * @param {string} name                     what ran, from `processName`
 * @param {() => Promise<any>} fn           the process
 * @param {object} [options]
 * @param {{info?: Function, error?: Function}} [options.logger] defaults to console
 * @param {boolean} [options.rethrow=true]  false absorbs the error after logging it
 */
export function withProcessLog(name: string, fn: () => Promise<any>, { logger, rethrow }?: {
    logger?: {
        info?: Function;
        error?: Function;
    };
    rethrow?: boolean;
}): Promise<any>;
