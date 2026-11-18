// -----------------------------------------------------------------------------
// Snapdeal — file one CMS claim over the seller-portal APIs
// -----------------------------------------------------------------------------
// The per-AWB sequence, shared by every runner:
//
//   Automated-Scripts  src/platforms/snapdeal/.../apiScriptNew.js   (server)
//   Trackvid-CMS       electron/main/services/claimProcessor        (desktop)
//
// Both need the identical sequence — resolve the AWB, refuse to re-file a
// dispute that already exists, upload the evidence, submit, read back the
// ticket id. Only the surrounding orchestration differs (the server has a
// queue, callbacks, heartbeats and a resource mirror; the desktop app has a
// socket and a local session), so that stays in the consumers.
//
// Everything the two consumers do NOT agree on is injected:
//
//   saveResource   the server mirrors every downloaded asset into its report
//                  share; the desktop app has no share. Omit it and nothing
//                  is mirrored.
//   perClaimFiles  the caller's cleanup list. Local temp paths are pushed onto
//                  it as they are created so the caller can unlink them.
//   log            defaults to console.
//
// Nothing here touches Mongo, so a consumer without the driver can run it.
// -----------------------------------------------------------------------------

const path = require("path");

const {
    globalSearchAwb,
    getSuborderCode,
    getIssueCategories,
    resolveIssueCategory,
    uploadAttachment,
    uploadVideoAttachment,
    raiseDispute,
    getDisputeIdBySuborder,
    getDisputes,
    newestDispute,
    claimStatusToCmsStatus,
} = require("./claimApiFlow.js");
const { htmlToText } = require("../common/utils.js");
const { assertClaimSubmitEnabled } = require("../../../../common/claimSubmitGuard");
const { fitAttachmentToLimit } = require("../../../../common/attachmentCompress.js");
const { uploadLimitFor } = require("../../../../common/uploadLimits.js");

/**
 * Snapdeal's own stated cap — "File is too large. Please upload maximum of 5 MB
 * files". See common/uploadLimits.js; null there would mean "no stated cap", and
 * `fitAttachmentToLimit` leaves a file alone rather than inventing a number.
 */
const MAX_UPLOAD_BYTES = uploadLimitFor("snapdeal");

/**
 * Snapdeal pads every image slot to a fixed length and fills the empty ones
 * with a URL ending in "undefined". Those are not fetchable and must not be
 * counted as evidence.
 */
function isPlaceholderImageUrl(url) {
    if (typeof url !== "string") return true;
    const trimmed = url.trim();
    if (!trimmed) return true;
    const lastSegment = trimmed.split("?")[0].split("/").filter(Boolean).pop() || "";
    return /^(undefined|null)$/i.test(lastSegment) || /^(undefined|null)$/i.test(trimmed);
}

function imageNameFromUrl(url, fallback) {
    try {
        const base = path.basename(new URL(url).pathname);
        return decodeURIComponent(base) || fallback;
    } catch (_) {
        return fallback;
    }
}

/**
 * @param opts.exactName  save as `<filename><ext>` with no timestamp. The upload
 *                        filename becomes Snapdeal's stored name, so the evidence
 *                        slots must arrive exactly as the portal spells them —
 *                        pass a directory no other claim writes into.
 */
/**
 * The source video's own filename, minus extension, made safe for a path.
 * Falls back to "unpackingVideo" when the URL has no usable name.
 */
function videoStem(url) {
    const base = imageNameFromUrl(url, "");
    const stem = path.basename(base, path.extname(base)).replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 120);
    return stem || "unpackingVideo";
}

async function downloadToFile(url, filename, tempDir, { exactName = false } = {}) {
    if (!url || !url.startsWith("http")) return null;
    const axios = require("axios");
    const fs = require("fs-extra");
    const res = await axios.get(url, { responseType: "arraybuffer", timeout: 30000 });
    const ext = path.extname(new URL(url).pathname) || ".tmp";
    const filePath = path.join(tempDir, exactName ? `${filename}${ext}` : `${filename}_${Date.now()}${ext}`);
    await fs.writeFile(filePath, res.data);
    return filePath;
}

/**
 * The dispute already on this suborder, or null. Null too when there is no
 * suborder to ask about. Throws AUTH_EXPIRED like any other call.
 */
async function findExistingDispute(ctx, subOrderId, log = console) {
    const sub = String(subOrderId ?? "").trim();
    if (!sub) return null;
    const top = newestDispute(await getDisputes(ctx, { subOrderId: sub }), sub);
    if (!top || !top.caseId) return null;
    return top;
}

/**
 * True for a submit failure that leaves it UNKNOWN whether the case was made:
 * a 5xx, or the connection dying before a response. A 4xx, a session expiry or
 * an explicit `success:false` all mean it was not.
 */
function isAmbiguousSubmitFailure(err) {
    if (!err || err.code === "AUTH_EXPIRED" || err.code === "CLAIM_SUBMIT_DISABLED") return false;
    if (err.code === "SNAPDEAL_API_ERROR") return Number(err.status) >= 500;
    return ["ECONNRESET", "ECONNABORTED", "ETIMEDOUT", "EPIPE", "ERR_NETWORK", "ESOCKETTIMEDOUT"].includes(err.code);
}

/**
 * Download every asset on one CMS row into `tempDir`.
 *
 * Snapdeal groups images by role (outer / inner / POD / product) rather than a
 * single evidence array. Each role can hold up to 2 URLs; the video is one URL.
 * Placeholder and duplicate URLs are skipped without a network call.
 *
 * Throws EVIDENCE_MISSING when nothing attachable came back — filing a dispute
 * with no images is rejected by the portal anyway, and failing here gives the
 * operator the real reason.
 */
async function materializeAttachments(configEntry, awbNumber, tempDir, options = {}) {
    const { perClaimFiles = [], saveResource = null, saveCtx = {}, log = console } = options;

    // `portal` is the filename stem the seller portal itself uses when a human
    // attaches the same evidence (verified from a manual claim capture, Aug
    // 2026): Snapdeal derives the S3 key from the uploaded filename, so these
    // names are what the reviewer sees on the dispute. `tag` stays as the
    // internal short name used in local temp paths and logs.
    const roleMap = [
        { field: "outerPackagingImage", tag: "outer", portal: "outer_packaging_packslip_image" },
        { field: "innerPackagingImage", tag: "inner", portal: "inner_packaging_image" },
        { field: "attachProductImage", tag: "product", portal: "product_image" },
        { field: "proofOfDeliveryImage", tag: "pod", portal: "POD_slip_image" },
    ];

    const localImages = []; // [{ localPath, displayName }]
    const seenUrls = new Set();

    // Snapdeal names the stored attachment after the UPLOADED filename:
    //   portal (accepted):  outer_packaging_packslip_image1_S7aea7_Query_<ts>.jpg
    //   this flow, before:  outer_packaging_packslip_image1_1789…_S7aea7_Query_<ts>.jpg
    // The timestamp the download added broke the slot name the roleMap exists
    // to send, on every claim. Exact names need a directory no other claim
    // writes into — the server shares one tempDir across a whole account batch.
    const claimDir = await require("fs-extra").mkdtemp(path.join(tempDir, "claim-"));

    for (const { field, tag, portal } of roleMap) {
        const raw = configEntry[field];
        const list = Array.isArray(raw) ? raw : (raw ? [raw] : []);
        for (let i = 0; i < list.length; i++) {
            const url = list[i];
            if (!url || isPlaceholderImageUrl(url)) continue;
            if (seenUrls.has(url)) continue;
            seenUrls.add(url);
            const name = imageNameFromUrl(url, `${tag}_${i + 1}`);
            let local;
            try {
                local = await downloadToFile(url, `${portal}${i + 1}`, claimDir, { exactName: true });
            } catch (err) {
                throw new Error(`UPLOAD_FAILED: ${name} not downloaded — ${err.message}`);
            }
            if (!local) throw new Error(`UPLOAD_FAILED: ${name} not downloaded — no file returned`);
            perClaimFiles.push(local);
            localImages.push({ localPath: local, displayName: name });
            // The S3 basename is an unreadable uuid-temp-timestamp string, so the
            // mirror is named after the CMS form field the image came from
            // instead. Snapdeal still receives the original `name`.
            if (saveResource) {
                await saveResource({
                    srcPath: local,
                    companyId: saveCtx.companyId,
                    companyName: saveCtx.companyName,
                    awbNumber,
                    filename: `${field}${list.length > 1 ? `_${i + 1}` : ""}${path.extname(local) || ""}`,
                });
            }
        }
    }

    if (localImages.length === 0) {
        throw new Error("EVIDENCE_MISSING: CMS provided no attachable images for this dispute.");
    }

    let videoLocal = null;
    const videoUrl = configEntry.unpackingVideo;
    if (videoUrl && !isPlaceholderImageUrl(videoUrl)) {
        const vname = imageNameFromUrl(videoUrl, "unpacking_video");
        try {
            // The portal uploads the video under its own filename (the capture's
            // stored key keeps the TrackVid basename, AWB included), not a
            // generic one — so does this.
            videoLocal = await downloadToFile(videoUrl, videoStem(videoUrl), claimDir, { exactName: true });
        } catch (err) {
            // Video is not always required. Warn and continue.
            log.warn(`   ⚠️ Video download failed (${vname}): ${err.message} — proceeding without video`);
        }
        if (videoLocal) {
            perClaimFiles.push(videoLocal);
            if (saveResource) {
                await saveResource({
                    srcPath: videoLocal,
                    companyId: saveCtx.companyId,
                    companyName: saveCtx.companyName,
                    awbNumber,
                    filename: `unpackingVideo${path.extname(videoLocal) || ""}`,
                });
            }
        }
    }

    log.log(`    📦 ${localImages.length} image(s) ready${videoLocal ? " + 1 video" : ""}`);
    return { localImages, videoLocal };
}

/**
 * What a return is assumed to be when Snapdeal's search does not say.
 *
 * The type this flow sent for everything until 2026-09-18. Kept as the fallback
 * rather than swapped for the other one: a guess that has filed real claims is
 * a better guess than a new one, and the search almost always answers.
 */
const DEFAULT_RETURN_TYPE = "Courier_Return";

/** The words an operator reads when Snapdeal holds no such return. */
const { SNAPDEAL_INVALID_AWB } = require("../../../../common/claimErrors");

/**
 * One CMS row → one filed dispute.
 *
 * `vocab` is a caller-owned cache ({ issueCategories: [] }) so a batch fetches
 * the issue-category list once rather than per claim. Pass the same object for
 * every claim in a run. Snapdeal serves a different list per RETURN TYPE, so
 * this fills `issueCategoriesByType` on the same object — two kinds of return
 * in one batch need two lists, and one cache would serve the first kind's ids
 * to the second.
 *
 * Returns { ticketId, alreadyExisted, cmsStatus, snapdealStatus }.
 * Throws with .code=AUTH_EXPIRED when the session died, so the caller can
 * re-login once and retry.
 */
async function fileSnapdealClaim(ctx, configEntry, awbNumber, tempDir, vocab, credentialUsername, options = {}) {
    // `perClaimFiles` is the caller's cleanup list. Taken here as well as in
    // `materializeAttachments` because the shrunk copies are made in THIS
    // function, and a temp file nobody records is a temp file nobody deletes.
    const { log = console, perClaimFiles = [] } = options;

    // Step 1 — resolve the AWB to a return line item on this account. The
    // suborder on the CMS row is handed over as the fallback search term: when
    // the AWB search errors (Snapdeal answers a term its edge dislikes with
    // HTTP 800) or matches nothing (blank or re-issued AWB on the row), the
    // portal's "Suborder Id" option still finds the return. Skipped entirely
    // when the row has no suborder — see globalSearchAwb.
    const { found, item, alreadyDisputed, disputeId, matchedBy, returnType } = await globalSearchAwb(
        ctx,
        awbNumber,
        { subOrderId: configEntry.subOrderNumber }
    );

    if (!found) {
        // A disputed return LEAVES globalSearch: the capture shows the same
        // suborder answering with an empty returnsList seconds after the portal
        // raised its dispute. So "not found" is also what an ALREADY-FILED claim
        // looks like, and the case is only visible through getDisputes. Asking
        // there first turns a false "Wrong awb number" into the real ticket.
        const existing = await findExistingDispute(ctx, configEntry.subOrderNumber, log);
        if (existing) {
            const cmsStatus = claimStatusToCmsStatus(existing.status || null);
            log.log(
                `ℹ️  ${awbNumber} is no longer in search — already disputed as ${existing.caseId} ` +
                `(snapdealStatus=${existing.status || "?"} → ${cmsStatus})`
            );
            return { ticketId: String(existing.caseId), alreadyExisted: true, cmsStatus, snapdealStatus: existing.status || null };
        }
        // The account that was searched rides on the error rather than in the
        // message: the Script Error column is narrow and is matched on, and
        // "which login" belongs in the log, which already says it.
        const notFound = new Error(SNAPDEAL_INVALID_AWB);

        notFound.code = "NO_RETURN_PACKETS";
        notFound.detail = `no return under ${awbNumber} on ${credentialUsername || "unknown"}`;
        log.warn(`   ⚠️ ${SNAPDEAL_INVALID_AWB} — ${notFound.detail}`);

        throw notFound;
    }
    if (matchedBy === "suborder") {
        log.log(`    ↩️  AWB search did not resolve ${awbNumber} — matched on suborder ${configEntry.subOrderNumber}`);
    }
    if (alreadyDisputed && disputeId) {
        // Already filed. Report the real state (Approved / Rejected /
        // in-progress) rather than a blind Success.
        // Dispute state only — `statusOfItem` (DELIVERED / OFD / ...) is the
        // PACKET's state and never maps to a CMS claim status, so it is logged
        // for context but kept out of claimStatusToCmsStatus.
        const snapdealStatus =
            item?.disputeStatus || item?.caseStatus || item?.status || null;
        const itemStatus = item?.statusOfItem || null;
        const cmsStatus = claimStatusToCmsStatus(snapdealStatus);
        log.log(
            `ℹ️  Dispute already exists for ${awbNumber} → ${disputeId} ` +
            `(snapdealStatus=${snapdealStatus || "?"} → ${cmsStatus}` +
            `${itemStatus ? `, packet=${itemStatus}` : ""})`
        );
        return { ticketId: disputeId, alreadyExisted: true, cmsStatus, snapdealStatus };
    }

    // Suborder code is required for /returns/raiseDispute. Prefer the one on
    // the CMS row (it was written when the return was created); fall back to
    // whatever globalSearch returned.
    const suborderCode = configEntry.subOrderNumber || getSuborderCode(item);
    if (!suborderCode) {
        throw new Error(
            `NO_SUBORDER_CODE: could not resolve a suborderCode for ${awbNumber} — CMS is missing subOrderNumber and globalSearch did not return one`
        );
    }

    /**
     * Step 2 — the issue category, from the vocabulary for THIS kind of return.
     *
     * Both the lookup and the dispute used to say `Courier_Return` whatever the
     * packet was. The portal sends the return's own type, and a manual claim
     * Snapdeal accepted carried `Buyer_Return` — while every automated one
     * came back 502. The vocabulary is per type too, so asking for the wrong
     * list can file under an id that means something else.
     *
     * Cached per type, not once: two returns of different kinds in one batch
     * need two vocabularies, and one cache would serve the first kind's ids to
     * the second.
     */
    const disputeReturnType = returnType || DEFAULT_RETURN_TYPE;

    if (returnType && returnType !== DEFAULT_RETURN_TYPE) {
        log.log(`    ↩️ ${awbNumber} is a ${returnType} — using its own issue list`);
    }

    // Keyed by type, beside the caller's existing `issueCategories` rather than
    // instead of it: both runners hand in `{ issueCategories: [] }`, and
    // changing that shape would mean changing them in lockstep for no gain.
    if (!vocab.issueCategoriesByType) vocab.issueCategoriesByType = {};

    if (
        !vocab.issueCategoriesByType[disputeReturnType] &&
        disputeReturnType === DEFAULT_RETURN_TYPE &&
        Array.isArray(vocab.issueCategories) &&
        vocab.issueCategories.length > 0
    ) {
        vocab.issueCategoriesByType[disputeReturnType] = vocab.issueCategories;
    }

    if (!vocab.issueCategoriesByType[disputeReturnType]) {
        const list = await getIssueCategories(ctx, disputeReturnType);

        vocab.issueCategoriesByType[disputeReturnType] = list;
        // Kept in step for a caller that reads it — the default type's list is
        // what `issueCategories` has always meant.
        if (disputeReturnType === DEFAULT_RETURN_TYPE) vocab.issueCategories = list;
    }

    const issue = resolveIssueCategory(
        configEntry.typeOfClaim,
        vocab.issueCategoriesByType[disputeReturnType]
    );

    // Step 3 — download every asset locally, then upload to Snapdeal.
    const { localImages, videoLocal } = await materializeAttachments(configEntry, awbNumber, tempDir, options);

    const imageUrls = [];
    const uploadedUrlSet = new Set();
    for (const img of localImages) {
        /*
         * UNDER SNAPDEAL'S 5MB BEFORE IT IS OFFERED, not after it is refused.
         *
         * "File is too large. Please upload maximum of 5 MB files" failed the
         * whole claim, having already downloaded every asset — and 5MB is low
         * enough that an ordinary phone photo trips it, so this is not the rare
         * case the Meesho video cap was.
         *
         * The ORIGINAL is what `saveResource` has already mirrored, so the
         * archive keeps full quality and only the copy Snapdeal receives is cut
         * down. A file that cannot be shrunk is still offered: the upload
         * reports the marketplace's own refusal, which says more than refusing
         * it here would.
         */
        const fitted = await fitAttachmentToLimit(img.localPath, {
            maxBytes: MAX_UPLOAD_BYTES,
            tempDir,
            logger: log,
        }).catch((err) => ({ path: img.localPath, compressed: false, reason: err.message }));

        if (fitted.compressed) perClaimFiles.push(fitted.path);
        else if (fitted.reason) log.warn?.(`   ⚠️ ${img.displayName} — ${fitted.reason}`);

        let s3;
        try {
            s3 = await uploadAttachment(ctx, fitted.path);
        } catch (err) {
            throw new Error(`UPLOAD_FAILED: ${img.displayName} not uploaded — ${err.message}`);
        }
        if (!s3) {
            throw new Error(`UPLOAD_FAILED: ${img.displayName} not uploaded — no url returned`);
        }
        // Defensive: Snapdeal handing back an already-used URL would silently
        // duplicate the photo in the dispute. Refuse rather than submit it.
        if (uploadedUrlSet.has(s3)) {
            throw new Error(`UPLOAD_FAILED: ${img.displayName} not uploaded — Snapdeal returned a duplicate url`);
        }
        uploadedUrlSet.add(s3);
        imageUrls.push(s3);
    }

    let videoUrl = "";
    if (videoLocal) {
        // The same cap, and the video is the attachment most certain to be over
        // it: 5MB is a few seconds of phone footage.
        const fitted = await fitAttachmentToLimit(videoLocal, {
            maxBytes: MAX_UPLOAD_BYTES,
            tempDir,
            logger: log,
        }).catch((err) => ({ path: videoLocal, compressed: false, reason: err.message }));

        if (fitted.compressed) perClaimFiles.push(fitted.path);
        else if (fitted.reason) log.warn?.(`   ⚠️ unpacking video — ${fitted.reason}`);

        try {
            videoUrl = await uploadVideoAttachment(ctx, fitted.path);
        } catch (err) {
            // Same reasoning as the download step: video is not always required.
            log.warn(`   ⚠️ Video upload failed: ${err.message} — proceeding without video`);
            videoUrl = "";
        }
    }

    log.log(`    📎 ${imageUrls.length} image(s) uploaded${videoUrl ? " + video" : ""}`);

    // Step 4 — file the dispute. Snapdeal accepts issueType (int) and
    // issueType_desc (label). Send both so the payload works whether the
    // portal keys on the id or the label.
    const description = htmlToText(configEntry.description || "");
    // The one irreversible call — the dispute form is filled and the evidence
    // uploaded by this point.
    assertClaimSubmitEnabled("Snapdeal", "raise dispute");

    let raiseRes;
    try {
        raiseRes = await raiseDispute(ctx, {
            suborderCode,
            issueType: issue.id,
            issueType_desc: issue.label,
            description,
            imageUrls,
            videoUrl,
            returnType: disputeReturnType,
        });
    } catch (err) {
        if (!isAmbiguousSubmitFailure(err)) throw err;
        // A 5xx or a dropped connection does not say whether the case was
        // created — a gateway can fail AFTER the backend committed. Search found
        // this return undisputed moments ago, so any case on the suborder now is
        // this submit's. Look before reporting a failure: a "Failed" here would
        // send the operator to file it a second time. Never retried blindly.
        let existing = null;
        try {
            existing = await findExistingDispute(ctx, suborderCode, log);
        } catch (checkErr) {
            err.message += ` | could not check whether the dispute was created (${checkErr.message}) — verify on Snapdeal before retrying`;
            throw err;
        }
        if (!existing) {
            err.message += " | checked: no dispute was created, safe to retry";
            throw err;
        }
        log.warn(`   ⚠️ Raise dispute answered ${err.status || err.code} but the case exists — ${existing.caseId}`);
        return { ticketId: String(existing.caseId), alreadyExisted: false, cmsStatus: null, snapdealStatus: existing.status || null };
    }
    log.log(`    ✅ Dispute submitted for ${awbNumber}`);

    // Step 5 — the ticket id. raiseDispute returns it directly as `caseId`
    // (verified), so the getDisputes readback is only a fallback for the case
    // where a future response shape drops it. Trusting the submit response
    // also avoids losing a successfully-filed claim to a readback hiccup.
    let ticketId = raiseRes && raiseRes.caseId ? String(raiseRes.caseId) : null;
    if (ticketId) {
        log.log(`    🎫 caseId from raiseDispute: ${ticketId}`);
    } else {
        try {
            ticketId = await getDisputeIdBySuborder(ctx, suborderCode);
        } catch (err) {
            log.warn(`   ⚠️ Ticket readback failed: ${err.message}`);
        }
    }
    if (!ticketId) {
        const err = new Error("Ticket id not captured after submit; verify manually.");
        err.code = "TICKET_READBACK_FAILED";
        throw err;
    }
    // A dispute we just filed is, by definition, freshly in review on
    // Snapdeal. Left null so the sweep reads the real state on its own
    // schedule rather than this run asserting one.
    return { ticketId, alreadyExisted: false, cmsStatus: null, snapdealStatus: null };
}

module.exports = {
    fileSnapdealClaim,
    materializeAttachments,
    findExistingDispute,
    isAmbiguousSubmitFailure,
    isPlaceholderImageUrl,
    imageNameFromUrl,
    downloadToFile,
};
