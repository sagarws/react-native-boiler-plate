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
export function fileDelhiveryClaimByScript(driver: object, configEntry: object, unboxingPaths?: string[], options?: {
    log?: object;
}): Promise<{
    ticketId: string | null;
    tab: string | null;
    cmsStatus: string | null;
    priorClaim: boolean;
}>;
/**
 * The ticket Delhivery already holds for this waybill, when its drawer says one
 * exists.
 *
 * Throws the ORIGINAL notice when nothing is found: the portal's own sentence
 * ("a previous claim for this issue wasn't approved…") is the complete reason,
 * and replacing it with "the lookup found nothing" would lose the half that
 * says what happened.
 */
export function recoverPriorTicket(driver: any, awbNumber: any, noticeErr: any, rawLog: any): Promise<{
    ticketId: any;
    tab: string;
}>;
/**
 * Which tab a ticket was found under, as a CMS status.
 *
 * Resolved means Delhivery approved it; Closed means it refused. The Open tab
 * says only that the claim exists, which is not a verdict — so it maps to
 * nothing and the row keeps whatever status it had.
 */
export function cmsStatusForTab(tab: any): "Approved" | "Rejected";
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
export function asLog(log: any): {
    log: any;
    warn: any;
};
