/**
 * Files ONE Flipkart claim by driving the seller portal's UI.
 *
 * Extracted from the automation server's runner so the desktop app can file a
 * Flipkart claim the same way. The server's version had the sequence and its
 * TrackVid write-back tangled together in one 300-line loop body, which is why
 * only the server could run it: the desktop has no `jobId`, no ScriptJob and no
 * internal-token callbacks, so it could not have called that code even though
 * the marketplace steps were exactly what it needed.
 *
 * So this function does the marketplace half and NOTHING else. It never throws,
 * never calls TrackVid, and never decides what a failure means to the business
 * — it returns a status and the caller maps it. Same shape as AJIO's
 * `raiseClaim`, for the same reason.
 *
 * THE DRIVER IS THE CALLER'S. It must already be signed in and sitting on the
 * SPF Claims page; `openSpfClaimsPage` gets it there. Both runners drive many
 * claims through one signed-in driver, so opening one here would undo that.
 */

const fs = require("fs-extra");
const {
    imageNameFromUrl,
    downloadFile,
    openSpfClaimsPage,
    openRaiseNewClaim,
    fillOrderIdAndProceed,
    fillClaimForm,
    submitClaim,
    getFlipkartTicketId,
    closeClaimDrawer,
} = require("../common/utils");
const { partitionEvidence } = require("../common/attachments.js");
const { saveClaimResource } = require("../../../../common/resourceSaver");
const { isClaimSubmitDisabled } = require("../../../../common/claimSubmitGuard");

// Errors that already say what went wrong in the operator's terms. Being tagged
// is what makes a step's catch rethrow the ORIGINAL error object — the salvage
// path below reads `.claimStatus` off it, and re-wrapping in a `new Error(...)`
// would drop that property and lose the tab hint.
const TAG_RE = /^(SPF_WINDOW_EXPIRED|NO_RETURN_PACKETS|EVIDENCE_MISSING|CLAIM_ALREADY_RESOLVED|OTP_WRONG|OTP_FETCH_FAILED|OTP_ENTRY_FAILED):\s*/i;
const STEP_WRAP_RE = /^Step \d+ \([^)]+\) failed:\s*/i;

const isTaggedError = (err) => TAG_RE.test(err?.message || "");

const cleanErrorMessage = (err) =>
    String(err?.message || err || "")
        .replace(STEP_WRAP_RE, "")
        .replace(TAG_RE, "")
        .trim();

/**
 * The Flipkart failures an operator is expected to recognise on sight.
 *
 * The stripped message reads perfectly well on its own — "14 days window to
 * claim SPF has passed" — but a claims list is scanned, not read, and two
 * failures that look similar at a glance need something to tell them apart in
 * the width of a column. A short code does that, and gives ops something to say
 * to each other that is shorter than the sentence.
 *
 * Matched against the RAW message, before the tags are stripped: the tag is
 * what identifies the failure, and it is the first thing `cleanErrorMessage`
 * removes.
 *
 * `terminal` means the claim cannot be filed AT ALL — not now, not on a retry.
 * The caller uses it to move the row to "Failed to Proceed" straight away
 * rather than letting it burn its remaining attempts on something that will
 * never work.
 */
const FAILURE_CODES = [
    {
        code: "EF1",
        match: /SPF_WINDOW_EXPIRED/i,
        // NOT terminal, deliberately — that was the instruction, and the window
        // is a property of the return rather than of this attempt. If a row
        // with EF1 should stop retrying too, this is the one word to change.
        terminal: false,
    },
    {
        code: "EF2",
        // Step 3 timed out with no product row, no expiry notice and no "no
        // return packets" banner — the packet cannot be selected, so there is
        // nothing to claim against however many times it is tried.
        match: /neither an enabled product radio/i,
        terminal: true,
    },
];

/**
 * The code for this failure, or null when it is not one of the known two.
 *
 * Matched against the TAG as well as the message: a failure that already
 * carries its operator-facing code ("FE2: TAT expired of 14 days") no longer
 * has the tag in its text, and the tag is what identifies it.
 */
const failureCode = (err) => {
    const raw = String(err?.message || err || "");
    const tag = String(err?.code || "");

    return FAILURE_CODES.find((entry) => entry.match.test(raw) || entry.match.test(tag)) || null;
};

/** Already introduces itself — "FE2: …", "ME1: …". */
const alreadyCoded = (message) => /^[A-Z]{2}\d+: /.test(message);

/**
 * The message stored on the claim: the code, then the plain sentence.
 *
 * Untagged failures are returned unchanged — a code invented for every
 * unrecognised error would be a code that means nothing.
 */
const describeFailure = (err) => {
    const known = failureCode(err);
    const message = cleanErrorMessage(err);

    return {
        // A message that already names its code is left alone: prefixing it
        // would read "EF1: FE2: …", which is one failure wearing two names.
        message: known && !alreadyCoded(message) ? `${known.code}: ${message}` : message,
        terminal: known?.terminal === true,
    };
};

const searchFor = (configEntry) => [
    configEntry.searchQuery || "spf claim",
    configEntry.searchTarget || "SPF Claims : Not Approved",
];

/**
 * Pull the claim's images down to disk. Selenium's file input takes a path, not
 * a URL, so this is unavoidable.
 *
 * A download that fails NAMES the image and fails the claim, rather than
 * submitting with evidence missing — a claim filed without its proof is worse
 * than one not filed, because it will be rejected and cannot be re-filed.
 */
async function downloadEvidence(configEntry, { tempDir, companyId, awbNumber, logger, files }) {
    let shippingPath = null;

    if (configEntry.shippingLabel) {
        const shipName = imageNameFromUrl(configEntry.shippingLabel, "shipping-label");

        try {
            shippingPath = await downloadFile(configEntry.shippingLabel, `${awbNumber}_shipping`, tempDir);
        } catch (err) {
            throw new Error(`UPLOAD_FAILED: ${shipName} not uploaded — download failed: ${err.message}`);
        }

        if (!shippingPath) {
            throw new Error(`UPLOAD_FAILED: ${shipName} not uploaded — download returned no file`);
        }

        files.push(shippingPath);
        await saveClaimResource({ srcPath: shippingPath, companyId, awbNumber, filename: shipName });
    }

    // Every image the CMS supplied, once each. No padding to a minimum count:
    // duplicating a photo shows the reviewer the same picture twice and reads
    // as filler.
    // The same partition the API flow makes, for the same reason: the portal's
    // file input is fronted by the same upload endpoint, and it takes four
    // image extensions. A video is named and left behind rather than failing
    // the claim. See ../common/attachments.js.
    const { uploadable: requested, rejected } = partitionEvidence(configEntry.evidenceImages);

    for (const entry of rejected) {
        logger.info?.(
            `    ⚠️  ${imageNameFromUrl(entry.url, "evidence")} skipped — Flipkart does not accept ` +
            `${entry.ext} files on a claim; filing with the images only`
        );
    }

    if (requested.length === 0) {
        throw new Error(
            rejected.length > 0
                ? `EVIDENCE_MISSING: this row's only evidence is ${rejected
                      .map((entry) => imageNameFromUrl(entry.url, "evidence"))
                      .join(", ")}, which Flipkart cannot accept on a claim. Attach an image.`
                : "EVIDENCE_MISSING: CMS provided no evidence images for this AWB."
        );
    }

    const seen = new Set();
    const evidencePaths = [];

    for (let i = 0; i < requested.length; i++) {
        const url = requested[i];
        const imgName = imageNameFromUrl(url, `evidence_${i + 1}`);

        // The same URL twice in the CMS row would attach the same photo twice.
        if (seen.has(url)) {
            logger.info?.(`    ℹ️  ${imgName} listed twice in CMS — attaching once`);
            continue;
        }

        seen.add(url);

        let local;

        try {
            local = await downloadFile(url, `${awbNumber}_evidence_${i}`, tempDir);
        } catch (err) {
            throw new Error(`UPLOAD_FAILED: ${imgName} not uploaded — download failed: ${err.message}`);
        }

        if (!local) {
            throw new Error(`UPLOAD_FAILED: ${imgName} not uploaded — download returned no file`);
        }

        evidencePaths.push(local);
        files.push(local);
        await saveClaimResource({ srcPath: local, companyId, awbNumber, filename: imgName });
    }

    logger.info?.(`    📦 ${evidencePaths.length} evidence image(s) ready (no duplicates)`);

    return { shippingPath, evidencePaths };
}

/**
 * After a failure, look for a ticket this AWB may already have.
 *
 * Step 3 times out when the order already carries a claim — from an earlier run
 * or a manual submission — and reporting that as "Failed" would send someone to
 * file a duplicate. Flipkart marks the resolved state on the order-id modal, so
 * the tab to search is read from there BEFORE navigating away.
 *
 * @returns {{ticketId: string|null, tab: string, tabLabel: string}}
 */
async function salvageExistingTicket(driver, configEntry, err, { awbNumber, logger }) {
    let tab = "PROCESSING";
    let tabLabel = "Processing";

    // Two ways in: Step 3 recognised the chip and tagged the error with
    // { tab, label } — no scrape needed — or it raced out with no signal and
    // the chip is still on screen.
    const preDetected = err.claimStatus || null;
    const racedOut = /Step 3.*(neither an enabled product radio|Wait timed out)/i.test(err.message || "");

    if (!preDetected && !racedOut) return { ticketId: null, tab, tabLabel };

    if (preDetected) {
        tab = preDetected.tab;
        tabLabel = preDetected.label;
        logger.info?.(`🔎 Existing '${tabLabel}' claim on ${awbNumber} — fetching its ticket from the ${tab} tab...`);
    } else {
        logger.info?.(`🔎 Step 3 raced out — checking claims list for existing ticket on ${awbNumber}...`);

        try {
            const status = await driver.executeScript(`
                const root = document.querySelector('.dialog-focus-trap') || document;
                const nodes = root.querySelectorAll('[type="error"], [type="success"]');
                for (const n of nodes) {
                    const t = (n.textContent || '').replace(/\\s+/g, ' ').trim();
                    if (/^Not Approved$/i.test(t)) return { tab: 'REJECTED', label: 'Not Approved' };
                    if (/^Claim Approved$/i.test(t)) return { tab: 'APPROVED', label: 'Approved' };
                }
                return null;
            `);

            if (status) {
                tab = status.tab;
                tabLabel = status.label;
                logger.info?.(`   ↳ Detected '${status.label}' status — will search ${status.tab} tab`);
            }
        } catch (_) { /* fall back to PROCESSING */ }
    }

    // Close the modal first, then navigate. If that fails the caller reports
    // the original failure, which is the honest answer.
    try { await closeClaimDrawer(driver); } catch (_) { /* noop */ }

    try {
        await openSpfClaimsPage(driver, ...searchFor(configEntry));

        return { ticketId: await getFlipkartTicketId(driver, awbNumber, { tab, tabLabel }), tab, tabLabel };
    } catch (salvageErr) {
        logger.warn?.(`⚠️ Ticket salvage failed for ${awbNumber}: ${salvageErr.message}`);

        return { ticketId: null, tab, tabLabel };
    }
}

/**
 * File one claim.
 *
 * @param {object} driver  signed in, on the SPF Claims page
 * @param {object} configEntry  the claim's config — see the server's runner header
 * @param {object} options
 * @param {{username: string}} options.credentials
 * @param {string} options.tempDir   where downloaded evidence goes
 * @param {string} [options.companyId] for the debug resource saver
 * @param {(driver: object, awb: string, kind: string) => Promise<void>} [options.onFailure]
 *        Called before recovery — the server saves a screenshot here.
 * @returns {Promise<{status: string, ticketId: string|null, cmsStatus: string|null, message: string}>}
 *          status: 'success' | 'help_center_failed' | 'salvaged' | 'dry_run' | 'failed'
 */
async function fileFlipkartClaimByScript(driver, configEntry, options = {}) {
    const { credentials, tempDir, companyId = null, logger = console, onFailure = null } = options;
    const awbNumber = configEntry.awbNumber || configEntry.orderId || "unknown";

    // Partial downloads from a failed claim would otherwise sit in the temp dir
    // until the whole batch ends, and a later claim could pick up a stale path.
    const files = [];

    try {
        const { shippingPath, evidencePaths } = await downloadEvidence(configEntry, {
            tempDir,
            companyId,
            awbNumber,
            logger,
            files,
        });

        try {
            await openRaiseNewClaim(driver, configEntry.claimArea);
        } catch (err) {
            if (isTaggedError(err)) throw err;
            throw new Error(`Step 2 (Raise New Claim dropdown) failed: ${err.message}`);
        }

        try {
            await fillOrderIdAndProceed(driver, configEntry.orderId, { username: credentials?.username });
        } catch (err) {
            if (isTaggedError(err)) throw err;
            throw new Error(`Step 3 (Order ID modal) failed: ${err.message}`);
        }

        try {
            await fillClaimForm(driver, {
                shippingLabel: shippingPath,
                issueArea: configEntry.issueArea,
                issueType: configEntry.issueType,
                description: configEntry.description,
                evidenceImages: evidencePaths,
            });
        } catch (err) {
            if (isTaggedError(err)) throw err;
            throw new Error(`Step 4 (Fill claim form) failed: ${err.message}`);
        }

        // Everything up to here is reversible; this is not. DISABLE_SUBMIT
        // walks the whole claim and stops on the doorstep, so a dry run proves
        // the form filled correctly without filing anything.
        if (isClaimSubmitDisabled()) {
            logger.info?.(`🧪 [flipkart/script] submit disabled — form filled for ${awbNumber}, nothing filed`);

            try { await closeClaimDrawer(driver); } catch (_) { /* noop */ }

            return {
                status: "dry_run",
                ticketId: null,
                cmsStatus: null,
                message: "CLAIM_SUBMIT_DISABLED: the form was filled but not submitted",
            };
        }

        try {
            await submitClaim(driver);
        } catch (err) {
            if (isTaggedError(err)) throw err;
            throw new Error(`Step 5 (Submit) failed: ${err.message}`);
        }

        // Best-effort: Flipkart does not reliably return a claim id in the
        // post-submit response. A miss is NOT a failed claim — it is a filed
        // claim whose number we could not read — so it is reported separately.
        let ticketId = null;

        try {
            ticketId = await getFlipkartTicketId(driver, configEntry.awbNumber);
        } catch (_) {
            ticketId = null;
        }

        logger.info?.(`   🎫 Ticket id captured: ${ticketId || "<none>"}`);

        if (ticketId) {
            return { status: "success", ticketId, cmsStatus: null, message: `Flipkart claim raised (${ticketId})` };
        }

        return {
            status: "help_center_failed",
            ticketId: null,
            cmsStatus: null,
            message: "Ticket id not captured after submit; verify manually.",
        };
    } catch (err) {
        const { message, terminal } = describeFailure(err);

        logger.error?.(`❌ Error processing Flipkart claim ${awbNumber}: ${message}`);

        if (onFailure) await onFailure(driver, awbNumber, "awb_failed").catch(() => {});

        const salvaged = await salvageExistingTicket(driver, configEntry, err, { awbNumber, logger });

        if (salvaged.ticketId) {
            // Which tile it was found on IS the claim's status — a ticket on
            // the REJECTED tile is not a success just because we found it.
            const cmsStatus =
                salvaged.tab === "REJECTED" ? "Rejected" : salvaged.tab === "APPROVED" ? "Approved" : "Success";

            logger.info?.(`   ✅ Salvaged existing ticket ${salvaged.ticketId} for ${awbNumber} — reporting ${cmsStatus}`);

            return {
                status: "salvaged",
                ticketId: salvaged.ticketId,
                cmsStatus,
                message: `An existing ${salvaged.tabLabel} claim was already on this order (${salvaged.ticketId})`,
            };
        }

        // `terminal` travels with the failure so the runner can move the row to
        // "Failed to Proceed" now, instead of letting it spend its remaining
        // attempts on something that cannot succeed.
        return { status: "failed", ticketId: null, cmsStatus: null, message, terminal };
    } finally {
        // Whatever happened, leave the driver on a clean SPF list so the next
        // claim starts from a known place — and take this claim's temp files
        // with us.
        for (const path of files) {
            try { fs.removeSync(path); } catch (_) { /* ignore */ }
        }

        try { await closeClaimDrawer(driver); } catch (_) { /* noop */ }

        try {
            await openSpfClaimsPage(driver, ...searchFor(configEntry));
        } catch (navErr) {
            logger.warn?.(`⚠️ Recovery navigation failed: ${navErr.message}`);
        }
    }
}

module.exports = {
    fileFlipkartClaimByScript,
    isTaggedError,
    cleanErrorMessage,
    describeFailure,
    FAILURE_CODES,
};
