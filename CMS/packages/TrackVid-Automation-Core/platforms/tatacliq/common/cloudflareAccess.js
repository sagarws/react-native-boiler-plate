// -----------------------------------------------------------------------------
// Tata CliQ — pass the Cloudflare Access gate in front of the seller zone
// -----------------------------------------------------------------------------
// sellerzone.tatacliq.com is sometimes answered by Cloudflare Access instead of
// the portal: the browser lands on tulunistore.cloudflareaccess.com, which asks
// for an email, mails a 6-digit code to it, and only after "Verify" redirects
// back to the seller zone. It is a SEPARATE identity from the portal's own login
// — an inbox, no password — so a Tata CliQ credential carries two: the
// seller-zone username/password and the Access email.
//
// The two pages, as Cloudflare serves them (captured 2026-10-30):
//
//   1. EMAIL   form#totp-form   input#email [data-testid=email-input]
//                               button [data-testid=email-submit-button]  "Send login code"
//   2. CODE    form#code-form   input#code  [data-testid=otp-code-input]   pattern \d{6}
//                               button [data-testid=verify-otp-code-button] "Verify"
//              p.otp-destination strong  → the address the code went to
//
// Both are plain HTML forms that post and navigate — there is no API to replay,
// so this drives the form, matching the portal login beside it.
//
// The code comes from the caller (`fetchOtp`), never from here: the server
// reads Gmail, the desktop may relay it. See cloudflareOTP.js for the reader.
// -----------------------------------------------------------------------------

const { settleBeforeOtpRead } = require("../../../common/otpTiming.js");

const ACCESS_HOST_SUFFIX = ".cloudflareaccess.com";

const SELECTORS = {
    emailInput: '[data-testid="email-input"], #totp-form input#email',
    emailSubmit: '[data-testid="email-submit-button"], #totp-form button[type="submit"]',
    codeInput: '[data-testid="otp-code-input"], #code-form input#code',
    codeSubmit: '[data-testid="verify-otp-code-button"], #code-form button[type="submit"]',
    destination: ".otp-destination strong",
};

/** How long the code page is given to appear after "Send login code". */
const CODE_PAGE_TIMEOUT_MS = Number(process.env.CLOUDFLARE_CODE_PAGE_TIMEOUT_MS) || 30000;

/** How long the mailed code is waited for. Cloudflare's own expiry is 10 minutes. */
const CLOUDFLARE_OTP_WAIT_MS = Number(process.env.CLOUDFLARE_OTP_WAIT_MS) || 120000;

/** How long the redirect back to the seller zone is given after "Verify". */
const VERIFY_TIMEOUT_MS = Number(process.env.CLOUDFLARE_VERIFY_TIMEOUT_MS) || 45000;

const TYPE_DELAY_MS = 60;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const hostOf = (url) => {
    try {
        return new URL(url).hostname.toLowerCase();
    } catch {
        return "";
    }
};

/** Is this URL Cloudflare Access rather than the portal? */
function isCloudflareAccessUrl(url) {
    return hostOf(url).endsWith(ACCESS_HOST_SUFFIX);
}

/**
 * Is the page on the Access gate right now?
 *
 * The host is the signal: Access always serves its pages from
 * `<team>.cloudflareaccess.com`. Not the form — the portal's own pages have an
 * #email-shaped input of their own — and never a heading, which Cloudflare
 * localises.
 */
async function isCloudflareAccessPage(page) {
    const url = typeof page?.url === "function" ? page.url() : "";

    return isCloudflareAccessUrl(url);
}

const accessError = (code, message) => Object.assign(new Error(`${code}: ${message}`), { code });

/** Clear a field and type into it, so a prefilled value cannot be appended to. */
async function typeInto(page, selector, value) {
    await page.waitForSelector(selector, { visible: true, timeout: 20000 });
    await page.click(selector, { clickCount: 3 });
    await page.keyboard.press("Backspace");
    await page.type(selector, value, { delay: TYPE_DELAY_MS });
}

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
async function passCloudflareAccess(page, { email, fetchOtp, otpWaitMs = CLOUDFLARE_OTP_WAIT_MS, logger } = {}) {
    if (!(await isCloudflareAccessPage(page))) return { passed: false };

    const inbox = String(email || "").trim();

    if (!inbox) {
        throw accessError(
            "CLOUDFLARE_ACCESS_REQUIRED",
            "Tata CliQ is behind Cloudflare Access and this login has no Cloudflare email — add one to the Tata CliQ login"
        );
    }

    if (typeof fetchOtp !== "function") {
        throw accessError(
            "CLOUDFLARE_ACCESS_REQUIRED",
            `Tata CliQ is behind Cloudflare Access and nothing can read the code mailed to ${inbox}`
        );
    }

    logger?.info?.(`🛡️  Tata CliQ: Cloudflare Access gate — requesting a code for ${inbox}`);

    // ---- 1. the email page (skipped when Cloudflare went straight to the code)
    const onCodePage = await page.$(SELECTORS.codeInput).then(Boolean).catch(() => false);
    const requestedAt = new Date();

    if (!onCodePage) {
        await typeInto(page, SELECTORS.emailInput, inbox);
        await Promise.all([
            page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: CODE_PAGE_TIMEOUT_MS }).catch(() => null),
            page.click(SELECTORS.emailSubmit),
        ]);
    }

    const codePage = await page
        .waitForSelector(SELECTORS.codeInput, { visible: true, timeout: CODE_PAGE_TIMEOUT_MS })
        .then(() => true)
        .catch(() => false);

    if (!codePage) {
        throw accessError(
            "CLOUDFLARE_ACCESS_FAILED",
            `Cloudflare did not show the code page after "Send login code" for ${inbox} — is it an allowed address?`
        );
    }

    // Where Cloudflare says it sent the code. A different address than asked
    // for is worth a line: the reader would then watch the wrong inbox.
    const sentTo = await page
        .$eval(SELECTORS.destination, (el) => (el.textContent || "").trim())
        .catch(() => "");

    if (sentTo && sentTo.toLowerCase() !== inbox.toLowerCase()) {
        logger?.warn?.(`⚠️  Tata CliQ: Cloudflare says the code went to ${sentTo}, not ${inbox}`);
    }

    // ---- 2. the code ---------------------------------------------------------
    // Same race as every mailed code: read too soon and the newest mail is the
    // code this request just retired. CLOUDFLARE_OTP_SETTLE_MS tunes it.
    await settleBeforeOtpRead("cloudflare", { logger, reason: "after Send login code" });

    const deadline = Date.now() + otpWaitMs;
    let otp = null;
    let lastError = null;

    while (!otp && Date.now() < deadline) {
        const remaining = Math.max(1000, deadline - Date.now());

        otp = await Promise.resolve(fetchOtp(sentTo || inbox, requestedAt, remaining)).catch((error) => {
            lastError = error?.message || String(error);
            logger?.warn?.(`⚠️  Tata CliQ: could not read the Cloudflare code — ${lastError}`);

            return null;
        });

        if (otp && !/^\d{6}$/.test(String(otp).trim())) {
            lastError = `"${otp}" is not a 6-digit code`;
            otp = null;
        }

        if (!otp) await sleep(Math.min(5000, Math.max(0, deadline - Date.now())));
    }

    if (!otp) {
        throw accessError(
            "CLOUDFLARE_OTP_FETCH_FAILED",
            `no Cloudflare Access code arrived for ${inbox} within ${Math.round(otpWaitMs / 1000)}s` +
                (lastError ? ` — last error: ${lastError}` : "")
        );
    }

    logger?.info?.("🔑 Tata CliQ: answering the Cloudflare Access code");

    await typeInto(page, SELECTORS.codeInput, String(otp).trim());
    await Promise.all([
        page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: VERIFY_TIMEOUT_MS }).catch(() => null),
        page.click(SELECTORS.codeSubmit),
    ]);

    // Verified means Cloudflare let go of the page. Still on its host is a
    // refused or expired code — said as such, not as a portal failure.
    const left = await page
        .waitForFunction((suffix) => !location.hostname.toLowerCase().endsWith(suffix), { timeout: VERIFY_TIMEOUT_MS }, ACCESS_HOST_SUFFIX)
        .then(() => true)
        .catch(() => false);

    if (!left) {
        throw accessError("CLOUDFLARE_OTP_WRONG", `Cloudflare Access did not accept the code for ${inbox}`);
    }

    logger?.info?.(`✅ Tata CliQ: through Cloudflare Access as ${inbox}`);

    return { passed: true, email: inbox };
}

module.exports = {
    SELECTORS,
    ACCESS_HOST_SUFFIX,
    isCloudflareAccessUrl,
    isCloudflareAccessPage,
    passCloudflareAccess,
};
