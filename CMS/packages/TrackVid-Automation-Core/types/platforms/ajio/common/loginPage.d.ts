/**
 * @param {object} page          a live Puppeteer page
 * @param {object} credentials   { username, password, loginUrl? }
 * @param {object} [options]
 * @param {object} [options.logger]   anything with debug/info/warn
 * @param {number} [options.timeoutMs] how long to wait for the SSO outcome
 * @param {Function|null} [options.fetchOtp] where a one-time code is read when
 *        the account is challenged — undefined → the server's mailbox, null → none.
 *        See ./mfa.js. `otpMailDelayMs`, `otpResends` and `otpWaitMs` go with it.
 * @returns {Promise<{ ok: true }>} the page is signed in and still open
 * @throws  an Error tagged `code = "INVALID_CREDENTIALS"` when AJIO says the
 *          credentials are wrong, so a caller can mark the credential rather
 *          than retrying it forever.
 */
export function loginAjioPage(page: object, credentials: object, { logger, timeoutMs, fetchOtp, otpMailDelayMs, otpResends, otpWaitMs }?: {
    logger?: object;
    timeoutMs?: number;
    fetchOtp?: Function | null;
}): Promise<{
    ok: true;
}>;
export const DEFAULT_LOGIN_URL: "https://seller.ajio.com/ajiocommerce/";
