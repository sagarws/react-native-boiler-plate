// -----------------------------------------------------------------------------
// Tata CliQ seller portal — sign in
// -----------------------------------------------------------------------------
// WHY THERE IS NO LOGIN API TO CALL. The sign-in is a plain JSP form: typing
// into `#loginId` / `#password` and clicking `#loginbutton` navigates the page.
// It is not fetch, not XHR, so a network recorder that captures those sees
// NOTHING until the OTP step — which is an XHR and therefore the only login
// call in the capture. Nothing was missed; there is no request to replay, which
// is why this drives the form instead.
//
// The form half is lifted from TrackVid-BE's `checkTataCliqLogin`
// (masterImportSetting.controller.ts), where it already verifies a credential
// on every "Save All" in the admin panel. Same selectors, same quirks —
// including the one that matters: `#submitOTPDiv` exists in the DOM from first
// paint and is toggled by style, so "element located" is not the signal that
// the password was accepted. Geometry is.
//
// WHERE THIS GOES FURTHER than the verifier: it answers the OTP. The verifier
// stops at the modal on purpose — raising it proves the password and it wants
// no session. A claim needs the session, so this reads the code and submits it:
//
//   GET /faces/oms/jqAjaxOmsResponse.jsp?flag=submitOTP&userEnteredOTP={code}
//
// (verified in services/api-network-records (12).json, 2026-09-17)
//
// The code comes from the caller, not from here. On the server that is Gmail
// (Automated-Scripts/services/GetTataCliqOTP.js); on the desktop it is the
// operator, or TrackVid. Reading a mailbox is not this module's business and
// the two runners do not have the same access to one.
// -----------------------------------------------------------------------------

const { ORIGIN } = require("./slaveSync");
const { passCloudflareAccess } = require("./cloudflareAccess");
const { cloudflareOtpReader, DEFAULT_TO: DEFAULT_CLOUDFLARE_EMAIL } = require("./cloudflareOTP");

const LOGIN_URL = process.env.TATACLIQ_LOGIN_URL || ORIGIN;

const SELECTORS = {
    loginId: "#loginId",
    password: "#password",
    submit: "#loginbutton",
    /** The OTP modal. Present from first paint — see `isOtpModalOpen`. */
    otpModal: "#submitOTPDiv",
    /**
     * The modal's own button: `<input type="button" id="submitOTP" value="SUBMIT">`.
     *
     * Named because it is named — an id the portal gave it, not a generated
     * class. The structural search below stays as the safety net for the day
     * this changes.
     */
    otpSubmit: "#submitOTP",
};

/** Typing delay, per character. Slow enough to look typed rather than pasted. */
const TYPE_DELAY_MS = 80;

/** How long the portal is given to raise the OTP modal after the password. */
const OTP_MODAL_TIMEOUT_MS = Number(process.env.TATACLIQ_OTP_MODAL_TIMEOUT_MS) || 45000;

/** How long to wait for the OTP itself to arrive from wherever it comes. */
const OTP_WAIT_MS = Number(process.env.TATACLIQ_OTP_WAIT_MS) || 120000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const { settleBeforeOtpRead } = require("../../../common/otpTiming.js");

/**
 * Is the OTP modal actually on screen?
 *
 * Not `waitForSelector`: the element is in the DOM before the form is even
 * submitted, so locating it proves nothing. This asks whether it takes up space
 * and is not display:none — which is what "the portal is asking for the OTP"
 * looks like, and therefore what "the password was accepted" looks like.
 */
async function isOtpModalOpen(page) {
    return page.evaluate((selector) => {
        const el = document.querySelector(selector);

        if (!el) return false;

        const rect = el.getBoundingClientRect();

        if (rect.width <= 0 || rect.height <= 0) return false;

        const style = window.getComputedStyle(el);

        return style.display !== "none" && style.visibility !== "hidden";
    }, SELECTORS.otpModal);
}

/**
 * Whatever the portal is complaining about, in its own words.
 *
 * Scraped from elements whose class or id says "error" rather than by matching
 * free text, and capped, so a whole page can never end up in an error message.
 * Same approach as the BE verifier, and for the same reason: "Invalid
 * Credentials" or "Account locked" is actionable, "login failed" is not.
 */
async function portalError(page) {
    return page
        .evaluate(() => {
            const visible = (el) => {
                const rect = el.getBoundingClientRect();

                return rect.width > 0 && rect.height > 0;
            };

            return (
                Array.from(
                    document.querySelectorAll('[class*="error"], [id*="error"], [class*="Error"], .alert')
                )
                    .filter(visible)
                    .map((el) => (el.textContent || "").replace(/\s+/g, " ").trim())
                    .filter((t) => t.length > 0 && t.length < 200)[0] || ""
            );
        })
        .catch(() => "");
}

/**
 * Fill the form and click Login. Stops at the OTP modal.
 *
 * Exported on its own because that is exactly what credential VERIFICATION
 * wants — the modal appearing is proof the password is right, and answering the
 * OTP would burn a code for nothing.
 *
 * @returns {Promise<{ otpRequested: boolean, error: string|null }>}
 */
async function submitCredentials(page, { username, password }, { logger, cloudflare = null } = {}) {
    if (!username || !password) {
        throw Object.assign(new Error("LOGIN_FAILED: missing username or password"), {
            code: "LOGIN_FAILED",
        });
    }

    logger?.info?.(`🌐 Tata CliQ: signing in as ${username}`);

    await page.goto(LOGIN_URL, { waitUntil: "networkidle2", timeout: 60000 });

    // Cloudflare Access may answer instead of the portal. Passing it lands back
    // on the seller zone's login; with no gate this is a no-op. Without a
    // `cloudflare` option a gate throws CLOUDFLARE_ACCESS_REQUIRED — naming the
    // real obstacle instead of timing out on a #loginId that is not there.
    const gate = await passCloudflareAccess(page, { ...(cloudflare || {}), logger });

    if (gate.passed && !page.url().startsWith(LOGIN_URL)) {
        await page.goto(LOGIN_URL, { waitUntil: "networkidle2", timeout: 60000 });
    }

    // The portal's own scripts finish wiring the form after load; typing into it
    // before that lands the text and then has it cleared.
    await sleep(3000);

    for (const [field, value] of [
        [SELECTORS.loginId, username],
        [SELECTORS.password, password],
    ]) {
        await page.waitForSelector(field, { visible: true, timeout: 20000 });
        // Triple-click then Backspace, rather than typing over: these inputs
        // arrive prefilled on a returning browser profile.
        await page.click(field, { clickCount: 3 });
        await page.keyboard.press("Backspace");
        await page.keyboard.type(value, { delay: TYPE_DELAY_MS });
    }

    await sleep(400);
    await page.waitForSelector(SELECTORS.submit, { visible: true, timeout: 15000 });
    await page.click(SELECTORS.submit).catch(async () => {
        // On some tenants the button is a plain JSP input under the page's own
        // overlay, and Puppeteer refuses an intercepted click. A DOM click is
        // not a workaround for a missing button — it is the same button.
        await page.evaluate((selector) => {
            document.querySelector(selector)?.click();
        }, SELECTORS.submit);
    });

    const otpRequested = await page
        .waitForFunction(
            (selector) => {
                const el = document.querySelector(selector);

                if (!el) return false;

                const rect = el.getBoundingClientRect();

                if (rect.width <= 0 || rect.height <= 0) return false;

                const style = window.getComputedStyle(el);

                return style.display !== "none" && style.visibility !== "hidden";
            },
            { timeout: OTP_MODAL_TIMEOUT_MS, polling: 500 },
            SELECTORS.otpModal
        )
        .then(() => true)
        .catch(() => false);

    if (otpRequested) {
        logger?.info?.("🔐 Tata CliQ: OTP requested — the password was accepted");

        return { otpRequested: true, error: null };
    }

    // No modal. Either the credentials were refused (the form is still there,
    // usually with the portal's own message) or something changed portal-side.
    const stillOnForm = await page
        .evaluate((selector) => {
            const el = document.querySelector(selector);

            return !!el && el.getBoundingClientRect().width > 0;
        }, SELECTORS.loginId)
        .catch(() => true);

    const said = await portalError(page);

    if (stillOnForm) {
        return {
            otpRequested: false,
            error: said ? `Invalid credentials or login failed. Portal said: ${said}` : "Invalid credentials or login failed.",
        };
    }

    // Left the form without raising the modal — a portal change, or a session
    // that was already live. Reported as a failure because the password was not
    // proven, worded so it does not read as a wrong one.
    return { otpRequested: false, error: "Login did not reach the Tata CLiQ OTP step. Please retry." };
}

/**
 * Answer the OTP modal.
 *
 * The one login call that IS an API — a GET with the code in the query string.
 * Its body came back empty in the capture, so success is not read from the
 * response: the caller proves the session by using it (a slave list, or the
 * search), which is the only proof that matters.
 */
async function submitOtp(page, code, { loginId } = {}) {
    const otp = String(code || "").trim();

    if (!/^\d{4,8}$/.test(otp)) {
        throw Object.assign(new Error(`OTP_INVALID: "${otp}" is not an OTP`), { code: "OTP_INVALID" });
    }

    // `loginId` is what the portal's own page sends now (api-network-records
    // (7).json, 2026-10-30); left off when the caller has none, as before.
    const url =
        `${ORIGIN}/faces/oms/jqAjaxOmsResponse.jsp?flag=submitOTP&userEnteredOTP=${encodeURIComponent(otp)}` +
        (loginId ? `&loginId=${encodeURIComponent(loginId)}` : "");

    return page.evaluate(async (target) => {
        const res = await fetch(target, {
            credentials: "include",
            headers: { Accept: "*/*", "X-Requested-With": "XMLHttpRequest" },
        });

        return { status: res.status, ok: res.ok, text: await res.text() };
    }, url);
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
async function typeOtpIntoModal(page, code, { logger } = {}) {
    const otp = String(code || "").trim();

    const filled = await page
        .evaluate(
            (modalSelector, value, submitSelector) => {
                const modal = document.querySelector(modalSelector);

                if (!modal) return false;

                const visible = (el) => {
                    const rect = el.getBoundingClientRect();
                    const style = window.getComputedStyle(el);

                    return (
                        rect.width > 0 &&
                        rect.height > 0 &&
                        style.display !== "none" &&
                        style.visibility !== "hidden"
                    );
                };

                const box = [...modal.querySelectorAll("input")].find(
                    (input) => !["hidden", "checkbox", "radio", "button", "submit"].includes(input.type) && visible(input)
                );

                if (!box) return false;

                // Set through the native setter so a framework's own onChange
                // sees it — a plain `.value =` is invisible to React and to
                // jQuery validation alike.
                const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;

                box.focus();
                if (setter) setter.call(box, value);
                else box.value = value;

                box.dispatchEvent(new Event("input", { bubbles: true }));
                box.dispatchEvent(new Event("change", { bubbles: true }));

                // The portal's own button first, then whatever says submit —
                // as a <button>, an <input type=button|submit>, or a link
                // acting as one.
                const named = document.querySelector(submitSelector);
                const button =
                    named && visible(named)
                        ? named
                        : [...modal.querySelectorAll('button, input[type="submit"], input[type="button"], a')].find(
                              (el) => /submit|verify|continue/i.test(el.innerText || el.value || "") && visible(el)
                          );

                if (button) button.click();

                return true;
            },
            SELECTORS.otpModal,
            otp,
            SELECTORS.otpSubmit
        )
        .catch(() => false);

    if (filled) logger?.info?.("⌨️  Tata CliQ: typed the code into the portal's own OTP box");

    return filled;
}

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
async function loginTataCliq(
    page,
    credentials,
    { fetchOtp, isSignedIn, logger, otpWaitMs = OTP_WAIT_MS, fetchCloudflareOtp } = {}
) {
    if (typeof fetchOtp !== "function") {
        throw Object.assign(
            new Error("loginTataCliq: an `fetchOtp` function is required — the portal always asks for a code"),
            { code: "LOGIN_FAILED" }
        );
    }

    const cloudflare = {
        email: String(credentials?.cloudflareEmail || "").trim() || DEFAULT_CLOUDFLARE_EMAIL,
        fetchOtp: fetchCloudflareOtp || defaultCloudflareOtpReader(logger),
    };
    // Taken BEFORE the password click, as always. A Cloudflare step inside
    // submitCredentials runs first, but its mail comes from another sender and
    // subject, so it can never match the portal's OTP filter.
    const requestedAt = new Date();
    const form = await submitCredentials(page, credentials, { logger, cloudflare });

    if (!form.otpRequested) {
        throw Object.assign(new Error(`LOGIN_FAILED: ${form.error}`), { code: "LOGIN_FAILED" });
    }

    /*
     * Only mail that arrives AFTER the click counts. An earlier code is still
     * sitting in the mailbox and the portal has already retired it.
     *
     * AND THE CUTOFF ALONE DOES NOT SETTLE IT. The timestamp compared is the
     * mail's own Date header, written by the sending server, so a minute of
     * clock skew puts a retired code on the safe side of the line — read
     * immediately, that is the newest mail in the box, and the portal refuses
     * the code it just replaced. So the read waits first. See common/otpTiming.
     */
    await settleBeforeOtpRead("tatacliq", { logger, reason: "after the password" });

    // AFTER the settle, so the whole OTP budget is spent looking rather than
    // waiting: the code's own validity window starts at the click either way.
    const deadline = Date.now() + otpWaitMs;
    let otp = null;
    /**
     * Why the last attempt came back empty.
     *
     * KEPT AND REPORTED. This loop used to swallow every rejection and try
     * again until the budget ran out, which turned a misconfigured relay — a
     * missing SCRIPT_URL, an expired token — into two silent minutes in front
     * of an OTP box and then a message that said only "no OTP arrived". The
     * reason is the whole difference between "the mail is slow" and "nothing is
     * ever going to answer".
     */
    let lastError = null;
    let attempt = 0;

    while (!otp && Date.now() < deadline) {
        attempt += 1;

        // The budget the fetcher is given is what is LEFT, so an inner poll
        // cannot overrun the outer deadline and leave the portal's code to
        // expire while it keeps asking.
        const remaining = Math.max(1000, deadline - Date.now());

        logger?.info?.(`⏳ Tata CliQ: waiting for the OTP (attempt ${attempt}, ${Math.round(remaining / 1000)}s left)`);

        otp = await fetchOtp(credentials.username, requestedAt, remaining).catch((error) => {
            lastError = error?.message || String(error);
            logger?.warn?.(`⚠️  Tata CliQ: could not read the OTP — ${lastError}`);

            return null;
        });

        // Capped by what is left, so the wait cannot overshoot its own budget
        // by five seconds on the last turn.
        if (!otp) await sleep(Math.min(5000, Math.max(0, deadline - Date.now())));
    }

    if (!otp) {
        throw Object.assign(
            new Error(
                `OTP_FETCH_FAILED: no Tata CliQ OTP arrived for ${credentials.username} within ` +
                    `${Math.round(otpWaitMs / 1000)}s` +
                    (lastError ? ` — last error: ${lastError}` : "")
            ),
            { code: "OTP_FETCH_FAILED" }
        );
    }

    logger?.info?.("🔑 Tata CliQ: answering the OTP");
    await submitOtp(page, otp, { loginId: credentials.username });

    if (typeof isSignedIn === "function") {
        // Give the portal a moment to finish the post-OTP navigation before
        // asking, so a slow redirect does not read as a rejected code.
        await sleep(2000);

        if (!(await isSignedIn(page))) {
            // The captured URL did not take. Do what a person would: type the
            // code into the box that is on screen and press the button.
            const typed = await typeOtpIntoModal(page, otp, { logger });

            if (typed) await sleep(4000);

            if (!typed || !(await isSignedIn(page))) {
                throw Object.assign(
                    new Error("OTP_WRONG: the OTP was submitted but the session is not signed in"),
                    { code: "OTP_WRONG" }
                );
            }

            logger?.info?.("✅ Tata CliQ: the typed code was accepted");
        }
    }

    logger?.info?.(`✅ Tata CliQ: signed in as ${credentials.username}`);

    return { ok: true };
}

/**
 * The Gmail reader, when this process can read the mailbox at all.
 *
 * The server holds the credentials in its environment; the desktop does not and
 * must pass `fetchCloudflareOtp` itself. Returning undefined there is what makes
 * a gate fail with a clear CLOUDFLARE_ACCESS_REQUIRED instead of an IMAP error.
 */
function defaultCloudflareOtpReader(logger) {
    if (!process.env.GMAIL_IMAP_USER || !process.env.GMAIL_IMAP_PASSWORD) return undefined;

    return cloudflareOtpReader({ logger });
}

module.exports = {
    LOGIN_URL,
    SELECTORS,
    typeOtpIntoModal,
    isOtpModalOpen,
    submitCredentials,
    submitOtp,
    loginTataCliq,
};
