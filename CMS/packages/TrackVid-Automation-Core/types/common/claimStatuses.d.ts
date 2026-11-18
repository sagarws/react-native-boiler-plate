export namespace CMS_STATUS {
    let PENDING: string;
    let IN_REVIEW: string;
    let UN_ATTENDED: string;
    let IN_PROGRESS: string;
    let CUSTOMER_REPLIED: string;
    let APPROVED: string;
    let REJECTED: string;
    let RESOLVED: string;
    let FAILED_TO_PROCEED: string;
    let AWAITING_SELLER_RESPONSE: string;
    let AWAITING_AGENT_RESPONSE: string;
    let PAID: string;
    let OPEN: string;
    let ON_HOLD: string;
    let CLOSED: string;
}
/**
 * The ordered status tabs for one platform.
 *
 * An unknown platform gets the base five — the same fallback the admin panel
 * uses — rather than an empty list, so a new marketplace is usable before
 * anyone has decided what its lifecycle looks like.
 *
 * @param {string} platform  platform key, any casing
 * @returns {{value: string, label: string, dot: string}[]}
 */
export function claimStatusTabs(platform: string): {
    value: string;
    label: string;
    dot: string;
}[];
/** Just the status values for a platform, without "All". */
export function claimStatusesFor(platform: any): string[];
/** Does this platform ever put a row in this status? */
export function isClaimStatusFor(platform: any, status: any): boolean;
