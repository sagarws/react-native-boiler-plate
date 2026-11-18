// -----------------------------------------------------------------------------
// Flipkart — file one CMS claim over the seller-portal APIs
// -----------------------------------------------------------------------------
// The per-AWB sequence, shared by every runner:
//
//   Automated-Scripts  src/platforms/flipkart/.../apiScriptNew.js      (server)
//   Trackvid-CMS       electron/main/automations/platforms/flipkart    (desktop)
//
// Injected because the two consumers disagree:
//   saveResource   the server mirrors downloaded assets into its report share;
//                  the desktop app has no share. Omit it and nothing is mirrored.
//   perClaimFiles  the caller's cleanup list, appended as temp files appear.
//   log            defaults to console.
//
// Nothing here touches Mongo, so a consumer without the driver can run it.
// -----------------------------------------------------------------------------

const {
    getOrderSearch,
    getProductTypes,
    getIssueTypes,
    resolveFromVocabulary,
    uploadSpfClaimFile,
    createClaimV2,
    getClaimIdFromProcessing,
    findClaim,
    searchReturnItem,
    approvedAmountOf,
    claimStatusToCmsStatus,
    ineligibilityError,
} = require("./claimApiFlow.js");
const { downloadFile, imageNameFromUrl } = require("../common/utils.js");
const { partitionEvidence } = require("../common/attachments.js");
const { assertClaimSubmitEnabled } = require("../../../../common/claimSubmitGuard");

// Evidence images are uploaded EXACTLY as the CMS supplied them — every image,
// once each, no padding. Duplicating a photo to reach a minimum count sends the
// reviewer the same picture two or three times, which reads as padding and
// weakens the claim. If an image can't be fetched or uploaded we fail the AWB by
// name instead of quietly substituting a copy.

// Default product type when the CMS row doesn't carry one. "Main Product" is
// the only bucket with a populated issue list in the captured vocabulary.
const DEFAULT_PRODUCT_TYPE = "Main Product";

/**
 * Download every remote asset for one CMS row into `tempDir`.
 *
 * Contract: EVERY image in configEntry.evidenceImages must land on disk, once.
 * No padding, no duplicates, no silent skips — a download that fails throws with
 * the offending image's name so the AWB fails loudly and the CMS row gets fixed.
 * Returns { shippingPath, evidencePaths, perClaimFiles }.
 */
async function materializeAttachments(configEntry, awbNumber, tempDir, options = {}) {
    const { perClaimFiles = [], saveResource = null, saveCtx = {}, log = console } = options;

    let shippingPath = null;
    if (configEntry.shippingLabel) {
        const name = imageNameFromUrl(configEntry.shippingLabel, "shipping-label");
        try {
            shippingPath = await downloadFile(configEntry.shippingLabel, `${awbNumber}_shipping`, tempDir);
        } catch (err) {
            throw new Error(`UPLOAD_FAILED: ${name} not uploaded — download failed: ${err.message}`);
        }
        if (!shippingPath) throw new Error(`UPLOAD_FAILED: ${name} not uploaded — download returned no file`);
        perClaimFiles.push(shippingPath);
        if (saveResource) await saveResource({
            srcPath: shippingPath,
            companyId: saveCtx.companyId,
            companyName: saveCtx.companyName,
            awbNumber,
            filename: name,
        });
    }

    // WHAT FLIPKART CAN ACTUALLY TAKE, decided before anything is downloaded.
    // Its claim upload accepts four image extensions and nothing else, so a
    // video in the row's evidence cannot be attached however many times it is
    // retried — it answered HTTP 503 from the write, three attempts running,
    // and failed the whole claim with it. The images are filed and the video is
    // named. See ../common/attachments.js.
    const { uploadable: requested, rejected } = partitionEvidence(configEntry.evidenceImages);

    for (const entry of rejected) {
        log.log(
            `    ⚠️  ${imageNameFromUrl(entry.url, "evidence")} skipped — Flipkart's claim upload ` +
            `does not accept ${entry.ext} files; filing with the images only`
        );
    }

    if (requested.length === 0) {
        throw new Error(
            rejected.length > 0
                ? `EVIDENCE_MISSING: this row's only evidence is ${rejected
                      .map((entry) => imageNameFromUrl(entry.url, "evidence"))
                      .join(", ")}, which Flipkart's claim upload cannot accept. Attach an image.`
                : "EVIDENCE_MISSING: CMS provided no evidence images for this AWB."
        );
    }

    // Same URL listed twice in the CMS row would attach the same photo twice.
    // Collapse it here so "no repeats" holds even when the source data repeats.
    const seenUrls = new Set();
    const evidencePaths = [];
    for (let i = 0; i < requested.length; i++) {
        const url = requested[i];
        const name = imageNameFromUrl(url, `evidence_${i + 1}`);
        if (seenUrls.has(url)) {
            log.log(`    ℹ️  ${name} listed twice in CMS — attaching once`);
            continue;
        }
        seenUrls.add(url);

        let local;
        try {
            local = await downloadFile(url, `${awbNumber}_evidence_${i}`, tempDir);
        } catch (err) {
            throw new Error(`UPLOAD_FAILED: ${name} not uploaded — download failed: ${err.message}`);
        }
        if (!local) throw new Error(`UPLOAD_FAILED: ${name} not uploaded — download returned no file`);
        evidencePaths.push({ path: local, name });
        perClaimFiles.push(local);
        if (saveResource) await saveResource({
            srcPath: local,
            companyId: saveCtx.companyId,
            companyName: saveCtx.companyName,
            awbNumber,
            filename: name,
        });
    }

    log.log(`    📦 ${evidencePaths.length} evidence image(s) ready (no duplicates)`);
    return { shippingPath, evidencePaths, perClaimFiles };
}

const isAuthError = (err) => Boolean(err && err.code === "AUTH_EXPIRED");

/**
 * Did Flipkart's own side fail, rather than refuse what we sent?
 *
 * The distinction decides whether a submit has to be verified before it is
 * called a failure: a 5xx may have been applied behind the gateway that
 * reported it, a 4xx never was. Read off `err.status`, which `gqlCall` attaches
 * for this.
 */
const isServerError = (err) => Number(err && err.status) >= 500;

// `log` is caller-supplied and may only have .log.
const warn = (log, message) => (log.warn || log.log).call(log, message);

/**
 * The AWB is not on the SPF order search. Say which of two very different things
 * that is: the return is on this account but Flipkart offers no SPF claim for it,
 * or the AWB is not on this account at all. The global AWB search tells them
 * apart. If that search itself fails, the original wording stands.
 */
async function notFoundError(ctx, searchId, credentialUsername, log) {
    const account = credentialUsername || "unknown";
    try {
        const { found, returns } = await searchReturnItem(ctx, searchId);
        if (found) {
            const r = returns[0];
            return new Error(
                `NOT_CLAIM_ELIGIBLE: return ${searchId} is on account ${account} ` +
                `(${r.statusText || r.status || "unknown status"}), but Flipkart lists no SPF claim option for it`
            );
        }
    } catch (err) {
        if (isAuthError(err)) throw err;
        warn(log, `    ⚠️  Global AWB search failed for ${searchId}: ${err.message}`);
    }
    // Same wording the Selenium path used, so CMS reason greps keep working.
    return new Error(`NO_RETURN_PACKETS: Wrong awb number, Not exist in account ${account}`);
}

/**
 * Before any upload or filing: does the global AWB search agree that this
 * return — this order item — is on the account we are logged into?
 *
 * A contradiction (the search finds the AWB under a different order item) stops
 * the claim. An empty or failed search does not: the order search already found
 * the item on this session, and the Returns index can lag behind it.
 */
async function assertReturnBelongsToAccount(ctx, searchId, item, credentialUsername, log) {
    let result;
    try {
        result = await searchReturnItem(ctx, searchId);
    } catch (err) {
        if (isAuthError(err)) throw err;
        warn(log, `    ⚠️  Global AWB search failed for ${searchId} — continuing on the order search: ${err.message}`);
        return;
    }
    if (!result.found) {
        warn(log, `    ⚠️  Global AWB search has no return for ${searchId} yet — continuing on the order search`);
        return;
    }
    const itemId = String(item.order_item_id || "");
    const ours = result.returns.some((r) => r.orderItemIds.length === 0 || r.orderItemIds.includes(itemId));
    if (!ours) {
        throw new Error(
            `ACCOUNT_MISMATCH: ${searchId} on account ${credentialUsername || "unknown"} belongs to order item ` +
            `${result.returns.map((r) => r.orderItemIds.join("/")).join(", ")}, not ${itemId} — not filed`
        );
    }
    log.log(`    ✅ ${searchId} confirmed on account ${credentialUsername || "unknown"} (global AWB search)`);
}

/**
 * The claim as the SPF Claims page shows it. Best effort: a failed lookup
 * returns null, except a dead session, which the caller must see.
 */
async function lookupClaim(ctx, searchId, hint, log) {
    try {
        return await findClaim(ctx, searchId, hint);
    } catch (err) {
        if (isAuthError(err)) throw err;
        warn(log, `    ⚠️  SPF claims lookup failed for ${searchId}: ${err.message}`);
        return null;
    }
}

/**
 * One CMS row → one filed claim. Returns the Flipkart claim id.
 * Throws with .code=AUTH_EXPIRED when the session died, so the caller can
 * re-login once and retry.
 *
 * approvedAmount on the result is set only for a claim Flipkart has APPROVED.
 *
 * @returns {Promise<import("./flipkartApiTypes").FiledFlipkartClaim>}
 */
async function fileFlipkartClaim(ctx, configEntry, awbNumber, tempDir, vocab, credentialUsername, options = {}) {
    const { log = console } = options;
    // Step 1 — resolve the tracking id to a claimable return line item.
    const searchId = configEntry.awbNumber || configEntry.searchQuery || configEntry.orderId;
    const { found, item, claimId } = await getOrderSearch(ctx, searchId);

    if (!found) {
        throw await notFoundError(ctx, searchId, credentialUsername, log);
    }
    if (claimId) {
        // Already filed. This subsumes the Selenium runner's whole salvage path
        // — and unlike that path we learn it BEFORE uploading anything. Report
        // the real state (Approved / Rejected / in-progress) rather than a blind
        // Success, mirroring how salvage mapped the tile it found the claim on.
        //
        // The order search only says OPEN; the claims list says which tab the
        // claim is on and what was approved, so ask it and fall back when it
        // cannot answer.
        const details = item.claim_details || {};
        const claim = await lookupClaim(
            ctx,
            searchId,
            { claimId, orderItemId: item.order_item_id, returnId: item.return_id },
            log
        );
        const flipkartStatus = (claim && claim.status) || details.claim_status || null;
        const cmsStatus = claimStatusToCmsStatus(flipkartStatus);
        const approvedAmount = approvedAmountOf(claim);
        log.log(
            `ℹ️  Claim already exists for ${awbNumber} → ${claimId} ` +
            `(status=${flipkartStatus || "?"} → ${cmsStatus}` +
            (approvedAmount !== null ? `, approved ₹${approvedAmount}` : "") +
            `)`
        );
        return {
            claimId,
            incidentId: (claim && claim.incidentId) || details.incident_id || null,
            alreadyExisted: true,
            cmsStatus,
            flipkartStatus,
            approvedAmount,
        };
    }
    if (!item.claim_eligible) {
        throw ineligibilityError(item);
    }

    // The global AWB search must agree this return is on the logged-in account
    // before anything is downloaded, uploaded or filed.
    await assertReturnBelongsToAccount(ctx, searchId, item, credentialUsername, log);

    // Step 2 — validate the CMS row's issue vocabulary against the live lists.
    // issueArea is the portal's "Issue Area" select, which is the product type.
    const productType = resolveFromVocabulary(
        configEntry.issueArea || DEFAULT_PRODUCT_TYPE,
        vocab.productTypes,
        "issueArea / product type"
    );
    if (!vocab.issueTypesByProduct[productType]) {
        vocab.issueTypesByProduct[productType] = await getIssueTypes(ctx, productType);
    }
    const issueType = resolveFromVocabulary(
        configEntry.issueType,
        vocab.issueTypesByProduct[productType],
        "issueType"
    );

    // Step 3 — upload attachments. The shipping label keeps the portal's own
    // "shipping-label" name; evidence images keep their filenames.
    const { shippingPath, evidencePaths } = await materializeAttachments(configEntry, awbNumber, tempDir, options);

    const attachments = [];
    if (shippingPath) {
        const label = imageNameFromUrl(configEntry.shippingLabel, "shipping-label");
        let uploaded;
        try {
            uploaded = await uploadSpfClaimFile(ctx, shippingPath, "shipping-label");
        } catch (err) {
            throw new Error(`UPLOAD_FAILED: ${label} not uploaded — ${err.message}`);
        }
        if (!uploaded || !uploaded.path) throw new Error(`UPLOAD_FAILED: ${label} not uploaded — no attachment path returned`);
        attachments.push(uploaded);
    }

    // Every evidence image must upload. A failure names the image and fails the
    // AWB — we never proceed with a partial set, and never re-send an earlier
    // image to make up the count.
    const uploadedPaths = new Set();
    for (const ev of evidencePaths) {
        let uploaded;
        try {
            uploaded = await uploadSpfClaimFile(ctx, ev.path);
        } catch (err) {
            throw new Error(`UPLOAD_FAILED: ${ev.name} not uploaded — ${err.message}`);
        }
        if (!uploaded || !uploaded.path) {
            throw new Error(`UPLOAD_FAILED: ${ev.name} not uploaded — no attachment path returned`);
        }
        // Defensive: Flipkart handing back an already-used attachment path would
        // silently duplicate the photo in the claim. Refuse rather than submit it.
        if (uploadedPaths.has(uploaded.path)) {
            throw new Error(`UPLOAD_FAILED: ${ev.name} not uploaded — Flipkart returned a duplicate attachment path`);
        }
        uploadedPaths.add(uploaded.path);
        attachments.push(uploaded);
    }

    const expected = (shippingPath ? 1 : 0) + evidencePaths.length;
    if (attachments.length !== expected) {
        throw new Error(`UPLOAD_FAILED: expected ${expected} attachment(s), only ${attachments.length} uploaded`);
    }
    log.log(`    📎 ${attachments.length} attachment(s) uploaded (${evidencePaths.length} evidence, all distinct)`);

    // Step 4 — file the claim. claim_id comes back null even on success, so it
    // is read from the claims list afterwards (same as the UI).
    // The one irreversible call — every attachment above is already uploaded.
    assertClaimSubmitEnabled("Flipkart", "claim submit");

    /**
     * THE MUTATION MAY LAND AND STILL ANSWER 5xx.
     *
     * Observed: `Create claim failed: HTTP 500 {"error":"Request failed with
     * status code 500","options":{"backendData":{"error":""}}}` — Flipkart's
     * own gateway relaying a failure from behind it, with an empty body where
     * the reason should be. That tells us nothing about whether the claim was
     * written, and the two possibilities need opposite handling: if it was, the
     * run must record the ticket, and a retry would file a DUPLICATE dispute on
     * the same return.
     *
     * Mutations are never blind-retried (see `gqlCall`) for exactly this
     * reason. So the error is held, the read-back below is run anyway, and
     * Flipkart is asked what exists. A claim that is there was filed; if none
     * is, the original error is thrown and the row is safe to retry.
     */
    let submitError = null;

    try {
        await createClaimV2(ctx, {
            order_id: item.order_id,
            order_item_id: item.order_item_id,
            return_id: item.return_id,
            shipment_expectation: item.shipment_expectation || "expect",
            quantity_affected: Number(configEntry.quantityAffected || item.quantity || 1),
            product_type: productType,
            issue_type: issueType,
            description: configEntry.description || "",
            attachments,
        });
        log.log(`    ✅ Claim submitted for ${awbNumber}`);
    } catch (err) {
        // A dead session could not have filed anything, and a refused payload
        // is a payload problem — both are reported as themselves.
        if (isAuthError(err) || !isServerError(err)) throw err;

        submitError = err;
        warn(
            log,
            `    ⚠️  ${err.message} — asking Flipkart whether the claim was filed before reporting it failed`
        );
    }

    // Step 5 — read the Claim ID back, the way the portal's ticket search does:
    // state counts → that state's list. Then the Processing tab directly, then
    // the order search, which carries claim_details once the claim exists.
    //
    // Claim IS filed at this point — createClaimV2 returned without error, or
    // answered 5xx and this is how we find out which. So a lookup that errors
    // must not surface as a filing failure: ops would re-file a duplicate. Only
    // a dead session is rethrown; the runner re-logs in and the retry finds the
    // claim through the order search above.
    const hint = { orderItemId: item.order_item_id, returnId: item.return_id };
    const readbacks = [
        async () => {
            const claim = await findClaim(ctx, searchId, hint);
            return claim && claim.claimId ? { claimId: claim.claimId, incidentId: claim.incidentId } : null;
        },
        async () => {
            const id = await getClaimIdFromProcessing(ctx, searchId);
            return id ? { claimId: id, incidentId: null } : null;
        },
        async () => {
            const after = await getOrderSearch(ctx, searchId);
            const details = (after.item && after.item.claim_details) || {};
            return after.claimId ? { claimId: after.claimId, incidentId: details.incident_id || null } : null;
        },
    ];

    let filed = null;
    for (const readback of readbacks) {
        try {
            filed = await readback();
        } catch (err) {
            if (isAuthError(err)) throw err;
            warn(log, `    ⚠️  Claim id readback failed for ${awbNumber}: ${err.message}`);
        }
        if (filed) break;
    }

    // Nothing on Flipkart after a 5xx submit means the claim really was not
    // written — the original error is the truth, and the row can be retried
    // without risking a duplicate.
    if (!filed && submitError) throw submitError;

    // A missing id is a read-back problem, not a filing failure, so it must NOT
    // be reported as Failed. Signal it the way the Selenium runner does: Help
    // Center Failed, verify manually.
    if (!filed) {
        const err = new Error("Ticket id not captured after submit; verify manually.");
        err.code = "TICKET_READBACK_FAILED";
        throw err;
    }

    if (submitError) {
        log.log(
            `    ✅ Claim ${filed.claimId} exists for ${awbNumber} — the 5xx was the response, not the filing`
        );
    }
    // A claim we just filed is, by definition, freshly in review on Flipkart.
    // Status left null so the sweep reads the real state on its own schedule
    // rather than this run asserting one.
    return {
        claimId: filed.claimId,
        incidentId: filed.incidentId,
        alreadyExisted: false,
        cmsStatus: null,
        flipkartStatus: null,
        approvedAmount: null,
    };
}

module.exports = {
    fileFlipkartClaim,
    materializeAttachments,
    DEFAULT_PRODUCT_TYPE,
};
