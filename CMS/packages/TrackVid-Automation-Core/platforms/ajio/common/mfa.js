// -----------------------------------------------------------------------------
// AJIO — answering the Reliance SSO one-time-code challenge ("Verify your identity")
// -----------------------------------------------------------------------------
// Some AJIO accounts are not sent to seller.ajio.com after the password: the
// SSO renders an MFA page instead —
//
//   <form id="mfaForm" action="/auth/oauth/authorize/mfa">
//     <input id="otp" name="otp" maxlength="6">
//     <button id="mfaSubmitBtn">Verify</button>
//   </form>
//   <a href="/auth/oauth/authorize/mfa/resend?...">Resend code</a>
//
// The code goes to every verified channel at once (email + mobile), so the
// mail copy is enough. This is the AJIO counterpart of Snapdeal's
// `handleOtpFlow`: read the mailbox (after an optional pause), type the code,
// judge the outcome, and on a refusal click "Resend code" and try the new one.
//
// There is no operator relay for AJIO — a run that cannot read the code fails
// with an `OTP_REQUIRED:` message, which every consumer already classifies as
// "not a credential problem".
// -----------------------------------------------------------------------------

const { clickAjioSalesChannel, pickAjioSalesChannelIfShown, continueToAjioPortal } = require("./salesChannel");

const MFA = {
    form: "#mfaForm",
    input: "#mfaForm #otp",
    submit: "#mfaSubmitBtn",
    resend: 'a[href*="/authorize/mfa/resend"]',
};

/** Is the SSO showing its one-time-code challenge right now? Never throws. */
async function isOnAjioMfaPage(page) {
    return page
        .evaluate((sel) => Boolean(document.querySelector(sel)), MFA.form)
        .catch(() => false);
}

/**
 * The mailbox reader used when the caller names none — the server's own
 * (GMAIL_IMAP_USER / GMAIL_IMAP_PASSWORD), exactly as Snapdeal's default.
 * Null where that environment is absent: the desktop app brings its own.
 */
function defaultAjioOtpReader() {
    if (!process.env.GMAIL_IMAP_USER || !process.env.GMAIL_IMAP_PASSWORD) return null;

    try {
        const { GetAjioOTP } = require("./getOtp");

        return (to, since) => GetAjioOTP(to, { since });
    } catch (err) {
        console.warn(`⚠️ AJIO OTP reader unavailable: ${err.message}`);

        return null;
    }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Back on seller.ajio.com (signed in), still on the MFA page (refused), or
 * neither yet. A "Select a sales channel" picker shown on the way is answered
 * with AJIO (see ./salesChannel.js) and the wait carries on.
 */
async function waitForMfaVerdict(page, timeoutMs, logger = console) {
    const started = Date.now();
    const deadline = started + timeoutMs;

    while (Date.now() < deadline) {
        await sleep(500);

        if ((await clickAjioSalesChannel(page)) === "clicked") {
            logger.info?.("   🏬 Picked the AJIO sales channel");
            await sleep(1500);
            continue;
        }

        const state = await page
            .evaluate(
                (sel) => ({
                    onPortal: location.hostname.includes("seller.ajio.com"),
                    // Left the SSO's /auth/ pages but stayed on Reliance: signed
                    // in to Reliance Seller Central (/scp/…), not yet to AJIO.
                    onReliance:
                        location.hostname.includes("relianceretail.com") && !location.pathname.startsWith("/auth/"),
                    onMfa: Boolean(document.querySelector(sel)),
                    busy: document.readyState !== "complete",
                }),
                MFA.form
            )
            .catch(() => ({ onPortal: false, onReliance: false, onMfa: false, busy: true }));

        if (state.onPortal) return "accepted";
        if (state.onReliance && !state.onMfa) return "reliance";
        // A refused code re-renders the same MFA page with an error toast. Only
        // trusted once the document has finished loading and a few seconds have
        // passed, so the page we just submitted FROM is not mistaken for the
        // page that came back.
        if (state.onMfa && !state.busy && Date.now() - started > 3000) {
            const pending = await page
                .evaluate((sel) => {
                    const btn = document.querySelector(sel);

                    return Boolean(btn && (btn.disabled || btn.classList.contains("loading")));
                }, MFA.submit)
                .catch(() => false);

            if (!pending) return "refused";
        }
    }

    return "timeout";
}

/** Clear the box, type the code, submit. False when the box is not there. */
async function typeAndSubmit(page, code) {
    const box = await page.waitForSelector(MFA.input, { visible: true, timeout: 15000 }).catch(() => null);

    if (!box) return false;

    await page.evaluate((sel) => {
        const el = document.querySelector(sel);

        if (el) el.value = "";
    }, MFA.input);
    await box.type(code, { delay: 60 });
    await sleep(300);

    const clicked = await page
        .evaluate((sel) => {
            const btn = document.querySelector(sel);

            if (!btn) return false;
            btn.click();

            return true;
        }, MFA.submit)
        .catch(() => false);

    if (!clicked) await page.keyboard.press("Enter");

    return true;
}

/**
 * Answer the challenge the page is showing.
 *
 * @param {object} page a Puppeteer page sitting on the MFA form
 * @param {string} username the AJIO login — the mailbox address to read
 * @param {object} [options]
 * @param {(to: string, since: Date, timeoutMs?: number) => Promise<string|null>|null} [options.fetchOtp]
 *        where to read the code; undefined → `defaultAjioOtpReader()`, null →
 *        no reader (the challenge cannot be answered).
 * @param {Date}   [options.since] ignore mail older than this (stamp it before
 *        the password submit).
 * @param {number} [options.mailDelayMs=0] wait this long before the first read.
 * @param {number} [options.resends=0] on a refused code, "Resend code" and try
 *        the new one, up to this many times.
 * @param {number} [options.mailTimeoutMs] how long to wait for each mail;
 *        default AJIO_OTP_MAIL_TIMEOUT_MS or 60s.
 * @param {string} [options.portalUrl] the AJIO seller portal to continue to
 *        when the SSO ends on Reliance Seller Central (see ./salesChannel.js).
 * @param {object} [options.logger]
 * @returns {Promise<{ ok: true } | { ok: false, reasonText: string }>} never
 *          throws for a mail or portal problem; `reasonText` starts `OTP_REQUIRED:`.
 */
async function answerAjioMfa(page, username, options = {}) {
    const logger = options.logger || console;
    const fetchOtp = options.fetchOtp === undefined ? defaultAjioOtpReader() : options.fetchOtp;
    const mailDelayMs = Math.max(0, Number(options.mailDelayMs) || 0);
    const resends = Math.max(0, Math.floor(Number(options.resends) || 0));
    const mailTimeoutMs =
        Number(options.mailTimeoutMs) > 0
            ? Number(options.mailTimeoutMs)
            : parseInt(process.env.AJIO_OTP_MAIL_TIMEOUT_MS, 10) || 60000;

    logger.info?.(`🔢 AJIO asked ${username} for a one-time code`);

    if (typeof fetchOtp !== "function") {
        return { ok: false, reasonText: "OTP_REQUIRED: AJIO asked for a one-time code and this machine cannot read the mailbox" };
    }

    const { pollForOtp } = require("./getOtp");
    let cutoff = options.since instanceof Date ? options.since : new Date(Date.now() - 5 * 60 * 1000);
    let outcome = "none-arrived";

    for (let round = 0; round <= resends; round++) {
        if (round > 0) {
            const resend = await page.$(MFA.resend);

            if (!resend) {
                logger.warn?.(`   ⚠️  No "Resend code" link on the AJIO MFA page; giving up`);
                break;
            }

            cutoff = new Date();
            await Promise.all([
                page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => null),
                resend.click(),
            ]);
            logger.info?.(`   🔁 Clicked "Resend code" (resend ${round}/${resends})`);
        }

        if (mailDelayMs > 0) {
            logger.info?.(`   ⏳ Waiting ${Math.round(mailDelayMs / 1000)}s for the new AJIO OTP mail...`);
            await sleep(mailDelayMs);
        }

        let code = null;

        try {
            const since = cutoff;

            code = await pollForOtp(() => fetchOtp(username, since, mailTimeoutMs), {
                timeoutMs: mailTimeoutMs,
                intervalMs: 5000,
                logger,
            });
        } catch (err) {
            logger.warn?.(`   ⚠️  Could not read the AJIO OTP mailbox: ${err.message}`);
            break;
        }

        if (!code) {
            outcome = "none-arrived";
            break;
        }

        logger.info?.(`   ✉️  AJIO OTP read from the mailbox; submitting...`);

        if (!(await typeAndSubmit(page, code))) {
            outcome = "not-typed";
            break;
        }

        let verdict = await waitForMfaVerdict(page, 30000, logger);

        // The code was accepted but the SSO stopped at Reliance Seller Central.
        if (verdict === "reliance") {
            const onward = await continueToAjioPortal(page, { portalUrl: options.portalUrl, logger });

            if (!onward.ok) {
                logger.warn?.(`   ⚠️  AJIO accepted the code, but ${onward.reasonText}`);

                return { ok: false, reasonText: `OTP_REQUIRED: AJIO accepted the one-time code, but ${onward.reasonText}` };
            }

            verdict = "accepted";
        }

        if (verdict === "accepted") {
            logger.info?.("   ✅ AJIO accepted the one-time code");

            // Multi-channel accounts may be shown the picker only once they are
            // back on seller.ajio.com. A short look; a no-op when it never shows.
            await pickAjioSalesChannelIfShown(page, { detectWaitMs: 8000, logger });

            return { ok: true };
        }

        outcome = verdict === "refused" ? "rejected" : "no-redirect";
        logger.warn?.(`   ⚠️  AJIO did not accept the one-time code (${verdict}; url: ${page.url()})`);

        if (verdict !== "refused") break;
    }

    const reasonText = {
        "none-arrived": "OTP_REQUIRED: AJIO asked for a one-time code and none arrived in the mailbox",
        rejected: "OTP_REQUIRED: AJIO rejected the code read from the mailbox",
        "not-typed": "OTP_REQUIRED: the code from the mailbox could not be typed into AJIO's OTP field",
        "no-redirect": "OTP_REQUIRED: AJIO did not finish signing in after the one-time code",
    }[outcome];

    return { ok: false, reasonText };
}

module.exports = { MFA, isOnAjioMfaPage, answerAjioMfa, defaultAjioOtpReader };
