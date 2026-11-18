/**
 * Sign-ins the OPERATOR types, in the real browser the platform's automated
 * sign-in uses — for portals that refuse any other browser.
 *
 * The desktop app's own window is Chromium, not Chrome, and a portal behind a
 * strict bot check (Myntra, behind Akamai) refuses its login request no matter
 * who types the password. For those, a "manual" sign-in has to happen in the
 * same browser the automated one drives. This is that list — a lookup, so a
 * platform is added with one entry and no caller changes.
 *
 * The result has the same shape `renewPlatformSession` returns, so a caller
 * stores either the same way.
 */

const { platformKey } = require("./platforms.js");

const SIGN_INS = {
    myntra: () => require("../platforms/myntra/common/operatorLogin.js").operatorLoginMyntra,
};

/** Must this platform's manual sign-in run in the real browser? */
function canOperatorSignIn(platform) {
    return Boolean(SIGN_INS[platformKey(platform)]);
}

/**
 * @param {string} platform
 * @param {{ username: string, _id?: any, accountType?: string }} credentials — `accountType` answers
 *        Myntra's first-login relationship-type modal, as in the automated sign-in
 * @param {object} [options] passed to the platform's sign-in (timeoutMs, onProgress)
 * @returns {Promise<{ platform, username, jar, tokens, extra, cookieNames, durationMs }>}
 */
async function operatorSignIn(platform, credentials, options = {}) {
    const key = platformKey(platform);
    const load = SIGN_INS[key];

    if (!load) {
        const err = new Error(`No operator sign-in is defined for platform "${platform}"`);
        err.code = "PLATFORM_NOT_SUPPORTED";
        throw err;
    }

    const started = Date.now();
    const jar = await load()(credentials, options);

    return {
        platform: key,
        username: credentials.username,
        // Myntra's session is the cookie map itself — as `renewPlatformSession`
        // normalises it.
        jar,
        tokens: null,
        extra: null,
        cookieNames: Object.keys(jar || {}),
        durationMs: Date.now() - started,
    };
}

module.exports = { canOperatorSignIn, operatorSignIn };
