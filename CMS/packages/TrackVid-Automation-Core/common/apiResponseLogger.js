// -----------------------------------------------------------------------------
// Claim-platform API failure logging — one terminal line per response >= 400
// -----------------------------------------------------------------------------
// Every claim automation talks to its platform over HTTP and, until now, most of
// them turned a non-2xx into a thrown Error and nothing else. When that error was
// caught and mapped to a short outcome ("Failed", "not claimable"), the platform's
// own explanation — the part that actually says WHY — never reached the log.
//
// This module is the shared place that prints it. Each platform's HTTP choke point
// (httpCall / gqlCall / xbeesPost / apiJson) calls logApiFailure() right before it
// throws, so the response is visible even when the caller swallows the status.
//
// Shared deliberately: the same line shape across AJIO / Myntra / Meesho /
// Delhivery / Nykaa / Snapdeal / Xbees / Flipkart means one grep finds a bad claim
// on any platform:
//
//   ❌ MEESHO API [Create ticket] POST https://… → HTTP 422 message="AWB not eligible" body={…}
//
// Never throws: a logging failure must not break a claim that is otherwise fine.
// -----------------------------------------------------------------------------

// Response bodies are platform data, but a few endpoints (login, token refresh,
// presigned uploads) echo credentials back. Redact anything whose KEY looks like a
// secret rather than trying to recognise secret values.
const SECRET_KEY = /pass(word)?|token|secret|cookie|authorization|auth[-_]?key|jwt|session[-_]?id|otp|csrf|signature|credential/i;

// Query strings carry the same risk — presigned S3/Azure URLs are mostly signature.
const SECRET_QUERY_KEY = /sig|signature|token|key|secret|password|credential|auth/i;

const MAX_BODY_CHARS = Number(process.env.API_ERROR_LOG_BODY_CHARS) || 600;
const MAX_DEPTH = 4;

function redact(value, depth = 0) {
    if (value == null) return value;
    if (Array.isArray(value)) {
        if (depth >= MAX_DEPTH) return "[…]";
        return value.slice(0, 20).map((v) => redact(v, depth + 1));
    }
    if (typeof value === "object") {
        if (depth >= MAX_DEPTH) return "{…}";
        const out = {};
        for (const [k, v] of Object.entries(value)) {
            out[k] = SECRET_KEY.test(k) ? "[REDACTED]" : redact(v, depth + 1);
        }
        return out;
    }
    return value;
}

/** A one-line, size-capped, secret-free rendering of the response body. */
function bodySnippet(data) {
    if (data == null || data === "") return "";
    if (Buffer.isBuffer(data)) return `<${data.length} bytes>`;
    let text;
    if (typeof data === "string") text = data;
    else {
        try { text = JSON.stringify(redact(data)); } catch (_) { text = String(data); }
    }
    text = String(text).replace(/\s+/g, " ").trim();
    if (!text) return "";
    return text.length > MAX_BODY_CHARS
        ? `${text.slice(0, MAX_BODY_CHARS)}… (${text.length} chars)`
        : text;
}

// Each platform nests its human-readable reason somewhere different:
//   AJIO      { errorMessage }              Myntra   { status: { statusMessage } }
//   Xbees     { ReturnMessage }             Flipkart { errors: [{ message }] }
//   Meesho / Delhivery / Nykaa / Snapdeal   { message } / { detail } / { error }
const MESSAGE_KEYS = [
    "errorMessage", "statusMessage", "ReturnMessage", "message",
    "error_message", "errorDescription", "detail", "error",
];

/** The platform's own wording for the failure, or "" when it did not give one. */
function extractApiMessage(data) {
    if (data == null) return "";
    if (typeof data === "string") return data.replace(/\s+/g, " ").trim().slice(0, 300);
    if (typeof data !== "object") return String(data);

    const pick = (obj) => {
        if (!obj || typeof obj !== "object") return "";
        for (const key of MESSAGE_KEYS) {
            const v = obj[key];
            if (typeof v === "string" && v.trim()) return v.trim().slice(0, 300);
        }
        return "";
    };

    const direct = pick(data);
    if (direct) return direct;

    // One level of envelope: { status: {...} } / { data: {...} } / { result: {...} }
    for (const nested of [data.status, data.data, data.result, data.response]) {
        const msg = pick(nested);
        if (msg) return msg;
    }

    // GraphQL (Flipkart) puts it in an array.
    const errs = data.errors || data.graphErrors;
    if (Array.isArray(errs) && errs.length > 0) {
        const msg = errs.map((e) => e && (e.message || e.errorMessage)).filter(Boolean).join("; ");
        if (msg) return msg.slice(0, 300);
    }
    return "";
}

/** The id support asks for, when the platform returns one. */
function extractCorrelationId(data) {
    if (!data || typeof data !== "object") return "";
    for (const key of ["correlationId", "correlation_id", "requestId", "request_id", "traceId", "trackingId"]) {
        const v = data[key];
        if (v != null && String(v).trim()) return String(v).trim().slice(0, 80);
    }
    return "";
}

/** Keep the endpoint identifiable without printing a presigned-upload signature. */
function safeUrl(url) {
    if (!url) return "?";
    const raw = String(url);
    const cut = raw.indexOf("?");
    if (cut === -1) return raw.slice(0, 300);
    const base = raw.slice(0, cut);
    const params = raw
        .slice(cut + 1)
        .split("&")
        .map((pair) => {
            const eq = pair.indexOf("=");
            if (eq === -1) return pair;
            const key = pair.slice(0, eq);
            return SECRET_QUERY_KEY.test(key) ? `${key}=[REDACTED]` : pair;
        })
        .join("&");
    return `${base}?${params}`.slice(0, 400);
}

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
function logApiFailure({ platform, step, method = "GET", url, status, data, logger } = {}) {
    try {
        const parts = [`❌ ${String(platform || "API").toUpperCase()} API`];
        if (step) parts.push(`[${step}]`);
        parts.push(`${String(method).toUpperCase()} ${safeUrl(url)}`);
        parts.push(`→ HTTP ${status}`);

        const message = extractApiMessage(data);
        if (message) parts.push(`message="${message}"`);

        const correlationId = extractCorrelationId(data);
        if (correlationId) parts.push(`correlationId=${correlationId}`);

        const body = bodySnippet(data);
        // Skip the body when it adds nothing beyond the message we already printed.
        if (body && body !== message && body !== `"${message}"`) parts.push(`body=${body}`);

        const line = parts.join(" ");
        if (logger && typeof logger.error === "function") logger.error(line);
        else console.error(line);
    } catch (_) {
        /* logging must never break a claim */
    }
}

// `redact` is exported so anything else that keeps a platform's response —
// claimFailureStore writes them to disk — strips secrets by the SAME rule. A
// second copy of SECRET_KEY is a second chance to forget a key, on the copy
// that happens to be written to a file rather than a terminal.
module.exports = { logApiFailure, extractApiMessage, extractCorrelationId, bodySnippet, safeUrl, redact };
