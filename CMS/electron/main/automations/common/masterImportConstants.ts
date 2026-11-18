/**
 * Timings for the master import, both flows.
 *
 * Snapdeal's report is REQUESTED in one browser session and DOWNLOADED in
 * another, minutes later, because the portal builds it in the background. The
 * automation server splits these into two jobs for the same reason; holding a
 * browser open for an hour waiting is wasteful on a server and worse on an
 * operator's laptop, where it also keeps a window on their screen.
 *
 * Collected here rather than inlined so the two phases cannot drift apart, and
 * so changing the cadence is one edit rather than a search.
 */

/**
 * How long to wait before checking whether a requested report is ready.
 *
 * Ten minutes: a captured Snapdeal report took ~8 minutes to build (requested
 * 6:51, complete 6:59), so checking sooner mostly re-reads "PEN" and spends one
 * of only MASTER_IMPORT_MAX_ATTEMPTS checks learning nothing.
 */
export const MASTER_IMPORT_POLL_INTERVAL_MS = 10 * 60 * 1000

/**
 * How many times a queued report is checked before it is given up on.
 *
 * A report that is not ready after three checks is unlikely to be ready on the
 * fourth, and an entry that retries until a two-hour timeout keeps a browser
 * opening every five minutes for a file that is probably never coming.
 */
export const MASTER_IMPORT_MAX_ATTEMPTS = 3

/**
 * Backstop for a report that somehow never reaches its attempt limit — a queue
 * entry left behind by a crash mid-collection, say. MASTER_IMPORT_MAX_ATTEMPTS
 * is what normally ends a report's life; this only catches the stragglers.
 */
export const MASTER_IMPORT_QUEUE_TIMEOUT_MS = 2 * 60 * 60 * 1000

/** How long to wait for the file itself once Download is clicked. */
export const MASTER_IMPORT_DOWNLOAD_TIMEOUT_MS = 2 * 60 * 1000

/**
 * How soon after app start the queue is first drained.
 *
 * Short, but not zero: a report queued before the app was closed may already be
 * ready, and the operator should not wait a full interval to find out. The
 * delay lets sign-in and the session restore finish first.
 */
export const MASTER_IMPORT_QUEUE_WARMUP_MS = 30 * 1000


// ---------------------------------------------------------------------------
// API flow
// ---------------------------------------------------------------------------
// The direct-API flow does not use the queue above. It schedules its reports
// and drains them in one pass, exactly as the automation server's apiScript.js
// does, because it holds no browser between rounds — only a cookie jar — so
// there is nothing to close and reopen.
//
// These match the server's SNAPDEAL_QUEUE_POLL_MS / SNAPDEAL_QUEUE_TIMEOUT_MS
// defaults so both consumers are equally polite to the same API rather than one
// of them polling twice as hard.

/**
 * How long between rounds of asking whether the scheduled reports are ready.
 *
 * Ten minutes rather than the server's three. A captured Snapdeal report took
 * ~8 minutes to build (requested 6:51, complete 6:59), so the first check lands
 * just past that; with MASTER_IMPORT_MAX_ATTEMPTS the run covers 30 minutes,
 * which is generous room for a report that is merely slow.
 */
export const MASTER_IMPORT_API_POLL_MS = 10 * 60 * 1000

/**
 * Backstop only. MASTER_IMPORT_MAX_ATTEMPTS is what normally ends the drain;
 * this catches a loop that somehow outlives its own attempt count.
 */
export const MASTER_IMPORT_API_TIMEOUT_MS = 60 * 60 * 1000
