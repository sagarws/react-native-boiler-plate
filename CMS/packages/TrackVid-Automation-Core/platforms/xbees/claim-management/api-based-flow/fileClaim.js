// -----------------------------------------------------------------------------
// Xbees — file one CMS claim over the seller-portal APIs
// -----------------------------------------------------------------------------
// The per-AWB sequence, shared by every runner:
//
//   Automated-Scripts  src/platforms/xbees/.../apiScriptNew.js   (server)
//   Trackvid-CMS       electron/main/automations/platforms/xbees (desktop)
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
    getDisputeReasons, resolveDisputeReason,
    uploadOneMedia,
    raiseDispute,
    findExistingDisputeByAwb,
    claimStatusToCmsStatus,
    PHOTO_SLOTS, VIDEO_SLOTS,
} = require("./claimApiFlow.js");

/** Xbees pads empty image slots with a URL ending in "undefined". */
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

function contentTypeFor(fileName) {
    const ext = path.extname(fileName).toLowerCase();
    if (ext === ".mp4") return "video/mp4";
    if (ext === ".mov") return "video/quicktime";
    if (ext === ".webm") return "video/webm";
    if (ext === ".png") return "image/png";
    if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
    return "application/octet-stream";
}

// Map CMS packagePhotos { Top, Right, Bottom, Left } → Xbees's own slot names.
// The mapping matches the Selenium runner's UI-side mapping.
const CMS_TO_PHOTO_SLOT = {
    Top: "PhotoProof1_Front",       // Front of parcel
    Bottom: "PhotoProof2_Back",     // Back of parcel
    Right: "PhotoProof3_RightSide",
    Left: "PhotoProof4_LeftSide",
};

/** Every slot Xbees accepts, all null. Built from the API's own slot lists so
 *  a slot added there cannot be silently dropped from the payload here. */
const emptySlots = (names) => Object.fromEntries(names.map((name) => [name, null]));

/**
 * One CMS row → one filed Xbees dispute.
 *
 * `vocab` is a caller-owned cache ({ }) so a batch fetches the reason tree once
 * rather than per claim. Pass the same object for every claim in a run.
 *
 * Returns { ticketId, alreadyExisted, cmsStatus, xbeesStatus }.
 * Throws with .code=AUTH_EXPIRED when the session died, so the caller can
 * re-login once and retry.
 */
async function fileXbeesClaim(ctx, configEntry, awbNumber, tempDir, vocab, options = {}) {
    const { perClaimFiles = [], saveResource = null, saveCtx = {}, log = console } = options;

    // Step 1 — dedupe.
    let existing = null;
    try { existing = await findExistingDisputeByAwb(ctx, awbNumber); }
    catch (err) { log.warn(`   ⚠️ Existing-dispute check failed: ${err.message}`); }
    if (existing?.disputeId) {
        const cmsStatus = claimStatusToCmsStatus(existing.status);
        log.log(`ℹ️ Prior dispute for ${awbNumber} → ${existing.disputeId} (${existing.status} → ${cmsStatus})`);
        return { ticketId: existing.disputeId, alreadyExisted: true, cmsStatus, xbeesStatus: existing.status };
    }

    // Step 2 — resolve reason/subreason against live vocabulary.
    if (!vocab.reasons) {
        vocab.reasons = await getDisputeReasons(ctx, "DTO");
    }
    const resolved = resolveDisputeReason(configEntry.disputeReason, configEntry.disputeSubReason, vocab.reasons);

    // Step 3 — download every asset locally, then upload into its labelled slot.
    const photoTempIds = emptySlots(PHOTO_SLOTS);
    const videoTempIds = emptySlots(VIDEO_SLOTS);
    const uploaderId = ctx.uploaderId || configEntry.username || "script@trackvid";

    const packagePhotos = configEntry.packagePhotos || {};
    for (const [cmsSide, url] of Object.entries(packagePhotos)) {
        if (!url || isPlaceholderUrl(url)) continue;
        const slot = CMS_TO_PHOTO_SLOT[cmsSide];
        if (!slot) continue;
        const fileName = `${awbNumber}_${cmsSide.toLowerCase()}${path.extname(new URL(url).pathname) || ".jpg"}`;
        let local;
        try { local = await downloadToFile(url, `${awbNumber}_${cmsSide}`, tempDir); }
        catch (err) { throw new Error(`UPLOAD_FAILED: ${cmsSide} photo — ${err.message}`); }
        if (!local) throw new Error(`UPLOAD_FAILED: ${cmsSide} photo — download returned no file`);
        perClaimFiles.push(local);
        if (saveResource) {
            await saveResource({
                srcPath: local, companyId: saveCtx.companyId,
                companyName: saveCtx.companyName, awbNumber, filename: fileName,
            });
        }
        try {
            const tempMediaId = await uploadOneMedia(ctx, {
                filePath: local, fileName, contentType: contentTypeFor(fileName),
                type: "image", position: slot, shippingid: awbNumber, uploaderId,
            });
            photoTempIds[slot] = tempMediaId;
            log.log(`   📎 ${cmsSide} → ${slot} (media ${tempMediaId})`);
        } catch (err) {
            throw new Error(`UPLOAD_FAILED: ${cmsSide} photo — ${err.message}`);
        }
    }

    // Videos are optional per Xbees's reason/subreason.
    const videoSources = [
        { url: configEntry.unpackingVideo || configEntry.unboxingVideo, slot: "UnboxingVideoProof1", tag: "unboxing" },
        { url: configEntry.packagingVideo, slot: "PackagingVideoProof1", tag: "packaging" },
    ];
    for (const v of videoSources) {
        if (!v.url || isPlaceholderUrl(v.url)) continue;
        const fileName = `${awbNumber}_${v.tag}${path.extname(new URL(v.url).pathname) || ".mp4"}`;
        let local;
        try { local = await downloadToFile(v.url, `${awbNumber}_${v.tag}`, tempDir); }
        catch (err) {
            log.warn(`   ⚠️ ${v.tag} video download failed: ${err.message} — skipping this slot`);
            continue;
        }
        if (!local) continue;
        perClaimFiles.push(local);
        if (saveResource) {
            await saveResource({
                srcPath: local, companyId: saveCtx.companyId,
                companyName: saveCtx.companyName, awbNumber, filename: fileName,
            });
        }
        try {
            const tempMediaId = await uploadOneMedia(ctx, {
                filePath: local, fileName, contentType: contentTypeFor(fileName),
                type: "video", position: v.slot, shippingid: awbNumber, uploaderId,
            });
            videoTempIds[v.slot] = tempMediaId;
            log.log(`   🎥 ${v.tag} → ${v.slot} (media ${tempMediaId})`);
        } catch (err) {
            log.warn(`   ⚠️ ${v.tag} video upload failed: ${err.message} — proceeding without`);
        }
    }

    const hasAnyPhoto = Object.values(photoTempIds).some(Boolean);
    if (resolved.isimage && !hasAnyPhoto) {
        throw new Error(
            `EVIDENCE_MISSING: Xbees requires photos for "${resolved.reason} / ${resolved.subReason}", none uploaded`
        );
    }

    // Step 4 — file the dispute.
    await raiseDispute(ctx, {
        awbNumber,
        disputeAmount: configEntry.disputeAmount,
        disputeReason: resolved.reason,
        disputeSubReason: resolved.subReason,
        comments: configEntry.description,
        photoTempIds,
        videoTempIds,
    });
    log.log(`   ✅ Dispute submitted for ${awbNumber}`);

    // Step 5 — readback for the dispute id. raiseDispute does not return one.
    let ticketId = null;
    try {
        const hit = await findExistingDisputeByAwb(ctx, awbNumber);
        ticketId = hit?.disputeId || null;
    } catch (err) {
        log.warn(`   ⚠️ Readback failed: ${err.message}`);
    }
    if (!ticketId) {
        const err = new Error("Ticket id not captured after submit; verify manually.");
        err.code = "TICKET_READBACK_FAILED";
        throw err;
    }
    return { ticketId, alreadyExisted: false, cmsStatus: null, xbeesStatus: null };
}

module.exports = {
    fileXbeesClaim,
    isPlaceholderUrl,
    downloadToFile,
    contentTypeFor,
    CMS_TO_PHOTO_SLOT,
};
