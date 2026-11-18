// -----------------------------------------------------------------------------
// Reading from a page that is still moving
// -----------------------------------------------------------------------------
// `page.evaluate` runs inside the page's JavaScript execution context. When the
// page navigates, Chrome destroys that context and builds a new one, and any
// evaluate still in flight rejects with "Execution context was destroyed, most
// likely because of a navigation".
//
// That is not an error in the usual sense. It says the page moved — which,
// straight after a sign-in, is exactly what it is supposed to be doing. AJIO
// ends its login on an OAuth callback that is the START of the portal's own
// redirect chain, so a read issued the moment login() returns is racing it.
//
// Two rules follow, and both matter:
//
//   1. Wait for the page to stop moving before reading.
//   2. Keep each read SHORT, and retry it. A script that polls for twenty
//      seconds inside the page loses everything to one badly-timed redirect;
//      twenty one-second reads from here lose only the one that was unlucky and
//      the next runs in the new context.
//
// The second rule is the one that is easy to get backwards. Polling inside the
// page looks more efficient — one round trip instead of twenty — and is far more
// fragile, because it converts a momentary race into a guaranteed loss.
// -----------------------------------------------------------------------------

/** Puppeteer's wording for "the page moved under you". Retry, do not fail. */
const NAVIGATION_ERRORS = [
    "Execution context was destroyed",
    "Cannot find context with specified id",
    "Execution context is not available",
    "Target closed",
];

const isNavigationError = (err) => {
    const message = (err && err.message) || "";
    return NAVIGATION_ERRORS.some((fragment) => message.includes(fragment));
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Evaluates once, treating a destroyed context as "not yet" rather than fatal.
 *
 * @returns {Promise<{ ok: boolean, value?: any, navigated?: boolean, error?: Error }>}
 */
async function tryEvaluate(page, script) {
    try {
        return { ok: true, value: await page.evaluate(script) };
    } catch (err) {
        if (isNavigationError(err)) return { ok: false, navigated: true, error: err };
        return { ok: false, navigated: false, error: err };
    }
}

/**
 * Evaluates until it returns something useful, riding out navigations.
 *
 * `accept` decides what "useful" means — a falsy result is usually "the SPA has
 * not hydrated yet", which is a reason to wait rather than to give up.
 *
 * A non-navigation error is thrown immediately: a broken script should surface
 * as a broken script, not be retried thirty times and reported as a timeout.
 */
async function evaluateUntil(page, script, {
    timeoutMs = 25000,
    pollMs = 700,
    accept = (value) => value !== null && value !== undefined && value !== false,
} = {}) {
    const deadline = Date.now() + timeoutMs;
    let navigations = 0;

    while (Date.now() < deadline) {
        if (page.isClosed && page.isClosed()) break;

        const attempt = await tryEvaluate(page, script);

        if (attempt.ok && accept(attempt.value)) return attempt.value;
        if (attempt.navigated) navigations += 1;
        if (!attempt.ok && !attempt.navigated) throw attempt.error;

        await sleep(pollMs);
    }

    const err = new Error(
        `Gave up reading the page after ${timeoutMs}ms` +
        (navigations ? ` (it navigated ${navigations} time(s) while reading)` : "")
    );
    err.code = "PAGE_READ_TIMEOUT";
    throw err;
}

/**
 * Waits for the URL to hold still.
 *
 * Cheaper and more reliable than waiting for a specific navigation event: a
 * redirect chain fires several, and which one is "the last" is only knowable
 * afterwards. A URL that has not changed for `quietMs` has settled.
 */
async function waitForUrlToSettle(page, { quietMs = 2000, timeoutMs = 30000 } = {}) {
    const deadline = Date.now() + timeoutMs;
    let last = null;
    let stableSince = Date.now();

    while (Date.now() < deadline) {
        let current;
        try {
            current = page.url();
        } catch (_) {
            current = null;
        }

        if (current !== last) {
            last = current;
            stableSince = Date.now();
        } else if (Date.now() - stableSince >= quietMs) {
            return current;
        }

        await sleep(250);
    }

    return last;
}

module.exports = { evaluateUntil, tryEvaluate, waitForUrlToSettle, isNavigationError, NAVIGATION_ERRORS };
