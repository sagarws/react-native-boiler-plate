/**
 * One look at the page: click AJIO if the picker is up.
 *
 * @returns {Promise<"clicked"|"absent"|"no-option">} never throws
 */
export function clickAjioSalesChannel(page: any): Promise<"clicked" | "absent" | "no-option">;
/**
 * Wait briefly for the picker and answer it when it appears.
 *
 * A near no-op for an account without one: it returns as soon as
 * `detectWaitMs` passes with no picker. Never throws.
 *
 * @param {object} page a Puppeteer page
 * @param {{ detectWaitMs?: number, pollMs?: number, logger?: object }} [options]
 * @returns {Promise<boolean>} true when AJIO was picked
 */
export function pickAjioSalesChannelIfShown(page: object, { detectWaitMs, pollMs, logger }?: {
    detectWaitMs?: number;
    pollMs?: number;
    logger?: object;
}): Promise<boolean>;
/**
 * From Reliance Seller Central to the AJIO seller portal.
 *
 * Accounts that are challenged with a one-time code (and multi-channel ones)
 * finish the SSO on Reliance Seller Central — sellers.relianceretail.com/scp/…
 * — instead of being sent back to seller.ajio.com. Every AJIO automation here
 * runs on seller.ajio.com (its bff_session cookie, its activeSellerProfileId),
 * so the sign-in is not done until the page is there.
 *
 * The Reliance session now exists, so opening the AJIO portal and pressing its
 * "Log in" launcher runs the OAuth round trip WITHOUT a password and lands back
 * on seller.ajio.com — the same place an unchallenged sign-in ends.
 *
 * @param {object} page a Puppeteer page signed in to Reliance Seller Central
 * @param {{ portalUrl?: string, timeoutMs?: number, logger?: object }} [options]
 * @returns {Promise<{ ok: true } | { ok: false, reasonText: string }>} never throws
 */
export function continueToAjioPortal(page: object, { portalUrl, timeoutMs, logger }?: {
    portalUrl?: string;
    timeoutMs?: number;
    logger?: object;
}): Promise<{
    ok: true;
} | {
    ok: false;
    reasonText: string;
}>;
export const DEFAULT_PORTAL_URL: "https://seller.ajio.com/ajiocommerce/";
export const HEADING: "select a sales channel";
export const CHANNEL: "AJIO";
