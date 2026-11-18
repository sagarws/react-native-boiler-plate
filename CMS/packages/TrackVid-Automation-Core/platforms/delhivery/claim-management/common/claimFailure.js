// -----------------------------------------------------------------------------
// Delhivery One — claim failure classification
// -----------------------------------------------------------------------------
// A failed claim used to reach the operator as one flat sentence, and the batch
// summary as a bare count ("0 success, 1 failed"). Both are true and neither is
// traceable: "User unauthorised to access mentioned client! (HTTP 403)" does not
// say which of the five stages of a claim died, whether re-running would help,
// or which id to hand to Delhivery support.
//
// So every throw inside processOneClaim carries a STAGE, and this module turns
// (stage + error) into one line that answers those three questions:
//
//   [UPLOAD] Delhivery refused the upload · User unauthorised to access mentioned
//   client! (HTTP 403) · client=cms::client::f21a90b3-… · awb=291231… · retry=no
//
// The same object drives the per-AWB failure table printed at the end of a batch
// and the `error` string sent on the CMS callback, so the log, the summary, and
// the CMS row all say the same thing.
// -----------------------------------------------------------------------------

// Ordered as a claim actually runs. The stage tells you how far it got, which is
// most of the diagnosis: a DEDUPE failure means we never touched the AWB, while a
// SUBMIT failure means a ticket may exist on Delhivery's side without us knowing.
const STAGE = {
    SESSION: "SESSION",         // login / token — nothing about this AWB yet
    AWB_LOOKUP: "AWB_LOOKUP",   // does this shipment exist on this client at all
    DEDUPE: "DEDUPE",           // pre-existing-claim lookup
    EVIDENCE: "EVIDENCE",       // downloading unboxing docs from S3
    UPLOAD: "UPLOAD",           // presigned URLs + S3 put
    SUBMIT: "SUBMIT",           // create_ticket
    READBACK: "READBACK",       // ticket created but no public id came back
    UNKNOWN: "UNKNOWN",
};

const STAGE_LABEL = {
    SESSION: "Delhivery session/login",
    AWB_LOOKUP: "AWB existence check",
    DEDUPE: "pre-existing claim check",
    EVIDENCE: "evidence download",
    UPLOAD: "attachment upload",
    SUBMIT: "ticket submit",
    READBACK: "ticket id readback",
    UNKNOWN: "claim processing",
};

// Attach a stage to an error without flattening anything already on it. Used at
// each throw site so the classifier never has to guess from message text.
function tagStage(err, stage) {
    if (err && !err.stage) err.stage = stage;
    return err;
}

function firstLine(msg) {
    return String(msg || "").replace(/\s+/g, " ").trim();
}

/**
 * Classify a claim failure.
 *
 * @returns {{
 *   stage: string, stageLabel: string, code: string, reason: string,
 *   retryable: boolean, needsManualCheck: boolean, hint: string|null,
 *   requestId: string|null, hqClientId: string|null, status: number|null,
 *   message: string
 * }}
 */
function describeClaimFailure(err, { awb = null } = {}) {
    const code = (err && err.code) || null;
    // Strip the wrapper prefixes the throw sites add for the console. The stage
    // already says where we were, so repeating "UPLOAD_FAILED" inside the reason
    // is noise — and it read especially badly on a gateway 403, which is not an
    // upload problem at all, just one noticed during the upload.
    const raw = firstLine(err && err.message).replace(/^UPLOAD_FAILED:\s*/, "");
    const status = (err && err.status) || null;
    const requestId = (err && err.requestId) || null;
    const hqClientId = (err && err.hqClientId) || null;

    let stage = (err && err.stage) || STAGE.UNKNOWN;
    let reason = raw;
    let hint = null;
    // Default: unknown failures are worth another run. Anything we can prove is
    // permanent gets flipped below — re-running a permanent failure burns a
    // Puppeteer login and a full re-upload to arrive at the same error.
    let retryable = true;
    // "We may have created a ticket and lost the id" — the operator has to look,
    // and the CMS row is flagged Help Center Failed rather than Failed.
    let needsManualCheck = false;

    if (code === "INVALID_CREDENTIALS") {
        stage = STAGE.SESSION;
        reason = "Delhivery rejected the username/password";
        hint = "credential is now marked unverified — update the password in settings";
        retryable = false;
    } else if (code === "LOGIN_NO_TOKEN" || code === "LOGIN_TIMEOUT") {
        stage = STAGE.SESSION;
        reason = "Delhivery SSO did not return a token";
        hint = "portal login flow may have changed, or the browser timed out";
    } else if (code === "AUTH_EXPIRED") {
        stage = err?.stage || STAGE.SESSION;
        reason = "session expired mid-run";
        hint = "a fresh login is attempted once per batch; a repeat means the refresh token is dead";
    } else if (code === "DELHIVERY_FORBIDDEN") {
        // The two 403s mean very different things and want different fixes.
        if (err && err.wrongHqClient) {
            reason = `Delhivery refused the HQ client we sent — ${raw.split("(HTTP")[0].trim()}`;
            // The id is already in the `client=` field — say what to do about it,
            // do not print it twice.
            hint = hqClientId
                ? "this login may not act on that client; the cached id is cleared so the next run re-resolves it"
                : "no x-hq-client-id was sent at all";
        } else {
            reason = `Delhivery refused the request — ${raw.split("(HTTP")[0].trim()}`;
            hint = "the account is authenticated but not entitled to this claims module";
        }
        retryable = false;
    } else if (code === "AWB_NOT_FOUND") {
        stage = STAGE.AWB_LOOKUP;
        reason = "No AWB number found";
        hint = `Delhivery's ${err.shipmentType || "REVERSE"} shipment search returned nothing for this AWB on this client — wrong credential for this order, or the AWB is not a return leg`;
        // Permanent for this credential: the shipment is not here, and no amount
        // of retrying puts it here. Nothing was uploaded, so nothing to undo.
        retryable = false;
    } else if (code === "TICKET_READBACK_FAILED") {
        stage = STAGE.READBACK;
        reason = "ticket submitted but Delhivery returned no public ticket id";
        hint = "check the portal before re-running — a duplicate claim may be filed otherwise";
        retryable = false;
        needsManualCheck = true;
    } else if (code === "DELHIVERY_API_ERROR") {
        reason = `Delhivery API error${status ? ` (HTTP ${status})` : ""}${err.step ? ` at ${err.step}` : ""}`;
        // 4xx is our request; 5xx is theirs and worth retrying.
        retryable = !status || status >= 500;
    } else if (/^EVIDENCE_MISSING/.test(raw)) {
        stage = STAGE.EVIDENCE;
        reason = "no usable unboxing evidence for this AWB";
        hint = "every unboxingDoc url was empty, a placeholder, or failed to download";
        retryable = false;
    }

    if (stage === STAGE.UNKNOWN && code) stage = STAGE.SUBMIT;

    const bits = [`[${stage}] ${reason}`];
    if (status && !/HTTP \d/.test(reason)) bits.push(`http=${status}`);
    if (hqClientId) bits.push(`client=${hqClientId}`);
    if (requestId) bits.push(`req=${requestId}`);
    if (awb) bits.push(`awb=${awb}`);
    bits.push(`retry=${retryable ? "yes" : "no"}`);
    if (hint) bits.push(hint);

    return {
        stage,
        stageLabel: STAGE_LABEL[stage] || STAGE_LABEL.UNKNOWN,
        code: code || "UNTAGGED",
        reason,
        retryable,
        needsManualCheck,
        hint,
        requestId,
        hqClientId,
        status,
        // Capped so it survives the callback's 500-char `error` field intact.
        message: bits.join(" · ").slice(0, 500),
    };
}

/**
 * Per-AWB failure table for the end of a batch. One line each, grouped so a run
 * that failed the same way 40 times reads as one problem rather than 40.
 */
function formatFailureSummary(failures) {
    if (!Array.isArray(failures) || failures.length === 0) return "";
    const byReason = new Map();
    for (const f of failures) {
        const key = `${f.stage}|${f.reason}`;
        if (!byReason.has(key)) byReason.set(key, { ...f, awbs: [] });
        byReason.get(key).awbs.push(f.awb);
    }
    const lines = ["", "❌ Failure breakdown:"];
    for (const g of byReason.values()) {
        const shown = g.awbs.slice(0, 5).join(", ");
        const more = g.awbs.length > 5 ? ` (+${g.awbs.length - 5} more)` : "";
        lines.push(`   • [${g.stage}] ${g.reason}`);
        lines.push(`     ${g.awbs.length} AWB(s): ${shown}${more} — retry=${g.retryable ? "yes" : "no"}`);
        if (g.hint) lines.push(`     ↳ ${g.hint}`);
    }
    return lines.join("\n");
}

module.exports = { STAGE, STAGE_LABEL, tagStage, describeClaimFailure, formatFailureSummary };
