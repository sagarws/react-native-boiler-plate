/**
 * Evaluates until it returns something useful, riding out navigations.
 *
 * `accept` decides what "useful" means — a falsy result is usually "the SPA has
 * not hydrated yet", which is a reason to wait rather than to give up.
 *
 * A non-navigation error is thrown immediately: a broken script should surface
 * as a broken script, not be retried thirty times and reported as a timeout.
 */
export function evaluateUntil(page: any, script: any, { timeoutMs, pollMs, accept, }?: {
    timeoutMs?: number;
    pollMs?: number;
    accept?: (value: any) => boolean;
}): Promise<any>;
/**
 * Evaluates once, treating a destroyed context as "not yet" rather than fatal.
 *
 * @returns {Promise<{ ok: boolean, value?: any, navigated?: boolean, error?: Error }>}
 */
export function tryEvaluate(page: any, script: any): Promise<{
    ok: boolean;
    value?: any;
    navigated?: boolean;
    error?: Error;
}>;
/**
 * Waits for the URL to hold still.
 *
 * Cheaper and more reliable than waiting for a specific navigation event: a
 * redirect chain fires several, and which one is "the last" is only knowable
 * afterwards. A URL that has not changed for `quietMs` has settled.
 */
export function waitForUrlToSettle(page: any, { quietMs, timeoutMs }?: {
    quietMs?: number;
    timeoutMs?: number;
}): Promise<any>;
export function isNavigationError(err: any): boolean;
/** Puppeteer's wording for "the page moved under you". Retry, do not fail. */
export const NAVIGATION_ERRORS: string[];
