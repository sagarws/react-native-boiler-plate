/**
 * Files ONE Nykaa claim by driving the dispute portal's UI.
 *
 * Extracted from the automation server's runner so the desktop app can file a
 * Nykaa claim the same way. The steps themselves were already shared —
 * `goToMyArea`, `clickAddTicket`, `fillTicketForm` live in the platform's
 * common utils — but the three lines that call them, the CMS-to-form mapping
 * and the ticket-number capture were tangled up with the server's callbacks and
 * job counters, so only the server could run them.
 *
 * This does the marketplace half and nothing else: no TrackVid write-back, no
 * job, no callbacks. It never throws — every outcome comes back as a status and
 * the caller decides what it means. Same shape as AJIO's `raiseClaim` and the
 * Flipkart script flow, for the same reason.
 *
 * THE PAGE IS THE CALLER'S, and it must already be signed in. Nykaa's login
 * runs ONCE per account and the session has to persist across claims —
 * re-navigating to /signin while already authenticated redirects away and the
 * login iframe never appears, which is why neither runner opens a page here.
 */

const {
    goToMyArea,
    clickAddTicket,
    fillTicketForm,
    sleep,
} = require("../common/utils");
const { isClaimSubmitDisabled } = require("../../../../common/claimSubmitGuard");

const SUBMIT_SELECTOR = 'button[data-id="ticket_save"]';

/**
 * A CMS config entry in the shape `fillTicketForm` wants.
 *
 * Subject and Issue both come from `typeOfClaim` by product decision — Nykaa's
 * form asks for them separately and the claim only has the one answer.
 */
function toFormData(configEntry) {
    return {
        subject: configEntry.subject || configEntry.typeOfClaim || "",
        issue: configEntry.issue || configEntry.typeOfClaim || "",
        vendorCode: configEntry.vendorCode || "",
        skuId: configEntry.skuId || configEntry.sku || "",
        reverseAwb: configEntry.reverseAwb || configEntry.awbNumber || "",
        returnType: configEntry.returnType || "",
        emailBody: configEntry.emailBody || configEntry.emailTemplate?.body || "",
    };
}

/**
 * Read the ticket number Nykaa just created.
 *
 * Four ways, in descending order of confidence. Best-effort on purpose: a
 * number we cannot read is NOT a claim that failed — the ticket exists at Nykaa
 * either way — and treating it as a failure would invite a retry that files a
 * second one for the same return.
 *
 * NOTE the URL's long number (…/ticket/77727001513200041) is Zoho's internal
 * id, not the one anybody quotes. The displayed id is `#`-prefixed.
 */
async function readTicketNumber(page) {
    return page
        .evaluate(() => {
            // 1. The ticket-detail field: <div data-id="ticket_Id">#6339882</div>
            const idEl = document.querySelector('[data-id="ticket_Id"]');

            if (idEl) {
                const match = (idEl.textContent || "").match(/(\d{5,})/);

                if (match) return match[1];
            }

            const text = document.body.innerText || "";
            // 2. The success toast.
            const toast = text.match(/ID\s*#?\s*(\d{5,})\s*was successfully submitted/i);

            if (toast) return toast[1];

            // 3. A "Ticket Id" label anywhere in the page text.
            const labelled = text.match(/Ticket\s*Id[\s\S]{0,30}?#\s*(\d{5,})/i);

            if (labelled) return labelled[1];

            // 4. Last resort: the first "#<digits>".
            const hash = text.match(/#\s*(\d{5,})/);

            return hash ? hash[1] : null;
        })
        .catch(() => null);
}

/**
 * File one claim on an already signed-in page.
 *
 * @param {object} page  a Puppeteer page, signed in to the dispute portal
 * @param {object} configEntry  the claim's config — see the server's runner header
 * @param {object} [options]
 * @returns {Promise<{status: string, ticketId: string|null, message: string}>}
 *          status: 'success' | 'help_center_failed' | 'dry_run' | 'failed'
 */
async function fileNykaaClaimByScript(page, configEntry, { logger = console } = {}) {
    const awbNumber = configEntry.awbNumber || configEntry.reverseAwb || "unknown";

    try {
        // Already signed in — just open a fresh ticket form for this claim.
        await goToMyArea(page);
        await clickAddTicket(page);
        await fillTicketForm(page, toFormData(configEntry));

        // Everything above is reversible; this is not. DISABLE_SUBMIT walks the
        // whole form and stops on the doorstep, so a dry run proves the mapping
        // without raising anything at Nykaa.
        if (isClaimSubmitDisabled()) {
            logger.info?.(`🧪 [Nykaa] submit disabled — form filled for ${awbNumber}, nothing submitted`);

            return {
                status: "dry_run",
                ticketId: null,
                message: "CLAIM_SUBMIT_DISABLED: the form was filled but not submitted",
            };
        }

        await page.waitForSelector(SUBMIT_SELECTOR, { visible: true, timeout: 10000 });

        logger.info?.("🚀 [Nykaa] Clicking Submit...");

        await Promise.all([
            page.waitForNavigation({ waitUntil: "networkidle2", timeout: 30000 }).catch(() => {}),
            page.evaluate((selector) => {
                const button = document.querySelector(selector);

                if (button) button.click();
            }, SUBMIT_SELECTOR),
        ]);

        await sleep(4000);

        logger.info?.(`🔎 [Nykaa] After-submit URL: ${page.url()}`);

        const ticketId = await readTicketNumber(page);

        if (ticketId) {
            logger.info?.(`✅ [Nykaa] Submitted. Ticket: ${ticketId}`);

            return { status: "success", ticketId, message: `Nykaa ticket raised (#${ticketId})` };
        }

        // Submitted, number unreadable. Reported separately from a failure so
        // nobody retries it into a duplicate.
        logger.warn?.(
            `⚠️ [Nykaa] Submitted ${awbNumber} but the ticket number was not captured — verify it manually.`
        );

        return {
            status: "help_center_failed",
            ticketId: null,
            message: "The ticket was submitted but its number could not be read; verify manually.",
        };
    } catch (err) {
        logger.error?.(`❌ [Nykaa] Error for AWB ${awbNumber}: ${err.message}`);

        return { status: "failed", ticketId: null, message: err.message };
    }
}

module.exports = { fileNykaaClaimByScript, toFormData, readTicketNumber, SUBMIT_SELECTOR };
