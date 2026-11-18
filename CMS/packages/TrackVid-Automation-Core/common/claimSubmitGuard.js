// -----------------------------------------------------------------------------
// Claim Submit Guard — one kill-switch for the final "file the claim" step
// -----------------------------------------------------------------------------
// Gated by DISABLE_SUBMIT=true (DESABLE_SAVE / DISABLE_SAVE remain aliases). When it is
// on, every platform script still logs in, searches the AWB, fills the form and
// uploads the attachments — but the last action, the one that actually creates a
// claim/ticket/dispute on the marketplace, is skipped.
//
// Covers both flavours of "submit":
//   - UI scripts  → the Submit / Create Ticket / Raise Dispute button click
//   - API scripts → the mutation/POST that files the claim
//
// Contract: nothing downstream may treat a skipped run as a filed claim, so the
// guard never returns quietly to the caller.
//   - Flows that signal failure by throwing get `claimSubmitDisabledError()`,
//     tagged `code = "CLAIM_SUBMIT_DISABLED"` so it is distinguishable from a
//     real portal/selector failure in logs and error handlers.
//   - Flows with a never-throw contract (the AJIO raiseClaim family, which maps
//     its return value to a TrackVid callback) get `claimSubmitDisabledResult()`,
//     which reuses the existing `status: "dry_run"` those callers already know.
// -----------------------------------------------------------------------------

/**
 * DISABLE_SUBMIT=true → no claim may be submitted.
 *
 * `DESABLE_SAVE` came first (with its typo) and `DISABLE_SAVE` was added as an
 * alias; both are still honoured so no existing deployment changes behaviour.
 * `DISABLE_SUBMIT` is the name to use — it says what it stops, where "save"
 * reads like it is about storing something locally.
 *
 * Read on EVERY call, never cached, so setting it and running is enough.
 *
 * FAILS SAFE: only the exact string "true" (any casing) disables submission. A
 * typo, an empty value or an unset variable all mean "file the claim" — the
 * behaviour every deployment already has.
 */
function isClaimSubmitDisabled() {
    const raw =
        process.env.DISABLE_SUBMIT || process.env.DESABLE_SAVE || process.env.DISABLE_SAVE || "";
    return String(raw).trim().toLowerCase() === "true";
}

function logSkip(platform, action) {
    console.log(
        `🛑 DISABLE_SUBMIT=true — skipping ${platform} ${action}. Nothing was submitted to the portal.`
    );
}

/** Tagged error for the throw-based flows (Flipkart, Myntra, Snapdeal, ...). */
function claimSubmitDisabledError(platform, action = "claim submit") {
    const err = new Error(
        `CLAIM_SUBMIT_DISABLED: DISABLE_SUBMIT=true — ${platform} ${action} was skipped, no claim was filed.`
    );
    err.code = "CLAIM_SUBMIT_DISABLED";
    err.claimSubmitDisabled = true;
    return err;
}

/**
 * Throw-based guard. Call it as the first statement of a submit function:
 *   assertClaimSubmitEnabled("Flipkart", "'Submit Claim' click");
 */
function assertClaimSubmitEnabled(platform, action = "claim submit") {
    if (!isClaimSubmitDisabled()) return;
    logSkip(platform, action);
    throw claimSubmitDisabledError(platform, action);
}

/** Return-based guard for the never-throw AJIO claim flows. */
function claimSubmitDisabledResult(platform, action = "claim submit", extra = {}) {
    logSkip(platform, action);
    return {
        status: "dry_run",
        message: `DISABLE_SUBMIT=true — ${platform} ${action} skipped, no claim was filed`,
        ...extra,
    };
}

module.exports = {
    isClaimSubmitDisabled,
    claimSubmitDisabledError,
    assertClaimSubmitEnabled,
    claimSubmitDisabledResult,
};
