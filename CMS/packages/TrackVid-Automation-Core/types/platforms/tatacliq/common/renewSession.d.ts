/**
 * Sign in to Tata CliQ and return the harvested jar plus the slave list.
 *
 * @param {{ username: string, password: string }} credentials
 * @param {object} [options]
 * @param {boolean} [options.headless]
 * @param {Function} [options.fetchOtp] where the code comes from. Defaults to
 *        this mailbox over IMAP — which is what the SERVER has. The desktop app
 *        passes its own (it asks TrackVid), because shipping mailbox
 *        credentials to an operator's machine would hand out an inbox that
 *        serves every seller.
 * @param {number} [options.otpWaitMs] how long to wait for the code; see
 *        loginTataCliq.
 * @param {Function} [options.fetchCloudflareOtp] reads the Cloudflare Access
 *        code; see loginTataCliq.
 * @returns {Promise<{ jar: Array, cookieNames: string[], slaves: Array }>}
 *   `slaves` is TOP-LEVEL, not nested under `extra`: common/renewSession.js
 *   builds its `extra` from the fields it finds on this result, so anything
 *   nested is dropped — the bug its own comment records Meesho's supplierId
 *   hitting. AJIO returns `pobIds` the same way.
 */
export function loginTataCliqApi(credentials: {
    username: string;
    password: string;
}, options?: {
    headless?: boolean;
    fetchOtp?: Function;
    otpWaitMs?: number;
    fetchCloudflareOtp?: Function;
}): Promise<{
    jar: any[];
    cookieNames: string[];
    slaves: any[];
}>;
