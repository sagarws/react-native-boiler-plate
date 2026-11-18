/**
 * @param {{ username: string, accountType?: string, loginUrl?: string }} credentials — no password:
 *        the operator types it. `accountType` picks the relationship-type modal's answer
 *        (Vendor vs Partner Seller), exactly as in the automated sign-in.
 * @param {object} [options]
 * @param {number} [options.timeoutMs=600000] how long to wait for the operator to finish
 * @param {number} [options.pollMs=2000] how often to look for the dashboard
 * @param {(message: string) => void} [options.onProgress]
 * @returns {Promise<Record<string, string>>} the cookie map, the same shape `loginMyntraApi` returns
 */
export function operatorLoginMyntra(credentials: {
    username: string;
    accountType?: string;
    loginUrl?: string;
}, { timeoutMs, pollMs, onProgress }?: {
    timeoutMs?: number;
    pollMs?: number;
    onProgress?: (message: string) => void;
}): Promise<Record<string, string>>;
