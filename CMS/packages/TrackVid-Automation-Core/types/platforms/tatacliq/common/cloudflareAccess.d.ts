export namespace SELECTORS {
    let emailInput: string;
    let emailSubmit: string;
    let codeInput: string;
    let codeSubmit: string;
    let destination: string;
}
export const ACCESS_HOST_SUFFIX: ".cloudflareaccess.com";
/** Is this URL Cloudflare Access rather than the portal? */
export function isCloudflareAccessUrl(url: any): boolean;
/**
 * Is the page on the Access gate right now?
 *
 * The host is the signal, with the form as a backstop for a tenant served under
 * another domain — never a heading's text, which Cloudflare localises.
 */
export function isCloudflareAccessPage(page: any): Promise<any>;
/**
 * Get through the Access gate, to the seller zone.
 *
 * A no-op when the page is not on the gate, so a caller may run it after every
 * navigation without asking first.
 *
 * @param {object} page a puppeteer page
 * @param {object} options
 * @param {string} options.email the Access inbox (the credential's second identity)
 * @param {Function} options.fetchOtp `(email, since, remainingMs) => Promise<string|null>`
 * @param {number} [options.otpWaitMs]
 * @param {object} [options.logger]
 * @returns {Promise<{ passed: boolean, email?: string }>} `passed: false` when there was no gate
 */
export function passCloudflareAccess(page: object, { email, fetchOtp, otpWaitMs, logger }?: {
    email: string;
    fetchOtp: Function;
    otpWaitMs?: number;
    logger?: object;
}): Promise<{
    passed: boolean;
    email?: string;
}>;
