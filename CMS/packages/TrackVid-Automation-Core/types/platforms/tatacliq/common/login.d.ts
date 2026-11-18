export const LOGIN_URL: string;
export namespace SELECTORS {
    let loginId: string;
    let password: string;
    let submit: string;
    let otpModal: string;
    let otpSubmit: string;
}
/**
 * Type the code into the modal and press its button.
 *
 * THE FALLBACK, not the path. The GET above is what the portal's own page does
 * and it is what works today — but it is one captured URL, and the day it
 * changes the run would sit in front of an OTP box it could have filled in.
 * This is what an operator would do instead, written so it survives a redesign:
 * the box is the visible text input inside the modal, the button is the thing
 * next to it whose label says submit, and neither is matched on a class name.
 *
 * @returns {Promise<boolean>} whether it found something to type into
 */
export function typeOtpIntoModal(page: any, code: any, { logger }?: {}): Promise<boolean>;
/**
 * Is the OTP modal actually on screen?
 *
 * Not `waitForSelector`: the element is in the DOM before the form is even
 * submitted, so locating it proves nothing. This asks whether it takes up space
 * and is not display:none — which is what "the portal is asking for the OTP"
 * looks like, and therefore what "the password was accepted" looks like.
 */
export function isOtpModalOpen(page: any): Promise<any>;
/**
 * Fill the form and click Login. Stops at the OTP modal.
 *
 * Exported on its own because that is exactly what credential VERIFICATION
 * wants — the modal appearing is proof the password is right, and answering the
 * OTP would burn a code for nothing.
 *
 * @returns {Promise<{ otpRequested: boolean, error: string|null }>}
 */
export function submitCredentials(page: any, { username, password }: {
    username: any;
    password: any;
}, { logger, cloudflare }?: {
    cloudflare?: any;
}): Promise<{
    otpRequested: boolean;
    error: string | null;
}>;
/**
 * Answer the OTP modal.
 *
 * The one login call that IS an API — a GET with the code in the query string.
 * Its body came back empty in the capture, so success is not read from the
 * response: the caller proves the session by using it (a slave list, or the
 * search), which is the only proof that matters.
 */
export function submitOtp(page: any, code: any, { loginId }?: {}): Promise<any>;
/**
 * Sign in, all the way to a usable session.
 *
 * @param {object} page a puppeteer page
 * @param {{ username: string, password: string }} credentials
 * @param {object} options
 * @param {Function} options.fetchOtp  `(username, since) => Promise<string|null>`
 *        — where the code comes from. On the server that reads Gmail; on the
 *        desktop it asks the operator. Required: this module does not know how
 *        to get a code and must not pretend to.
 * @param {number} [options.otpWaitMs] how long to wait for the code. Defaults
 *        to TATACLIQ_OTP_WAIT_MS (two minutes), as before.
 * @param {Function} [options.isSignedIn] `(page) => Promise<boolean>` — the
 *        caller's own proof. Given one, the login is only as done as this says;
 *        without it, submitting the OTP is treated as done and the next call
 *        finds out.
 * @param {Function} [options.fetchCloudflareOtp] `(email, since, remainingMs)
 *        => Promise<string|null>` — reads the Cloudflare Access code. Defaults
 *        to the Gmail reader when this process holds mailbox credentials
 *        (GMAIL_IMAP_USER / GMAIL_IMAP_PASSWORD, i.e. the server); otherwise
 *        there is none, and a gate fails with CLOUDFLARE_ACCESS_REQUIRED. The
 *        Access email is `credentials.cloudflareEmail`, else DEFAULT_CLOUDFLARE_EMAIL.
 * @returns {Promise<{ ok: true }>}
 */
export function loginTataCliq(page: object, credentials: {
    username: string;
    password: string;
}, { fetchOtp, isSignedIn, logger, otpWaitMs, fetchCloudflareOtp }?: {
    fetchOtp: Function;
    otpWaitMs?: number;
    isSignedIn?: Function;
    fetchCloudflareOtp?: Function;
}): Promise<{
    ok: true;
}>;
