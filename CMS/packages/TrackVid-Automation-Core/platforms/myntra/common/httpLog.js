/**
 * Terminal dump of Myntra API responses that a run couldn't use.
 *
 * Every call site in the Myntra API flows (claimApiFlow.js, apiReportFlow.js)
 * sets `validateStatus: () => true`, so axios never throws on an error status.
 * The response is handed to branch logic that boils it down to one short
 * business sentence ("Claim is not applicable", "Invalid AWB Number") for the
 * CMS row and drops the rest. That is right for the row, but it means the
 * envelope Myntra actually sent —
 *
 *   { "status": { "statusCode": 400, "statusType": "ERROR",
 *                 "statusMessage": "..." } }
 *
 * — never reaches the terminal, and there is nothing to look at when a claim
 * fails for a reason nobody anticipated.
 *
 * Always on. There is deliberately no env switch: the whole point is that the
 * response is there when a failure shows up unannounced, and a log you have to
 * enable before reproducing the problem is a log you don't have when it counts.
 * These only fire on responses a run could not use, so they cost nothing on a
 * healthy batch.
 */

// Myntra error envelopes are small; the cap only exists so an HTML error page
// or a stray binary body can't flood the terminal.
const MAX_BODY_CHARS = 4000;

function truncate(text) {
    const s = String(text);
    return s.length > MAX_BODY_CHARS
        ? `${s.slice(0, MAX_BODY_CHARS)}\n… [${s.length - MAX_BODY_CHARS} more chars truncated]`
        : s;
}

function formatBody(data) {
    if (data === null || data === undefined || data === "") return "(empty body)";
    if (Buffer.isBuffer(data)) return truncate(data.toString("utf8"));
    if (typeof data === "string") return truncate(data);
    try {
        // Pretty-printed: these envelopes are read by a human staring at a
        // terminal, not grepped.
        return truncate(JSON.stringify(data, null, 2));
    } catch {
        return truncate(data);
    }
}

// The proof-upload PUT goes to an Azure SAS URL whose query string IS the
// credential. Never print it.
function redactUrl(url) {
    const s = String(url || "");
    return s.replace(/([?&](?:sig|se|st|sp|sv|skoid|sktid|signature|token)=)[^&]*/gi, "$1<redacted>");
}

/**
 * Where did the failure actually land?
 *
 * partnersapi is NOT consistent about this. The same "No valid orders found"
 * answer for the same AWB arrives either as a real HTTP 400, or as an HTTP 200
 * whose BODY carries the error:
 *
 *   HTTP 200 { status: { statusCode: 400, statusType: "ERROR",
 *                        statusMessage: "Error in fetching claim : No valid
 *                                        orders found ..." },
 *              data: [], stackTrace: [...] }
 *
 * Code that trusts res.status alone reads that second shape as a successful
 * call that returned no rows — which is a different business outcome with a
 * different message. Every status decision in the Myntra API flows goes
 * through here so both shapes are treated the same way.
 */
function readStatus(res) {
    const httpStatus = res && typeof res.status === "number" ? res.status : 0;
    const envelope = (res && res.data && res.data.status) || {};
    const code = Number(envelope.statusCode) || 0;
    const type = String(envelope.statusType || "").toUpperCase();
    const message = String(envelope.statusMessage || "");
    // Myntra's newer session-expired shape: HTTP 200 with body
    // { status: { sessionExpired: true, statusCode: 101, statusType: "ERROR",
    //             statusMessage: "Session expired. Please logout and login again" } }
    // A pure 401/403 check would miss this and the runner would never re-login.
    const sessionExpired = envelope.sessionExpired === true;
    const isAuthExpired =
        httpStatus === 401 || httpStatus === 403 ||
        code === 401 || code === 403 ||
        sessionExpired;
    return {
        httpStatus,
        code,
        type,
        message,
        sessionExpired,
        isAuthExpired,
        // The code an operator should act on: the body's, when it has one.
        effective: code || httpStatus,
        failed: httpStatus >= 400 || code >= 400 || type === "ERROR",
    };
}

function dump(step, res, note) {
    const cfg = (res && res.config) || {};
    const method = String(cfg.method || "get").toUpperCase();
    const { httpStatus, code } = readStatus(res);
    // Spell out the disagreement rather than picking one — "HTTP 200" alone
    // reads as success, and "HTTP 400" alone hides that the transport was fine.
    const status = code && code !== httpStatus
        ? `HTTP ${httpStatus} (body statusCode ${code})`
        : `HTTP ${httpStatus || "?"}`;

    console.error(
        `\n❌ [myntra-api] ${step} → ${status} ${method} ${redactUrl(cfg.url)}` +
        (note ? `\n   ${note}` : "")
    );
    console.error(formatBody(res && res.data));
    console.error("");
}

/**
 * Log an error status. Call IMMEDIATELY after the await and BEFORE any
 * branching, so the body is printed no matter which branch consumes the
 * response — including branches that swallow the status and return a
 * normal-looking value (fetchClaimByTicketId's 400 -> { found: false }).
 */
function logHttpError(step, res) {
    if (!readStatus(res).failed) return;
    dump(step, res);
}

/**
 * Log a response the run could not use even though the status was fine.
 *
 * Myntra's "not claimable on this account" answer is an HTTP 200 carrying an
 * empty `data` array, not an error status — logHttpError never sees it, and
 * without this the run reports "Claim is not applicable" with nothing behind
 * it. `note` says why the body is being shown.
 */
function logHttpBody(step, res, note) {
    dump(step, res, note);
}

module.exports = { logHttpError, logHttpBody, readStatus };
