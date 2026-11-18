/**
 * One line per automation, when it starts and when it stops.
 *
 * Every automation — a master import, a session capture, a claim — announces
 * itself the same way, so a terminal can be read without knowing which subsystem
 * wrote which line:
 *
 *   Snapdeal master import has been started successfully
 *   Snapdeal master import has been closed successfully
 *   Snapdeal master import has failed — the portal rejected the sign-in
 *
 * Lives in the core because both runners must produce the SAME sentence. Two
 * copies drift in wording, and a log you cannot grep across the server and the
 * desktop is most of the value gone.
 *
 * ONE DEVIATION from the format as first written: a failure reads "has failed",
 * not "has been failed successfully". The template was clearly meant to give
 * every process a matching start/stop line, and "failed successfully" would
 * read as a success at a glance — which is the exact moment the line matters
 * most. Everything else follows the pattern verbatim.
 */

/** The verbs a process can report. */
const STARTED = "started";
const CLOSED = "closed";
const FAILED = "failed";

/**
 * Builds the sentence. Exported so tests assert on the wording rather than on
 * a logger being called.
 *
 * @param {string} name    what ran, e.g. "Snapdeal master import"
 * @param {string} action  "started" | "closed" | "failed"
 * @param {string} [reason] appended to a failure
 */
function processLine(name, action, reason) {
    const subject = String(name || "Automation").trim() || "Automation";

    if (action === FAILED) {
        return reason ? `${subject} has failed — ${reason}` : `${subject} has failed`;
    }

    return `${subject} has been ${action} successfully`;
}

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
function processName(platform, kind, subject) {
    const key = String(platform || "").trim();
    const label = key ? key.charAt(0).toUpperCase() + key.slice(1).toLowerCase() : "";
    const head = [label, String(kind || "").trim()].filter(Boolean).join(" ") || "Automation";
    const who = String(subject || "").trim();

    return who ? `${head} (${who})` : head;
}

/** Anything with info/error. Defaults to console so a caller need not pass one. */
const sink = (logger) => ({
    info: (line) => (logger?.info ? logger.info(line) : console.log(line)),
    error: (line) => (logger?.error ? logger.error(line) : console.error(line)),
});

/**
 * @param {string} name
 * @param {{info?: Function, error?: Function}} [logger]
 */
function logProcessStarted(name, logger) {
    sink(logger).info(processLine(name, STARTED));
}

/**
 * @param {string} name
 * @param {{info?: Function, error?: Function}} [logger]
 */
function logProcessClosed(name, logger) {
    sink(logger).info(processLine(name, CLOSED));
}

/**
 * @param {string} name
 * @param {string} [reason]
 * @param {{info?: Function, error?: Function}} [logger]
 */
function logProcessFailed(name, reason, logger) {
    sink(logger).error(processLine(name, FAILED, reason));
}

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
async function withProcessLog(name, fn, { logger, rethrow = true } = {}) {
    logProcessStarted(name, logger);

    try {
        const result = await fn();

        logProcessClosed(name, logger);

        return result;
    } catch (err) {
        logProcessFailed(name, err?.message || String(err), logger);

        if (rethrow) throw err;

        return undefined;
    }
}

module.exports = {
    processLine,
    processName,
    logProcessStarted,
    logProcessClosed,
    logProcessFailed,
    withProcessLog,
};
