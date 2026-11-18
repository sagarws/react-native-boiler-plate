/**
 * Close any Meesho promo modal standing in front of the page.
 *
 * Never throws: a popup that cannot be closed must not end the run before the
 * step that would have reported something useful. Returns whether the page is
 * clear, so a caller that genuinely cannot proceed can say so.
 *
 * @param {object} page  a Puppeteer page
 * @param {{ attempts?: number, settleMs?: number, log?: object }} [options]
 * @returns {Promise<{ found: boolean, closed: boolean }>}
 */
export function dismissMeeshoPopup(page: object, { attempts, settleMs, log }?: {
    attempts?: number;
    settleMs?: number;
    log?: object;
}): Promise<{
    found: boolean;
    closed: boolean;
}>;
/**
 * Runs IN the page: finds an overlay and clicks its close control.
 *
 * Returns what it did, so the caller can log something true rather than
 * "handled". Clicking is done here, by dispatching on the element itself, for
 * the reason the master-import handler documents: React's handler may sit on
 * the img, on its wrapper, or higher up, and a co-ordinate click can land on
 * whichever of those is not listening.
 */
export function DISMISS_IN_PAGE(): {
    found: boolean;
    closed: boolean;
    how: string;
};
/** Is anything still covering the page? Same test as above, without clicking. */
export function STILL_OPEN_IN_PAGE(): boolean;
