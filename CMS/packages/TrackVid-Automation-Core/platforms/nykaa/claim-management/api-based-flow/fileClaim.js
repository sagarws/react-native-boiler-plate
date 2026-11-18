// -----------------------------------------------------------------------------
// Nykaa — file one CMS claim over the vendor-portal APIs
// -----------------------------------------------------------------------------
// The per-AWB sequence, shared by every runner:
//
//   Automated-Scripts  src/platforms/nykaa/.../apiScriptNew.js   (server)
//   Trackvid-CMS       electron/main/automations/platforms/nykaa (desktop)
//
// No attachments here — Nykaa takes the evidence as a URL in the ticket body —
// so there is no temp directory and no resource mirror to inject. The whole
// sequence is portable as-is.
//
// Nothing here touches Mongo, so a consumer without the driver can run it.
// -----------------------------------------------------------------------------

const {
    createTicket,
    findTicketByReverseAwb,
    claimStatusToCmsStatus,
} = require("./claimApiFlow.js");
const { parseNykaaEmail } = require("../common/utils.js");
const { assertClaimSubmitEnabled } = require("../../../../common/claimSubmitGuard");

/** CMS row → the vendor-portal ticket body. */
function toTicketPayload(configEntry) {
    const emailBody = configEntry.emailBody || configEntry.emailTemplate?.body || "";
    const parsed = emailBody ? parseNykaaEmail(emailBody) : { description: "", evidenceUrl: "" };
    // Flatten evidence like the Puppeteer runner does (single-line input).
    const flatEvidence = parsed.evidenceUrl
        ? parsed.evidenceUrl.split(/\n+/).map((s) => s.trim()).filter(Boolean).join(" | ")
        : "";
    return {
        subject: configEntry.subject || configEntry.typeOfClaim || "",
        issue: configEntry.issue || configEntry.typeOfClaim || "",
        vendorCode: configEntry.vendorCode || "",
        skuId: configEntry.skuId || configEntry.sku || "",
        reverseAwb: configEntry.reverseAwb || configEntry.awbNumber || "",
        returnType: configEntry.returnType || "",
        description: configEntry.description || (parsed.description
            ? `<div>${parsed.description.replace(/\n/g, "<br>")}</div>` : ""),
        evidenceUrl: configEntry.evidenceUrl || flatEvidence,
    };
}

/**
 * One CMS row → one filed Nykaa ticket.
 *
 * Returns { ticketId, alreadyExisted, cmsStatus, nykaaStatus }.
 * Throws with .code=AUTH_EXPIRED when the session died, and .code=RATE_LIMITED
 * when the dedupe check could not be completed — both are for the caller to
 * retry, never to report as a failed claim.
 */
async function fileNykaaClaim(ctx, configEntry, awbNumber, options = {}) {
    const { log = console } = options;

    // Step 1 — dedupe.
    const rw = configEntry.reverseAwb || configEntry.awbNumber || "";
    let existing = null;
    try {
        existing = await findTicketByReverseAwb(ctx, rw);
    } catch (err) {
        // This check is the ONLY thing standing between a retry and a duplicate
        // ticket. Swallowing the error left `existing` null and fell straight
        // through to createTicket — so a rate-limited dedupe check on an AWB
        // that already HAS a ticket filed a second one. Fail the AWB instead:
        // it can be retried safely, a duplicate claim cannot be un-filed.
        if (err && err.code === "AUTH_EXPIRED") throw err; // caller re-logins and retries
        const wrapped = new Error(
            `Could not verify whether a ticket already exists for ${rw} (${err.message}) — ` +
            `skipping to avoid filing a duplicate. Retry once the portal responds.`
        );
        // Keep RATE_LIMITED so the caller defers this AWB to a cooldown pass.
        // Flattening it to DEDUPE_CHECK_FAILED failed a claim outright for what
        // is a wait-and-try-again condition.
        wrapped.code = err && err.code === "RATE_LIMITED" ? "RATE_LIMITED" : "DEDUPE_CHECK_FAILED";
        throw wrapped;
    }
    if (existing && (existing.ticketNumber || existing.id)) {
        const ticketId = String(existing.ticketNumber || existing.id);
        const nykaaStatus = existing.status || null;
        const cmsStatus = claimStatusToCmsStatus(nykaaStatus);
        log.log(`ℹ️ Prior ticket for ${rw} → #${ticketId} (${nykaaStatus} → ${cmsStatus})`);
        return { ticketId, alreadyExisted: true, cmsStatus, nykaaStatus };
    }

    // Step 2 — file the ticket (response carries ticketNumber directly).
    const payload = toTicketPayload(configEntry);

    // The one irreversible call.
    assertClaimSubmitEnabled("Nykaa", "create ticket");

    const result = await createTicket(ctx, payload);
    log.log(`   ✅ Ticket submitted: #${result.ticketNumber || "(none)"}`);
    if (!result.ticketNumber) {
        const err = new Error("Ticket id not captured after submit; verify manually.");
        err.code = "TICKET_READBACK_FAILED";
        throw err;
    }
    return { ticketId: result.ticketNumber, alreadyExisted: false, cmsStatus: null, nykaaStatus: null };
}

module.exports = { fileNykaaClaim, toTicketPayload };
