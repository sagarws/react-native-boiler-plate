// -----------------------------------------------------------------------------
// Myntra — file one CMS claim over the partner-portal APIs
// -----------------------------------------------------------------------------
// The per-AWB sequence, shared by every runner:
//
//   Automated-Scripts  src/platforms/myntra/.../apiScriptNew.js      (server)
//   Trackvid-CMS       electron/main/automations/platforms/myntra    (desktop)
//
// Injected because the two consumers disagree:
//   saveResource   the server mirrors downloaded assets into its report share;
//                  the desktop app has no share. Omit it and nothing is mirrored.
//   perClaimFiles  the caller's cleanup list, appended as temp files appear.
//   log            defaults to console.
//
// `tempDir` is a parameter rather than a module constant. The server writes to
// a fixed `tempFiles/` beside its own source; the desktop app uses a per-claim
// directory it removes afterwards, because the evidence is a customer's.
//
// Nothing here touches Mongo, so a consumer without the driver can run it.
// -----------------------------------------------------------------------------

const path = require("path");

const {
    fetchNewClaim,
    uploadProof,
    updateClaim,
    findTicketIdByTrackingId,
    mapIssueCategory,
    buildUpdateClaimPayload,
} = require("./claimApiFlow.js");
const { downloadFile } = require("../common/utils.js");
const { assertClaimSubmitEnabled } = require("../../../../common/claimSubmitGuard");

// Errors that already read as a sentence to an operator. Everything else gets
// the `Step N (...) failed:` prefix, which is the only context an anonymous
// stack-level error would otherwise have.
//   AUTH_EXPIRED — re-thrown so the caller can re-login once and retry.
const isSelfExplanatory = (err) =>
    !!err && (
        err.code === "AUTH_EXPIRED" ||
        err.code === "NO_VALID_CLAIM" ||
        err.code === "AWB_NOT_FOUND" ||
        err.code === "MYNTRA_API_ERROR" ||
        // Already phrased for an operator — a "Step N failed:" prefix would
        // bury the one sentence that explains it.
        err.code === "LOGIN_FORM_NOT_RENDERED"
    );

/** Download a remote proof into tempDir, upload it to Myntra, return the URL. */
async function pushProof(jar, url, label, orderId, tempDir, options = {}) {
    const { perClaimFiles = [], saveResource = null, saveCtx = {} } = options;

    const localPath = await downloadFile(url, label, tempDir);
    if (localPath && localPath !== url) perClaimFiles.push(localPath);
    if (localPath && saveResource) {
        await saveResource({
            srcPath: localPath,
            companyId: saveCtx.companyId,
            companyName: saveCtx.companyName,
            awbNumber: saveCtx.awbNumber,
            filename: `${label}${path.extname(localPath) || ""}`,
        });
    }
    return uploadProof(jar, { filePath: localPath, orderId });
}

/**
 * One AWB, end to end.
 *
 * Returns { ticketId, alreadyExisted } — `alreadyExisted` is true when Myntra
 * already held a claim for this AWB, filed by an earlier run or by hand. Never
 * files a second one.
 */
async function fileMyntraClaim(jar, configEntry, awbNumber, tempDir, options = {}) {
    const { log = console } = options;

    // Step 2 — eligibility. A ticketId here means the claim was already filed
    // (by us in a prior run, or manually) — record it, never file twice.
    let lookup;
    try {
        lookup = await fetchNewClaim(jar, configEntry.awbNumber);
    } catch (err) {
        if (isSelfExplanatory(err)) throw err;
        throw new Error(`Step 2 (Fetch claim for "${configEntry.awbNumber}") failed: ${err.message}`);
    }

    // No `if (!lookup.found)` branch: fetchNewClaim throws AWB_NOT_FOUND for
    // an empty data[] rather than returning a falsy `found` that a caller could
    // forget to test.
    if (lookup.ticketId) {
        log.log(`⏭️ Claim already exists for ${awbNumber} — ticket ${lookup.ticketId}`);
        return { ticketId: lookup.ticketId, alreadyExisted: true };
    }

    const row = lookup.row;
    const issueCategory = mapIssueCategory(configEntry.issueCategory);
    log.log(`📂 Issue category: ${configEntry.issueCategory} → ${issueCategory}`);

    // Step 3 — pull every proof off S3, push it to Myntra, collect blob URLs.
    const shippingLabelProofUrls = [];
    const productProofUrls = [];
    const videoProofUrls = [];
    try {
        if (!configEntry.shippingLabelImage) {
            throw new Error("Missing shipping label image — cannot submit Myntra claim");
        }
        const packingImages = (configEntry.productPackingImages || []).filter(Boolean);
        if (packingImages.length === 0) {
            throw new Error("No product packing images — at least one is required");
        }

        const pushOptions = { ...options, saveCtx: { ...(options.saveCtx || {}), awbNumber } };

        shippingLabelProofUrls.push(
            await pushProof(jar, configEntry.shippingLabelImage, "shipping_label", row.orderId, tempDir, pushOptions)
        );
        for (let i = 0; i < packingImages.length; i++) {
            productProofUrls.push(
                await pushProof(jar, packingImages[i], `packing_${i + 1}`, row.orderId, tempDir, pushOptions)
            );
        }
        if (configEntry.damagedVideo) {
            videoProofUrls.push(
                await pushProof(jar, configEntry.damagedVideo, "damaged_video", row.orderId, tempDir, pushOptions)
            );
        }
    } catch (err) {
        if (isSelfExplanatory(err)) throw err;
        throw new Error(`Step 3 (Upload proofs) failed: ${err.message}`);
    }

    // Step 4 — file it.
    const payload = buildUpdateClaimPayload({
        row,
        issueCategory,
        description: configEntry.additionalInfo,
        shippingLabelProofUrls,
        productProofUrls,
        videoProofUrls,
        disputedAmount: configEntry.disputedAmount,
        physicalReceivedSku: configEntry.physicalReceivedSku,
    });

    // The one irreversible call — everything above ran for real, including
    // every upload. DISABLE_SUBMIT=true stops exactly here.
    assertClaimSubmitEnabled("Myntra", "claim submit");

    let ticketId;
    try {
        ({ ticketId } = await updateClaim(jar, payload));
        log.log(`    ✅ Claim submitted — ticket ${ticketId}`);
    } catch (err) {
        if (isSelfExplanatory(err)) throw err;
        throw new Error(`Step 4 (Submit claim) failed: ${err.message}`);
    }

    // Belt and braces: if the submit response somehow carried no ticket id,
    // look it up on the tickets list before giving up.
    if (!ticketId) {
        try {
            ticketId = await findTicketIdByTrackingId(jar, configEntry.awbNumber);
        } catch (err) {
            log.warn(`⚠️ Ticket lookup fallback failed: ${err.message}`);
        }
    }
    return { ticketId: ticketId || null, alreadyExisted: false };
}

module.exports = { fileMyntraClaim, pushProof, isSelfExplanatory };
