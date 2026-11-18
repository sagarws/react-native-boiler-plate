// -----------------------------------------------------------------------------
// AJIO — mint a fresh session from credentials alone
// -----------------------------------------------------------------------------
// Every other platform exposes `login<Platform>Api(credentials)`: it owns a
// browser, signs in, and hands back a jar. AJIO does not. Its `login()` takes
// an ALREADY-OPEN Puppeteer page —
//
//     login(page, user, TEMP_FILE_PATH, failedUsers, numberOfObject, options)
//
// — because the caller launched the browser and keeps using it for the rest of
// the run (claims, master import, ticket download all continue in that page).
// That is the right shape for those callers and the wrong shape for "just give
// me a session", which is why AJIO could not be registered in
// common/renewSession.js alongside the others.
//
// This closes that gap: launch a browser, sign in with the shared login, read
// the cookies out, close it. Same login, same quirks, no page required.
// -----------------------------------------------------------------------------

const os = require("os");
const path = require("path");

const { login } = require("./login.js");
const { harvestCookies } = require("./sessionStore.js");
const { loadPuppeteer, resolveExecutablePath, browserUnavailableError } = require("../../../common/browserRuntime.js");
const { isHeadless } = require("../../../common/headless.js");
const {
    USER_ID_EXPRESSION,
    pobPageExpression,
    POB_PAGE_SIZE,
} = require("./sessionExtras.js");
const { evaluateUntil, tryEvaluate, waitForUrlToSettle } = require("../../../common/pageEval.js");

/**
 * Sign in to AJIO and return the harvested jar.
 *
 * @param {{ username: string, password: string, loginUrl?: string }} credentials
 * @param {{ headless?: boolean, fetchOtp?: Function|null, otpMailDelayMs?: number,
 *          otpResends?: number, otpWaitMs?: number }} [options] the OTP fields
 *          are passed to `login()` — see ./mfa.js `answerAjioMfa`.
 * @returns {Promise<{ jar: Array, cookieNames: string[] }>}
 */
async function loginAjioApi(credentials, options = {}) {
    const puppeteer = loadPuppeteer();
    if (!puppeteer) throw browserUnavailableError();

    if (!credentials || !credentials.username || !credentials.password) {
        const err = new Error("AJIO sign-in needs a username and password");
        err.code = "VALIDATION_ERROR";
        throw err;
    }

    // Follows the same HEADLESS rule as every other login: headless unless
    // HEADLESS="false". An explicit per-call option still wins, for a caller
    // that needs to watch one particular sign-in.
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

    // A per-run scratch directory, NOT one inside the package. The login writes
    // downloads and failure screenshots here, and a source tree is the wrong
    // place for runtime output — on the server that is what restarted nodemon
    // mid-login.
    const tempDir = await require("fs-extra").mkdtemp(path.join(os.tmpdir(), "ajio-login-"));

    try {
        const page = await browser.newPage();
        await page.setViewport({ width: 1280, height: 800 });

        const failedUsers = [];
        // `user` is an array because the shared login was written for a batch;
        // one credential is a batch of one.
        const result = await login(page, [credentials], tempDir, failedUsers, 0, {
            // The caller wants a jar, not a tidied-up portal: post-login popup
            // dismissal is for flows that keep using the page.
            skipPostLoginPopups: true,
            // A one-time-code challenge is answered from the mailbox. Undefined
            // fields mean the login's own defaults (the server's mailbox).
            fetchOtp: options.fetchOtp,
            otpMailDelayMs: options.otpMailDelayMs,
            otpResends: options.otpResends,
            otpWaitMs: options.otpWaitMs,
        });

        if (result && result.ok === false) {
            // login() reports its text in `error`; `reasonText` is kept for
            // anything that ever returned that shape.
            const err = new Error(result.reasonText || result.error || "AJIO sign-in failed");
            err.code = result.isBadCreds ? "INVALID_CREDENTIALS" : result.otp ? "OTP_REQUIRED" : "LOGIN_FAILED";
            throw err;
        }
        if (failedUsers.length > 0) {
            const err = new Error(`AJIO sign-in failed for ${credentials.username}`);
            err.code = "LOGIN_FAILED";
            throw err;
        }

        const jar = await harvestCookies(page);
        if (!jar || jar.length === 0) {
            const err = new Error("AJIO sign-in completed but set no cookies");
            err.code = "LOGIN_NO_COOKIES";
            throw err;
        }

        // AJIO's ingest rejects a jar on its own — it also needs the seller's
        // activeSellerProfileId and places of business. Both are read from the
        // signed-in page (one from localStorage, one from an authenticated API
        // call), so they must be collected HERE, while the page is still open.
        //
        // The reads are short and retried rather than one long in-page poll.
        // login() returns on the OAuth callback, which is the START of AJIO's
        // redirect chain into the seller SPA — a read issued there is racing
        // navigations that destroy the execution context underneath it.
        await waitForUrlToSettle(page, { quietMs: 2000, timeoutMs: 30000 });

        // The SPA writes activeSellerProfileId a beat after it mounts, so a
        // null answer means "not yet", not "not there".
        let userId;
        try {
            userId = await evaluateUntil(page, USER_ID_EXPRESSION, { timeoutMs: 25000 });
        } catch (err) {
            const e = new Error(
                `AJIO sign-in succeeded but the session is unusable — the seller profile never appeared (${err.message})`
            );
            e.code = "SESSION_INCOMPLETE";
            throw e;
        }

        // Places of business, paged from HERE so no single read is long enough
        // to be worth losing.
        const stores = [];
        for (let pageNum = 0; pageNum < 20; pageNum++) {
            const attempt = await tryEvaluate(page, pobPageExpression(userId, pageNum, POB_PAGE_SIZE));

            if (!attempt.ok) {
                if (attempt.navigated && pageNum === 0) {
                    // Still moving. Let it settle and try this page once more.
                    await waitForUrlToSettle(page, { quietMs: 1500, timeoutMs: 15000 });
                    pageNum -= 1;
                    continue;
                }
                break;
            }

            const res = attempt.value;
            if (!res || res.status < 200 || res.status >= 300) {
                if (pageNum === 0) {
                    const e = new Error(
                        `AJIO sign-in succeeded but the session is unusable — the work-places API answered ${res?.status} ` +
                        `(${String(res?.text || "").slice(0, 160)})`
                    );
                    e.code = "SESSION_INCOMPLETE";
                    throw e;
                }
                break; // a later page failing still leaves usable results
            }

            let json;
            try {
                json = JSON.parse(res.text);
            } catch (_) {
                if (pageNum === 0) {
                    const e = new Error("AJIO sign-in succeeded but the work-places API returned non-JSON");
                    e.code = "SESSION_INCOMPLETE";
                    throw e;
                }
                break;
            }

            const content = json.content || [];
            for (const c of content) if (c && c.id) stores.push({ id: c.id, storeName: c.storeName });
            if (json.last === true || content.length < POB_PAGE_SIZE) break;
            if (json.totalPages != null && pageNum >= json.totalPages - 1) break;
        }

        if (stores.length === 0) {
            const e = new Error(
                "AJIO sign-in succeeded but the seller has no places of business, so the session cannot be used"
            );
            e.code = "SESSION_INCOMPLETE";
            throw e;
        }

        return {
            jar,
            cookieNames: jar.map((c) => c.name),
            userId,
            pobIds: stores.map((s) => s.id),
            stores,
        };
    } finally {
        try { await browser.close(); } catch (_) { /* already gone */ }
        try { await require("fs-extra").remove(tempDir); } catch (_) { /* best effort */ }
    }
}

module.exports = { loginAjioApi };
