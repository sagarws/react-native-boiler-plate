/**
 * Files ONE Meesho claim by driving the supplier portal's UI.
 *
 * Extracted from the automation server's runner so the desktop app can file a
 * Meesho claim the same way. The FIELD helpers were already shared — every
 * `fill*`, `select*` and `upload*` in `../common/utils` — but the three
 * functions that use them, and the handful of lines that call those, lived in
 * `src/` next to the server's callbacks and job counters. So the desktop could
 * reach every individual field and not the claim.
 *
 * This does the marketplace half and nothing else: no TrackVid write-back, no
 * job, no callbacks. It never throws — every outcome is a status, and the
 * caller decides what it means. Same shape as the AJIO, Flipkart and Nykaa
 * flows, for the same reason.
 *
 * THE PAGE IS THE CALLER'S, and it must already be signed in. Meesho's login is
 * paid once per account and the session has to persist across claims, so
 * neither runner opens a page here.
 */

const {
    fillSubOrderNumber,
    fillAwbNumber,
    selectLogisticsPartner,
    selectStateOfPacket,
    fillPacketId,
    uploadBarcodeImage,
    uploadProductImages,
    uploadReverseWaybill,
    uploadUnpackingVideo,
    fillDescription,
    uploadAttachments,
    fillCallbackNumber,
    checkSubmitButtonEnable,
    submitAction,
    navigateToClaims,
    readAlreadyRaisedTicket,
} = require("../common/utils");
const { meeshoId } = require("../../common/identifiers.js");

// ---------------------------
// 🔍 Check Sub Order Validation
// ---------------------------
// Check if sub order number is valid for current account (call after form is filled)
const checkSubOrderValidation = async (page) => {
    // Wait for validation to trigger
    await new Promise(resolve => setTimeout(resolve, 2000));

    const result = await page.evaluate(() => {
        // Search the entire document for the error message
        const bodyText = document.body.innerText || document.body.textContent || '';

        // Check if the error message exists anywhere on the page
        if (bodyText.includes('Please enter a valid sub order number')) {
            return { hasError: true, message: 'Please enter a valid sub order number' };
        }

        // Also check with specific selectors for Mui error elements
        const allElements = document.querySelectorAll('*');
        for (const el of allElements) {
            const text = el.innerText || el.textContent || '';
            if (text.trim() === 'Please enter a valid sub order number.') {
                // Check if this element or its parent has error styling
                if (el.closest('[class*="Mui-error"]') || el.closest('.MuiFormHelperText-root')) {
                    return { hasError: true, message: 'Please enter a valid sub order number' };
                }
            }
        }

        return { hasError: false, message: null };
    });

    console.log(`  🔍 Sub order validation result: ${result.hasError ? 'ERROR FOUND' : 'OK'}`);
    return result.hasError;
};

// ---------------------------
// 📝 Fill Raise Ticket Form
// ---------------------------
/**
 * @param {object} page
 * @param {object} formData
 * @param {string} tempDir  where uploaded evidence is downloaded to. The CALLER
 *        owns it: the server keeps a `tempFiles` directory beside its runner and
 *        sweeps it between jobs, while the desktop app makes a fresh one per
 *        claim and deletes it afterwards — the evidence is a customer's, and an
 *        operator's machine is not a server. A constant here could only be right
 *        for one of them.
 */
/**
 * Stop the form if Meesho says this AWB already has a ticket.
 *
 * Called twice: once just after the AWB is entered, to save filling in a form
 * that cannot be submitted, and once immediately before the submit, because the
 * verdict can arrive late and submitting is the irreversible step.
 *
 * @param {number} waitMs how long to wait for the verdict. Short on the early
 *        call — it is an optimisation. Zero on the late one, where the answer
 *        has had the whole form-fill to appear.
 */
async function stopIfAlreadyRaised(page, waitMs) {
    const raised = await readAlreadyRaisedTicket(page, { waitMs });

    if (!raised) return;

    const err = new Error(raised.message);

    err.code = "MEESHO_ALREADY_RAISED";
    err.ticketId = raised.ticketId;

    throw err;
}

const fillRaiseTicketForm = async (page, formData, tempDir) => {
    try {
        console.log("📝 Filling Raise Ticket form...");
        await new Promise(resolve => setTimeout(resolve, 3000));

        const fieldErrors = [];
        const runStep = async (label, fn) => {
            try {
                await fn();
            } catch (err) {
                console.error(`  ⚠️ ${label} failed: ${err.message}`);
                fieldErrors.push(new Error(`${label}: ${err.message}`));
            }
        };

        await runStep("Sub Order Number", () => fillSubOrderNumber(page, formData.subOrderNumber));
        await runStep("AWB Number", () => fillAwbNumber(page, formData.awbNumber));

        // STOP HERE IF MEESHO ALREADY HAS A TICKET FOR THIS AWB.
        //
        // The form answers inline once the AWB is entered — "Ticket <id> has
        // already been raised for this issue". Carrying on would fill in a form
        // that cannot be submitted, or worse submit a SECOND ticket for one
        // return. The number it just showed us is the useful part: the caller
        // records it against the CMS row and closes it.
        await stopIfAlreadyRaised(page, 4000);

        // Select Logistics Partner Name for "Return/RTO product not received but marked delivered" claim type
        if (formData.courierPartner && formData.typeOfClaim === "Return/RTO product not received but marked delivered - Need Proof of Delivery") {
            await runStep("Logistics Partner Name", () => selectLogisticsPartner(page, formData.courierPartner));
        }

        await runStep("State of Packet", () => selectStateOfPacket(page, formData.stateOfPacket));
        await runStep("Packet ID", () => fillPacketId(page, formData.packetId));
        // BEFORE THE EXPENSIVE PART. Meesho's verdict often lands after the
        // 4s above — a live run reached here and then downloaded images and a
        // video for a claim that was never going to be submitted. This read
        // costs nothing and, by now, several more seconds have passed.
        await stopIfAlreadyRaised(page, 0);

        const saveCtx = { companyId: formData.companyId, awbNumber: formData.awbNumber };
        await runStep("Barcode Image", () => uploadBarcodeImage(page, formData.barcodeImage, tempDir, saveCtx));
        await runStep("Product Images", () => uploadProductImages(page, formData.productImage, tempDir, saveCtx));
        await runStep("Reverse Waybill", () => uploadReverseWaybill(page, formData.reverseWaybill, tempDir, saveCtx));
        await runStep("Unpacking Video", () => uploadUnpackingVideo(page, formData.unpackingVideo, tempDir, saveCtx));
        await runStep("Description", () => fillDescription(page, formData.description));
        await runStep("Attachments", () => uploadAttachments(page, formData.attachments, tempDir, saveCtx));
        await runStep("Callback Number", () => fillCallbackNumber(page, formData.callbackNumber));

        // THE LAST GATE, and the one that matters.
        //
        // Meesho's verdict on the AWB can land well after the field was filled —
        // by now every other field has been filled too, so several seconds have
        // passed and the message is certainly rendered if it is coming at all.
        // Checking here costs nothing and is what guarantees we never submit a
        // second ticket for a return that already has one.
        await stopIfAlreadyRaised(page, 0);

        try {
            await checkSubmitButtonEnable(page);
        } catch (submitCheckErr) {
            // A scriptProcessingError (server-side message under the AWB field —
            // e.g. "return not yet delivered, try again in 1 hour") is more
            // meaningful than any local field-fill issue, so surface it first.
            if (submitCheckErr && submitCheckErr.scriptProcessingError) {
                throw submitCheckErr;
            }
            if (fieldErrors.length > 0) {
                throw fieldErrors[0];
            }
            throw submitCheckErr;
        }

        await submitAction(page);

        console.log("✅ Raise Ticket form filled successfully!");
        return true;
    } catch (error) {
        console.error(`🚨 Fill form failed: ${error.message}`);
        throw error;
    }
};

// ---------------------------
// 🎫 Capture Ticket ID
// ---------------------------
/**
 * Capture Ticket ID from the Claims table for a given suborder number
 */
/**
 * Dismiss Meesho's product-tour bubble.
 *
 * A floater titled "Introducing update trackers" opens over My Tickets and
 * swallows the clicks underneath it, so the search that follows silently does
 * nothing. It has a Skip button with a stable `data-action`; everything else
 * about it is Tailwind classes that will churn.
 *
 * Never fatal: most sessions never see it.
 */
async function dismissTicketTour(page) {
    try {
        const skipped = await page.evaluate(() => {
            const skip =
                document.querySelector('button[data-action="skip"]') ||
                document.querySelector('button[aria-label="Skip"]');

            if (!skip) return false;

            skip.click();

            return true;
        });

        if (skipped) {
            console.log("    ✅ Dismissed the 'Introducing update trackers' tour");
            await new Promise((resolve) => setTimeout(resolve, 800));
        }
    } catch {
        /* a tour we could not close is not a reason to fail the lookup */
    }
}

/**
 * The ticket number Meesho holds for a sub-order.
 *
 * Used two ways: to read back the ticket a claim just raised, and to resolve
 * the one Meesho says already exists.
 *
 * The route is My Tickets → search by sub-order → read the first row. What
 * changed, and what broke this, is the middle step: it used to click a
 * `<p>Search by Sub Order ID</p>` label to reveal the field. That label is
 * gone — the input is simply there now, placeheld "Search by Sub Order ID or
 * Ticket ID" — so the old code bailed with "wrong page?" while looking at the
 * right page.
 */
const getMeeshoTicketId = async (page, subOrderNumber) => {
    try {
        console.log(`🔍 Navigating to My Tickets to capture Ticket ID for Suborder: ${subOrderNumber}`);

        const navigated = await page.evaluate(() => {
            const candidates = Array.from(document.querySelectorAll("a, button, div, span, p, li"));
            const tab = candidates.find((el) => {
                const t = (el.textContent || "").trim();

                return /^My Tickets/i.test(t) && el.getBoundingClientRect().width > 0;
            });

            if (!tab) return false;

            tab.scrollIntoView({ block: "center" });
            tab.click();

            return true;
        });

        if (!navigated) {
            console.warn("    ⚠️ 'My Tickets' tab not visible; trying direct URL navigation");

            try {
                const match = page.url().match(/^(https?:\/\/[^/]+\/panel\/v3\/new\/experience\/[^/]+)/);

                if (match) {
                    await page.goto(`${match[1]}/support/tickets/1`, {
                        waitUntil: "domcontentloaded",
                        timeout: 15000,
                    });
                }
            } catch (e) {
                console.warn(`    ⚠️ Direct navigation failed: ${e.message}`);
            }
        }

        await page
            .waitForFunction(() => /\/support\/tickets/.test(location.pathname), { timeout: 15000 })
            .catch(() => console.warn("    ⚠️ URL did not change to /support/tickets"));

        await new Promise((resolve) => setTimeout(resolve, 2000));
        console.log(`    📍 Current URL: ${page.url()}`);

        // Before touching the search box: the tour bubble covers it.
        await dismissTicketTour(page);

        console.log(`🔎 Filtering by Suborder ID: ${subOrderNumber}`);

        // The field itself, by placeholder — no label to click any more.
        const searchHandle = await page
            .waitForFunction(
                () => {
                    const inputs = Array.from(document.querySelectorAll('input[type="search"], input'));

                    for (const input of inputs) {
                        const placeholder = input.placeholder || "";

                        if (!/sub\s*order/i.test(placeholder)) continue;

                        const rect = input.getBoundingClientRect();

                        if (rect.width > 0 && rect.height > 0 && input.offsetParent !== null) return input;
                    }

                    return null;
                },
                { timeout: 10000, polling: 300 },
            )
            .catch(() => null);

        const searchEl = searchHandle && searchHandle.asElement();

        if (!searchEl) {
            console.warn('    ⚠️ No "Search by Sub Order ID" field on My Tickets — cannot look the ticket up');

            return null;
        }

        await searchEl.focus();

        // A filter left over from a previous claim would return the wrong row.
        if (await page.evaluate((el) => el.value, searchEl)) {
            await searchEl.click({ clickCount: 3 });
            await page.keyboard.press("Backspace");
        }

        await page.keyboard.type(String(subOrderNumber), { delay: 80 });

        const typed = await page.evaluate((el) => el.value, searchEl);

        if (typed !== String(subOrderNumber)) {
            console.warn(
                `    ⚠️ Search box holds "${typed}", not "${subOrderNumber}" — abandoning rather than reading someone else's ticket`
            );

            return null;
        }

        await page.keyboard.press("Enter");
        await new Promise((resolve) => setTimeout(resolve, 3000));

        // The results are a table on the old UI and a list of rows on the new
        // one; read whichever is present rather than insisting on either.
        const ticketId = await page.evaluate(() => {
            const digits = (text) => {
                const match = String(text || "").match(/\b(\d{6,})\b/);

                return match ? match[1] : null;
            };

            const firstRow = document.querySelector('table[aria-label="sticky table"] tbody tr');

            if (firstRow) {
                const cells = firstRow.querySelectorAll("td");

                for (const cell of cells) {
                    const found = digits(cell.innerText || cell.textContent);

                    if (found) return found;
                }
            }

            for (const row of document.querySelectorAll('[role="row"], li, tr')) {
                const found = digits(row.innerText || row.textContent);

                if (found) return found;
            }

            return null;
        });

        if (!ticketId) {
            console.warn(`⚠️ No ticket row for suborder ${subOrderNumber}`);

            return null;
        }

        console.log(`✅ Found Ticket ID: ${ticketId}`);

        return ticketId;
    } catch (err) {
        console.warn(`⚠️ Error while capturing Ticket ID: ${err.message}`);

        return null;
    }
};

// ---------------------------
// 🚀 Main Script Function with Multi-Credential Support
// ---------------------------
// enableScreenshots: boolean (optional, default: false) - if true, screenshots will be taken on errors
// screenshotNameFormat: function (optional) - receives (awb, platform, type) returns filename

/**
 * The form data a claim's config entry describes.
 *
 * Kept beside the filling rather than in each runner: the mapping from CMS
 * field names to Meesho's form is part of the sequence, and two copies of it
 * drift the moment one portal field is renamed.
 */
function toFormData(configEntry, companyId) {
    const claimReason = configEntry.typeOfClaim || "I have received damaged return";

    return {
        typeOfClaim: claimReason,
        courierPartner: configEntry?.logisticsPartnerName,
        // Upper-cased at the one point both identifiers enter this flow, which
        // covers typing them into the form AND the ticket-id lookup that reads
        // the sub-order number back off the tickets list. The API flow does the
        // same on its own way out — see platforms/meesho/common/identifiers.js.
        subOrderNumber: meeshoId(configEntry?.subOrderNumber),
        awbNumber: meeshoId(configEntry?.awbNumber),
        stateOfPacket: configEntry?.stateOfPacket,
        packetId: configEntry?.packetId,
        barcodeImage: configEntry?.barcodeImage,
        productImage: configEntry?.productImage,
        reverseWaybill: configEntry?.reverseWaybill,
        unpackingVideo: configEntry?.unpackingVideo,
        description: configEntry?.description,
        attachments: configEntry?.attachments,
        callbackNumber: configEntry?.callbackNumber,
        companyId,
    };
}

/**
 * File one claim on an already signed-in page.
 *
 * @param {object} page  Puppeteer page, signed in to the supplier portal
 * @param {object} configEntry
 * @param {object} options
 * @param {string} options.tempDir  where evidence is downloaded — the caller's,
 *        because the two runners keep theirs in different places.
 * @returns {Promise<{status: string, ticketId: string|null, message: string}>}
 *          status: 'success' | 'already_raised' | 'help_center_failed' | 'dry_run' | 'failed'
 */
async function fileMeeshoClaimByScript(page, configEntry, { tempDir, companyId = null, logger = console } = {}) {
    const awbNumber = configEntry.awbNumber;
    const formData = toFormData(configEntry, companyId);

    try {
        await navigateToClaims(page, formData.typeOfClaim);
        if (!tempDir) {
            // Said plainly rather than surfacing five times as
            // "TEMP_FILE_PATH is not defined" against individual uploads.
            throw new Error("fileMeeshoClaimByScript: tempDir is required — evidence has to download somewhere");
        }

        await fillRaiseTicketForm(page, formData, tempDir);

        const ticketId = await getMeeshoTicketId(page, formData.subOrderNumber);

        if (ticketId) {
            logger.info?.(`✅ Claim processing completed successfully for ${awbNumber}`);

            return { status: "success", ticketId, message: `Meesho ticket raised (${ticketId})` };
        }

        // The form WAS submitted and the ticket almost certainly exists upstream.
        // Neither Success (nothing to write) nor Failed (a retry would raise a
        // second ticket for the same return) — its own outcome, so somebody
        // reconciles it by hand.
        const message =
            "Form submitted on Meesho but Ticket ID could not be captured from My Tickets page";

        logger.warn?.(`⚠️ ${message} for AWB ${awbNumber}`);

        return { status: "help_center_failed", ticketId: null, message };
    } catch (err) {
        // Meesho already has a ticket for this AWB. Not a failure — the claim
        // exists, and its number is what the CMS row was missing.
        if (err && err.code === "MEESHO_ALREADY_RAISED") {
            logger.info?.(`↩️ [Meesho] ${awbNumber}: ${err.message}`);

            // PREFER THE TICKETS LIST over the number in the message.
            //
            // Both identify the same ticket, but only one of them is what the
            // rest of the system already stores: `getMeeshoTicketId` is the
            // lookup a freshly raised claim goes through, so using it here means
            // a row closed this way carries the same kind of id as every other
            // row. The inline number stays as the fallback — it is better than
            // nothing, and the search can fail for reasons that have nothing to
            // do with this claim.
            let ticketId = err.ticketId || null;

            try {
                const found = await getMeeshoTicketId(page, formData.subOrderNumber);

                if (found) {
                    if (found !== ticketId) {
                        logger.info?.(
                            `   🎫 [Meesho] tickets list says ${found} for ${formData.subOrderNumber} ` +
                            `(the form said ${ticketId || "nothing"}) — recording the list's`
                        );
                    }

                    ticketId = found;
                }
            } catch (lookupErr) {
                logger.warn?.(
                    `   ⚠️ [Meesho] could not confirm the ticket in the list (${lookupErr.message}) — ` +
                    `recording ${ticketId || "no id"} from the form`
                );
            }

            return { status: "already_raised", ticketId, message: err.message };
        }

        // DISABLE_SUBMIT stops inside `submitAction`, which throws. Reported as
        // its own outcome so a dry run does not read as a batch of failures.
        if (err && err.code === "CLAIM_SUBMIT_DISABLED") {
            logger.info?.(`🧪 [Meesho] submit disabled — form filled for ${awbNumber}, nothing submitted`);

            return { status: "dry_run", ticketId: null, message: err.message };
        }

        // The field helpers attach their own operator-facing wording; prefer it.
        const message = err?.scriptProcessingError || err?.message || "Meesho claim failed";

        logger.error?.(`❌ Error processing AWB ${awbNumber}: ${message}`);

        return { status: "failed", ticketId: null, message };
    }
}

module.exports = { fileMeeshoClaimByScript, toFormData, fillRaiseTicketForm, getMeeshoTicketId, checkSubOrderValidation };
