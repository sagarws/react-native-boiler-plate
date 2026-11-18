// -----------------------------------------------------------------------------
// Delhivery — file ONE claim by driving the portal's own drawer
// -----------------------------------------------------------------------------
// The per-AWB half of the Selenium flow, shared by both runners:
//
//   Automated-Scripts  src/platforms/delhivery/.../script-based-flow/scriptNew.js
//   Trackvid-CMS       electron/main/automations/platforms/delhivery/.../script-based-flow
//
// WHAT STAYS WITH THE CALLER. Everything that is not the drawer: the browser
// and the sign-in (session-level, once per credential), the Domestic account
// pick (session-wide — Delhivery holds it server-side), downloading the
// evidence to disk, the write-back, the callbacks and the stats. Those differ
// per runner, and the server's batching has nothing to say to the desktop's one
// claim at a time.
//
// WHY THIS IS NOT THE API FLOW'S PROBLEM TOO. The portal's drawer and its
// support API are two ways in, and they disagree about what a claim is: the
// drawer refuses an AWB whose claim window has closed, with a sentence a person
// can read, while the API takes the request and answers 200 with no ticket id.
// Keeping both is deliberate — see CLAIM_RUNNERS in each consumer.
//
// A PRIOR CLAIM IS NOT A FAILURE. Delhivery stops a second claim for a waybill
// it has already decided on, and says so in the drawer. That notice means a
// ticket EXISTS, so the sequence goes and finds it rather than reporting the
// AWB as failed — reporting it would send somebody to raise by hand the claim
// that is already there.
// -----------------------------------------------------------------------------

const {
    openRaiseTicket,
    pickShipmentIssueAndSub,
    enterAwbAndClaimType,
    uploadUnboxingDocs,
    submitClaimDrawer,
    getDelhiveryTicketId,
} = require("../common/utils");

/**
 * A logger that works whichever shape the caller has.
 *
 * THE SERVER PASSES `console`, WHICH HAS `.log`; the desktop app passes its own
 * logger, which has `.info` and no `.log` at all. This module asked for
 * console's shape and got `log.log is not a function` — thrown from inside the
 * recovery, AFTER Delhivery had told us a prior claim existed, so the one
 * outcome it exists to produce was the one it could not report.
 *
 * A shared module does not get to dictate its consumers' logger, so it takes
 * either and falls back to console. Silence is not an option here: every line
 * this writes is a step somebody is watching a browser perform.
 */
const asLog = (log) => {
    const pick = (...names) => {
        for (const name of names) {
            if (typeof log?.[name] === "function") return log[name].bind(log);
        }

        return console.log.bind(console);
    };

    return { log: pick("log", "info"), warn: pick("warn", "info", "log") };
};

/**
 * Which tab a ticket was found under, as a CMS status.
 *
 * Resolved means Delhivery approved it; Closed means it refused. The Open tab
 * says only that the claim exists, which is not a verdict — so it maps to
 * nothing and the row keeps whatever status it had.
 */
function cmsStatusForTab(tab) {
    if (tab === "resolved") return "Approved";
    if (tab === "closed") return "Rejected";

    return null;
}

/**
 * The ticket Delhivery already holds for this waybill, when its drawer says one
 * exists.
 *
 * Throws the ORIGINAL notice when nothing is found: the portal's own sentence
 * ("a previous claim for this issue wasn't approved…") is the complete reason,
 * and replacing it with "the lookup found nothing" would lose the half that
 * says what happened.
 */
async function recoverPriorTicket(driver, awbNumber, noticeErr, rawLog) {
    const log = asLog(rawLog || console);

    log.log(`   🔎 Prior claim exists for ${awbNumber} — checking for its ticket before failing...`);

    let existing = null;

    try {
        existing = await getDelhiveryTicketId(driver, awbNumber);
    } catch (lookupErr) {
        log.warn(`   ⚠️ Prior-ticket lookup failed: ${lookupErr.message}`);
    }

    if (!existing?.ticketId) {
        log.log(`   ⛔ No existing ticket found for ${awbNumber} — surfacing Delhivery's notice.`);
        throw noticeErr;
    }

    log.log(`   🎫 Existing ticket found: ${existing.ticketId} (tab=${existing.tab}) — linking it.`);

    return existing;
}

/**
 * One claim, in a browser already signed in and already on the right account.
 *
 * @param {object} driver a Selenium driver from `buildDriver`, signed in
 * @param {object} configEntry the CMS claim config — `awbNumber`, `shipmentIssue`,
 *        `subcategory`, `claimType`
 * @param {string[]} unboxingPaths LOCAL file paths; the drawer's file input
 *        takes a filesystem path, so the caller downloads first
 * @param {{ log?: object }} [options]
 * @returns {Promise<{ ticketId: string|null, tab: string|null, cmsStatus: string|null,
 *                     priorClaim: boolean }>}
 *   `ticketId` is null when the claim was submitted and the list had not caught
 *   up — the claim is filed and the number has to be found later, which is a
 *   different thing from the claim not existing.
 */
async function fileDelhiveryClaimByScript(driver, configEntry, unboxingPaths = [], options = {}) {
    const log = asLog(options.log || console);
    const awbNumber = configEntry.awbNumber || "unknown";

    // Step 1 — the modal, then the drawer. Per AWB, because the modal closes
    // itself the moment Raise Claim is clicked.
    try {
        await openRaiseTicket(driver);
    } catch (err) {
        throw new Error(`Step 1 (Open Raise a ticket) failed: ${err.message}`);
    }

    try {
        await pickShipmentIssueAndSub(driver, configEntry.shipmentIssue, configEntry.subcategory);
    } catch (err) {
        throw new Error(`Step 2 (Pick shipment issue & subcategory) failed: ${err.message}`);
    }

    /** Set when Delhivery refuses a NEW claim and the old one was found. */
    let priorTicket = null;

    // Step 3 — the AWB and the claim type.
    try {
        await enterAwbAndClaimType(driver, configEntry.awbNumber, configEntry.claimType);
    } catch (err) {
        /*
         * DELHIVERY'S OWN SENTENCE IS THE REASON. A tagged notice — the claim
         * window has closed, the AWB is not valid, a claim was already approved
         * — is passed through untouched rather than wrapped in "Step 3 failed",
         * because the row is read by somebody who has to act on it.
         */
        if (!err?.delhiveryNotice) {
            throw new Error(`Step 3 (Enter AWB & claim type) failed: ${err.message}`);
        }

        if (!err.priorClaimExists) throw err;

        priorTicket = await recoverPriorTicket(driver, awbNumber, err, log);
    }

    // Step 4 — the evidence. Skipped when a prior ticket was found: there is no
    // claim form rendered to upload into.
    if (!priorTicket) {
        try {
            await uploadUnboxingDocs(driver, unboxingPaths);
        } catch (err) {
            if (err?.priorClaimExists) {
                priorTicket = await recoverPriorTicket(driver, awbNumber, err, log);
            } else if (err?.delhiveryNotice) {
                throw err;
            } else {
                throw new Error(`Step 4 (Upload unboxing docs) failed: ${err.message}`);
            }
        }
    }

    // Step 5 — the submit. THIS is the step that files the claim.
    if (!priorTicket) {
        try {
            await submitClaimDrawer(driver);
        } catch (err) {
            throw new Error(`Step 5 (Submit) failed: ${err.message}`);
        }
    }

    /*
     * Step 6 — the ticket number, best effort.
     *
     * The tickets list takes a few seconds to show a claim just filed, so a
     * miss here is NOT a failed claim: it is a filed claim whose number has to
     * be found afterwards. Never throws for that reason.
     */
    let result = priorTicket;

    if (!result) {
        try {
            result = await getDelhiveryTicketId(driver, configEntry.awbNumber);
        } catch (_) {
            result = null;
        }
    }

    const ticketId = result?.ticketId || null;
    const tab = result?.tab || null;

    log.log(`   🎫 Ticket id captured: ${ticketId || "<none>"} (tab=${tab || "none"})`);

    return { ticketId, tab, cmsStatus: cmsStatusForTab(tab), priorClaim: Boolean(priorTicket) };
}

module.exports = { fileDelhiveryClaimByScript, recoverPriorTicket, cmsStatusForTab, asLog };
