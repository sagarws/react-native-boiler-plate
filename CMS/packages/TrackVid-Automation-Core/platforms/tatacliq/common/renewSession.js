// -----------------------------------------------------------------------------
// Tata CliQ — mint a fresh session from credentials alone
// -----------------------------------------------------------------------------
// Mirrors platforms/ajio/common/renewSession.js, and exists for the same
// reason: `loginTataCliq` takes an ALREADY-OPEN page, because every Tata CliQ
// call runs inside one and the caller keeps using it for the claim. That is the
// right shape for a claim runner and the wrong shape for "just give me a
// session", which is what common/renewSession.js and the Sessions page ask for.
//
// So this owns a browser: launch, sign in, read the cookies AND the slave list
// out, close it.
//
// THE SLAVES COME WITH IT. They are the one thing a Tata CliQ session cannot be
// used without — a session pointed at no slave searches nothing — and the login
// has just proven itself by listing them. Fetching them here means a reused
// session needs no sweep, and a capture that produced no slaves is reported as
// a failure rather than stored as a session that cannot claim.
//
// AN OTP IS SPENT EVERY TIME. That is why the session store's reuse path tries
// hard before falling back here, and why this is not called speculatively.
// -----------------------------------------------------------------------------

const { loadPuppeteer, resolveExecutablePath, browserUnavailableError } = require("../../../common/browserRuntime.js");
const { isHeadless } = require("../../../common/headless.js");
const { loginTataCliq } = require("./login.js");
const { harvestCookies, probeSessionInPage } = require("./sessionStore.js");
const { gmailOtpReader } = require("./getOtp.js");

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
async function loginTataCliqApi(credentials, options = {}) {
    const puppeteer = loadPuppeteer();

    if (!puppeteer) throw browserUnavailableError();

    if (!credentials || !credentials.username || !credentials.password) {
        const err = new Error("Tata CliQ sign-in needs a username and password");

        err.code = "VALIDATION_ERROR";
        throw err;
    }

    // The same HEADLESS rule as every other login: headless unless
    // HEADLESS="false", with an explicit per-call option still winning.
    const headless = typeof options.headless === "boolean" ? options.headless : isHeadless();
    const browser = await puppeteer.launch({
        headless,
        executablePath: resolveExecutablePath(
            process.env.NODE_ENV === "production" ? "/usr/bin/google-chrome" : undefined
        ),
        args: [
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-dev-shm-usage",
            "--disable-blink-features=AutomationControlled",
            "--window-size=1920,1080",
        ],
    });

    try {
        const page = await browser.newPage();

        await page.setViewport({ width: 1280, height: 800 });

        const fetchOtp = options.fetchOtp || gmailOtpReader({ logger: options.logger });

        await loginTataCliq(page, credentials, {
            fetchOtp,
            logger: options.logger,
            ...(typeof options.otpWaitMs === "number" ? { otpWaitMs: options.otpWaitMs } : {}),
            // The Cloudflare Access code reader, when the caller has one. Absent,
            // loginTataCliq falls back to Gmail where this process can read it.
            // The Access email rides on `credentials.cloudflareEmail`.
            ...(typeof options.fetchCloudflareOtp === "function"
                ? { fetchCloudflareOtp: options.fetchCloudflareOtp }
                : {}),
            // The slave list IS the proof, and it is wanted anyway — so the
            // login's own signed-in check is the call this function needs next.
            isSignedIn: async (signedInPage) => (await probeSessionInPage(signedInPage)).alive,
        });

        const jar = await harvestCookies(page, { logger: options.logger || console });
        const { slaves } = await probeSessionInPage(page);

        if (jar.length === 0) {
            const err = new Error("Tata CliQ sign-in produced no cookies");

            err.code = "LOGIN_NO_COOKIES";
            throw err;
        }

        if (slaves.length === 0) {
            // Not stored. A session with no slave list cannot file a claim, and
            // a stored one that looks healthy is worse than none: the next run
            // reuses it, searches nothing, and reports every return missing.
            const err = new Error("Tata CliQ sign-in succeeded but the session lists no slaves");

            err.code = "LOGIN_NO_SLAVES";
            throw err;
        }

        return {
            jar,
            cookieNames: jar.map((cookie) => cookie.name),
            slaves,
        };
    } finally {
        await browser.close().catch(() => undefined);
    }
}

module.exports = { loginTataCliqApi };
