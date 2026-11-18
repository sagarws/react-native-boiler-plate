/** Must this platform's manual sign-in run in the real browser? */
export function canOperatorSignIn(platform: any): boolean;
/**
 * @param {string} platform
 * @param {{ username: string, _id?: any, accountType?: string }} credentials — `accountType` answers
 *        Myntra's first-login relationship-type modal, as in the automated sign-in
 * @param {object} [options] passed to the platform's sign-in (timeoutMs, onProgress)
 * @returns {Promise<{ platform, username, jar, tokens, extra, cookieNames, durationMs }>}
 */
export function operatorSignIn(platform: string, credentials: {
    username: string;
    _id?: any;
    accountType?: string;
}, options?: object): Promise<{
    platform: any;
    username: any;
    jar: any;
    tokens: any;
    extra: any;
    cookieNames: any;
    durationMs: any;
}>;
