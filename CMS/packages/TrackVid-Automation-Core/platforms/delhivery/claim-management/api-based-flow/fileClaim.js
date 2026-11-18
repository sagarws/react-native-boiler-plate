// -----------------------------------------------------------------------------
// Delhivery — file one CMS claim over the partner APIs
// -----------------------------------------------------------------------------
// The per-AWB sequence, shared by every runner:
//
//   Automated-Scripts  src/platforms/delhivery/.../apiScriptNew.js       (server)
//   Trackvid-CMS       electron/main/automations/platforms/delhivery     (desktop)
//
// Injected because the two consumers disagree:
//   saveResource   the server mirrors downloaded assets into its report share;
//                  the desktop app has no share. Omit it and nothing is mirrored.
//   perClaimFiles  the caller's cleanup list, appended as temp files appear.
//   log            defaults to console.
//
// Nothing here touches Mongo, so a consumer without the driver can run it.
// -----------------------------------------------------------------------------

const path = require("path");

const {
    listLostDamageClaims,
    assertAwbExists,
    shipmentAmountOf,
    liabilityPreviewAmount,
    findTicketByAwb,
    findClaimTicketByAwb,
    resolvePublicTicketId,
    mapTicketStatus,
    materializeAttachments,
    createTicket,
    claimStatusToCmsStatus,
} = require("./claimApiFlow.js");
const { STAGE, tagStage, describeClaimFailure } = require("../common/claimFailure.js");

/** Delhivery pads empty slots with a URL ending in "undefined". */
function isPlaceholderUrl(url) {
    if (typeof url !== "string") return true;
    const trimmed = url.trim();
    if (!trimmed) return true;
    const last = trimmed.split("?")[0].split("/").filter(Boolean).pop() || "";
    return /^(undefined|null)$/i.test(last) || /^(undefined|null)$/i.test(trimmed);
}

async function downloadToFile(url, filename, tempDir) {
    if (!url || !url.startsWith("http")) return null;
    const axios = require("axios");
    const fs = require("fs-extra");
    const res = await axios.get(url, { responseType: "arraybuffer", timeout: 30000 });
    const ext = path.extname(new URL(url).pathname) || ".tmp";
    const filePath = path.join(tempDir, `${filename}_${Date.now()}${ext}`);
    await fs.writeFile(filePath, res.data);
    return filePath;
}

// Delhivery names its uploads with the portal's own convention
// (Unbox_Image_1.jpg, Unbox_Video_1.mp4). We follow the same so filenames the
// reviewer sees match what the UI would produce.
function delhiveryFilenameFor(url, i) {
    const ext = (path.extname(new URL(url).pathname) || "").toLowerCase();
    if ([".mp4", ".mov", ".webm", ".mkv"].includes(ext)) return `Unbox_Video_${i + 1}${ext}`;
    return `Unbox_Image_${i + 1}${ext || ".jpg"}`;
}

function contentTypeFor(fileName) {
    const ext = path.extname(fileName).toLowerCase();
    if (ext === ".mp4") return "video/mp4";
    if (ext === ".mov") return "video/quicktime";
    if (ext === ".webm") return "video/webm";
    if (ext === ".png") return "image/png";
    if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
    if (ext === ".pdf") return "application/pdf";
    return "application/octet-stream";
}

/**
 * One CMS row → one filed Delhivery ticket.
 *
 * Returns { ticketId, alreadyExisted, cmsStatus, delhiveryStatus }.
 * Every throw is stage-tagged (see claimFailure.STAGE) so the caller can
 * classify the failure without re-parsing the message.
 */
async function fileDelhiveryClaim(ctx, configEntry, awbNumber, tempDir, options = {}) {
    const { perClaimFiles = [], saveResource = null, saveCtx = {}, log = console } = options;

    // Step 0 — does Delhivery even have this shipment under this client?
    // Cheapest possible gate, and it runs before anything expensive: without it
    // an AWB that belongs to another credential still costs a full evidence
    // download and S3 upload before create_ticket rejects it.
    let shipment;
    try {
        // `domestic` is the row's EXPRESS/SURFACE pick. It does not choose
        // anything here — the sweep finds whichever HQ client actually holds
        // the AWB — but a disagreement with the shipment's own lane is worth
        // naming, and this is the only place both are in hand.
        shipment = await assertAwbExists(ctx, awbNumber, { domestic: configEntry.domestic });
    } catch (err) {
        throw tagStage(err, STAGE.AWB_LOOKUP);
    }
    /**
     * The claim's value, from the shipment — the way the portal does it.
     *
     * Delhivery's own form fills the amount in the moment an AWB is typed, off
     * the shipment's `cod_amount`. So the row does not carry one, nobody types
     * one, and a value somebody DID put on the row still wins: it is the only
     * case where a human has said something the shipment cannot.
     *
     * Last, Delhivery's own liability preview — for a shipment that carries
     * no value either. Asked only then, so every claim that was filed with an
     * amount before is filed with the same one now.
     */
    const claimAmount =
        configEntry.claimAmount ??
        configEntry.disputeAmount ??
        configEntry.disputedAmount ??
        shipmentAmountOf(shipment) ??
        (await liabilityPreviewAmount(ctx, awbNumber));

    log.log(
        `   📮 AWB found: ${shipment.awb_number || awbNumber}` +
        (shipment.order_number ? ` (order ${shipment.order_number})` : "") +
        (shipment.shipment_status ? ` — ${shipment.shipment_status}` : "") +
        (claimAmount ? ` — claim amount ₹${claimAmount}` : "")
    );

    // Step 1 — check for an existing claim on this AWB (dedupe).
    let existing = [];
    try {
        existing = await listLostDamageClaims(ctx, { awb: awbNumber });
    } catch (err) {
        // Non-fatal — the create_ticket call itself will reject dupes with
        // duplicate:true, so we can proceed even if the pre-check fails.
        // Still classified, because this is usually the FIRST symptom of an auth
        // or entitlement problem that will kill the upload thirty seconds later,
        // and the operator should see the diagnosis at the point it first shows.
        const d = describeClaimFailure(tagStage(err, STAGE.DEDUPE), { awb: awbNumber });
        log.warn(`   ⚠️ Pre-existing claim check failed: ${d.message}`);
    }
    const priorHit = existing.find((r) => String(r?.wbn) === String(awbNumber));
    if (priorHit) {
        // The claims list names the ticket by Delhivery's internal UUID; the
        // J-number is what the row, the seller and the status check need.
        const internalId = priorHit.jarvis_ticket_id || null;
        const publicId = internalId
            ? await resolvePublicTicketId(ctx, awbNumber, internalId).catch(() => null)
            : null;
        if (internalId && !publicId) {
            log.warn(`   ⚠️ No J-number found for ticket ${internalId} on ${awbNumber} — recording the internal id`);
        }
        const ticketId = publicId || internalId || priorHit.claim_id || null;
        const delhiveryStatus = priorHit.status || null;
        const cmsStatus = claimStatusToCmsStatus(delhiveryStatus);
        log.log(
            `ℹ️ Prior claim exists for ${awbNumber} → ${ticketId} (${delhiveryStatus} → ${cmsStatus})`
        );
        return { ticketId, alreadyExisted: true, cmsStatus, delhiveryStatus };
    }

    // Step 1b — a claim raised through Support that the claims list does not
    // show yet. Checked BEFORE anything is downloaded or uploaded, so a re-run
    // costs one call, not a second ticket. A check that fails is said and
    // passed: create_ticket still answers `duplicate: true` for a true repeat.
    try {
        const ticket = await findClaimTicketByAwb(ctx, awbNumber);

        if (ticket) {
            const cmsStatus = mapTicketStatus(ticket.ticketStatus);
            log.log(
                `ℹ️ Claim ticket already raised for ${awbNumber} → ${ticket.publicTicketId} ` +
                `(${ticket.category}, ${ticket.ticketStatus || "status unknown"})`
            );
            return {
                ticketId: ticket.publicTicketId,
                alreadyExisted: true,
                cmsStatus,
                delhiveryStatus: ticket.ticketStatus || null,
            };
        }
    } catch (err) {
        const d = describeClaimFailure(tagStage(err, STAGE.DEDUPE), { awb: awbNumber });
        log.warn(`   ⚠️ Support-ticket check failed: ${d.message}`);
    }

    // Step 2 — download every asset locally.
    const urls = Array.isArray(configEntry.unboxingDoc) ? configEntry.unboxingDoc : [];
    const files = [];
    const seen = new Set();
    for (let i = 0; i < urls.length; i++) {
        const url = urls[i];
        if (!url || isPlaceholderUrl(url) || seen.has(url)) continue;
        seen.add(url);
        const fileName = delhiveryFilenameFor(url, i);
        let local;
        try {
            local = await downloadToFile(url, `${awbNumber}_unbox_${i}`, tempDir);
        } catch (err) {
            throw tagStage(new Error(`UPLOAD_FAILED: ${fileName} not downloaded — ${err.message}`), STAGE.EVIDENCE);
        }
        if (!local) throw tagStage(new Error(`UPLOAD_FAILED: ${fileName} not downloaded — no file returned`), STAGE.EVIDENCE);
        perClaimFiles.push(local);
        if (saveResource) {
            await saveResource({
                srcPath: local,
                companyId: saveCtx.companyId,
                companyName: saveCtx.companyName,
                awbNumber,
                filename: fileName,
            });
        }
        files.push({
            localPath: local,
            fileName,
            contentType: contentTypeFor(fileName),
        });
    }
    if (files.length === 0) {
        throw tagStage(new Error("EVIDENCE_MISSING: no unboxing docs available for this claim."), STAGE.EVIDENCE);
    }

    // Step 3 — upload to S3 via presigned URLs.
    //
    // The records, not the keys: create_ticket's `media_context` names each
    // file's key, type, size and identifier. See materializeAttachments.
    let uploaded;
    try {
        uploaded = await materializeAttachments(ctx, awbNumber, files);
    } catch (err) {
        // Re-wrap for context, but KEEP err.code: dropping it meant a genuine
        // AUTH_EXPIRED here arrived as an untagged Error and never reached the
        // caller's relogin branch, so a mid-run token expiry failed the AWB outright.
        const wrapped = new Error(`UPLOAD_FAILED: ${err.message}`);
        if (err && err.code) wrapped.code = err.code;
        if (err && err.requestId) wrapped.requestId = err.requestId;
        // Carry the gateway's own diagnostics too, or the classifier has to
        // re-parse them out of the message it just wrapped.
        if (err && err.status) wrapped.status = err.status;
        if (err && err.hqClientId) wrapped.hqClientId = err.hqClientId;
        if (err && err.wrongHqClient) wrapped.wrongHqClient = err.wrongHqClient;
        throw tagStage(wrapped, STAGE.UPLOAD);
    }
    log.log(`   📎 ${uploaded.length} attachment(s) uploaded`);

    // Step 4 — create the support ticket (the claim submit itself).
    // assertClaimSubmitEnabled inside createTicket honours DESABLE_SAVE.
    let result;
    try {
        result = await createTicket(ctx, {
            awbNumber,
            subcategory: configEntry.subcategory,
            claimType: configEntry.claimType || configEntry.typeOfClaim,
            description: configEntry.description,
            claimAmount,
            files: uploaded,
        });
    } catch (err) {
        throw tagStage(err, STAGE.SUBMIT);
    }
    log.log(`   ✅ Ticket submitted: ${result.publicTicketId || "(no public id)"}`);

    if (!result.publicTicketId) {
        const err = new Error("Ticket id not captured after submit; verify manually.");
        err.code = "TICKET_READBACK_FAILED";
        throw tagStage(err, STAGE.READBACK);
    }
    return {
        ticketId: result.publicTicketId,
        alreadyExisted: !!result.duplicate,
        cmsStatus: null,
        delhiveryStatus: null,
    };
}

// -----------------------------------------------------------------------------
// Failure recovery — did Delhivery file the ticket anyway?
// -----------------------------------------------------------------------------
// A claim can fail on OUR side after Delhivery already created the ticket: the
// submit lands but the response is lost, create_ticket answers without a public
// id, the process dies before the DB write. Reporting those as failures is
// wrong twice over — the CMS row loses a ticket that exists, and the next run
// files a duplicate claim for the same AWB.
//
// So before any failure is reported, ask Delhivery by AWB. If a ticket comes
// back, the claim succeeded and we simply did not know it.
//
// Returns null when there is no ticket, or when looking is pointless:
//   - no usable session (the lookup would fail the same way the claim did)
//   - the AWB is not on this client at all, so no ticket can exist for it
// Never throws: a failed recovery must leave the ORIGINAL error intact rather
// than replacing it with "the recovery lookup broke".
const NO_RECOVERY_CODES = new Set([
    "INVALID_CREDENTIALS",   // no working login
    "LOGIN_NO_TOKEN",
    "LOGIN_TIMEOUT",
    "AWB_NOT_FOUND",         // shipment is not on this client
]);

async function recoverTicketAfterFailure(ctx, awbNumber, failure, options = {}) {
    const { log = console } = options;

    if (NO_RECOVERY_CODES.has(failure.code)) return null;
    try {
        const found = await findTicketByAwb(ctx, awbNumber);
        if (!found) return null;
        log.log(
            `   🎟️ Recovered existing ticket for ${awbNumber}: ${found.publicTicketId}` +
            (found.ticketStatus ? ` (${found.ticketStatus})` : "") +
            (found.ticketCount > 1 ? ` — ${found.ticketCount} tickets on this AWB, took the first` : "")
        );
        return found;
    } catch (err) {
        // Expected whenever the failure was itself an auth/entitlement problem.
        log.warn(`   ⚠️ Ticket recovery lookup failed for ${awbNumber}: ${err.message}`);
        return null;
    }
}

module.exports = {
    fileDelhiveryClaim,
    recoverTicketAfterFailure,
    NO_RECOVERY_CODES,
    isPlaceholderUrl,
    downloadToFile,
    delhiveryFilenameFor,
    contentTypeFor,
};
