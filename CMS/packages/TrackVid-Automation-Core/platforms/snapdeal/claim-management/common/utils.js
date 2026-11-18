const path = require("path");
const fs = require("fs-extra");
const axios = require("axios");
const { assertClaimSubmitEnabled } = require("../../../../common/claimSubmitGuard");

// ---------------------------
// 📥 Download File Helper
// ---------------------------
async function downloadFile(url, filename, tempPath) {
    if (!url || !url.startsWith('http')) {
        return url;
    }
    try {
        const response = await axios.get(url, { responseType: 'arraybuffer', timeout: 30000 });
        const ext = path.extname(new URL(url).pathname) || '.tmp';
        const filePath = path.join(tempPath, `${filename}_${Date.now()}${ext}`);
        await fs.writeFile(filePath, response.data);
        console.log(`    📥 Downloaded: ${filename} -> ${filePath}`);
        return filePath;
    } catch (err) {
        console.error(`    ❌ Failed to download ${filename}: ${err.message}`);
        throw err;
    }
}

// ---------------------------
// 🎭 Stealth Mode
// ---------------------------
async function enableStealthMode(page) {
    await page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, 'webdriver', {
            get: () => false,
        });
    });

    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36');

    await page.evaluateOnNewDocument(() => {
        delete window.__webdriver_evaluate;
        delete window.__selenium_evaluate;
        delete window.__webdriver_script_function;
        delete window.__webdriver_script_func;
        delete window.__webdriver_script_name;
        window.chrome = { runtime: {} };

        const originalQuery = window.navigator.permissions.query;
        window.navigator.permissions.query = (parameters) => (
            parameters.name === 'notifications' ?
                Promise.resolve({ state: Notification.permission }) :
                originalQuery(parameters)
        );
    });
}

// ---------------------------
// 🗂️ Handle Dialogs & Popups
// ---------------------------
function handleDialog(page) {
    page.on("dialog", async (dialog) => {
        try {
            const dialogMessage = dialog.message() || '';
            console.log(`⚠️ Dialog detected: ${dialogMessage}`);
            await dialog.accept();
        } catch (err) {
            console.warn(`⚠️ Dialog handler failed (ignored): ${err.message}`);
        }
    });
}

// ---------------------------
// 🔢 OTP bridge (script ↔ BE)
// ---------------------------
// These three helpers talk to the same /api/cms endpoints used by the
// callback flow, gated by X-Internal-Token. When HANDLE_OTP is disabled
// in scriptNew.js they are never called.

async function notifyOtpRequired(jobId, username, cmsIds) {
    const backendUrl = process.env.BASE_URL;
    const token = process.env.REALTIME_INTERNAL_SCRIPT_TOKEN;
    if (!jobId || !backendUrl || !token) return;

    try {
        await axios.post(
            `${backendUrl}/api/cms/script-otp-required`,
            { jobId, username, cmsIds: Array.isArray(cmsIds) ? cmsIds : [] },
            {
                headers: { "Content-Type": "application/json", "X-Internal-Token": token },
                timeout: 5000,
            }
        );
        console.log(`📨 Notified BE: OTP required for job ${jobId} (user: ${username})`);
    } catch (err) {
        console.warn(`⚠️ Failed to notify BE about OTP requirement: ${err.message}`);
    }
}

async function getOtpFromBackend(jobId) {
    const backendUrl = process.env.BASE_URL;
    const token = process.env.REALTIME_INTERNAL_SCRIPT_TOKEN;
    if (!jobId || !backendUrl || !token) return null;

    try {
        const res = await axios.post(`${backendUrl}/api/cms/get-otp`, { jobId }, {
            headers: { "Content-Type": "application/json", "X-Internal-Token": token },
            timeout: 5000,
        });
        return res?.data?.data || null;
    } catch (err) {
        console.warn(`⚠️ Failed to poll OTP from BE: ${err.message}`);
        return null;
    }
}

async function setOtpStatus(jobId, status) {
    const backendUrl = process.env.BASE_URL;
    const token = process.env.REALTIME_INTERNAL_SCRIPT_TOKEN;
    if (!jobId || !backendUrl || !token) return;

    try {
        await axios.put(
            `${backendUrl}/api/cms/otp-status`,
            { jobId, status },
            {
                headers: { "Content-Type": "application/json", "X-Internal-Token": token },
                timeout: 5000,
            }
        );
    } catch (err) {
        console.warn(`⚠️ Failed to update OTP status (${status}): ${err.message}`);
    }
}

// Notify BE, then poll every OTP_POLL_INTERVAL_MS (default 15s) up to
// OTP_POLL_MAX_ATTEMPTS times (default 4). When the user submits an OTP
// via the FE modal, BE writes it to ScriptJob.otp and we pick it up here.
// On success the function returns; on wrong OTP or timeout it throws so
// the existing session-level catch in scriptNew.js fans Failed callbacks
// out to every AWB in the batch.
const OTP_INPUT = "#verify-otp #otp, #otp";
const OTP_SUBMIT = "#otp-button";

/** Wait up to `timeoutMs` for the OTP field to leave the page: Snapdeal's only "accepted" signal. */
async function otpPanelGone(page, timeoutMs) {
    const until = Date.now() + timeoutMs;

    while (Date.now() < until) {
        if (!(await page.$(OTP_INPUT).catch(() => null))) return true;
        await new Promise((r) => setTimeout(r, 500));
    }

    return false;
}

/** Every Submit button, for the log: visible, disabled, its text, and what sits on top of it. */
async function describeSubmitButtons(page) {
    return page
        .$$eval(OTP_SUBMIT, (els) =>
            els.map((el, i) => {
                const box = el.getBoundingClientRect();
                const visible = box.width > 0 && box.height > 0;
                const top = visible
                    ? document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)
                    : null;
                const covered = top && top !== el && !el.contains(top)
                    ? `covered by <${top.tagName.toLowerCase()}${top.id ? "#" + top.id : ""}${top.className ? "." + String(top.className).split(" ")[0] : ""}>`
                    : "uncovered";

                return `#${i} ${visible ? "visible" : "hidden"} disabled=${!!el.disabled} text="${(el.textContent || el.value || "").trim()}" ${covered}`;
            })
        )
        .catch(() => []);
}

/**
 * What THIS field holds right now, or null when it is gone.
 *
 * Read through the handle that was typed into, never by selector: the panel can
 * carry more than one `#otp`, and `page.$eval` reads the first — which logged
 * "holds nothing" for the field that had the code, then "verified" after
 * writing the code into a different, hidden one.
 */
async function readOtpField(input) {
    return input.evaluate((el) => el.value).catch(() => null);
}

/** Every `#otp` on the page, for the log: how many, which are visible, what each holds. */
async function describeOtpFields(page) {
    return page
        .$$eval(OTP_INPUT, (els) =>
            els.map((el, i) => {
                const box = el.getBoundingClientRect();
                const visible = box.width > 0 && box.height > 0 && getComputedStyle(el).visibility !== "hidden";

                return `#${i} ${visible ? "visible" : "hidden"} value="${el.value}" maxlength=${el.maxLength}`;
            })
        )
        .catch(() => []);
}

/**
 * Put the code into the OTP field, and PROVE it is there before anyone clicks.
 *
 * THE BUG THIS FIXES. Typing used to be fire-and-forget: click the field, press
 * Backspace, send keystrokes to whatever had focus. Sometimes the panel was
 * still settling and the field had not taken focus, the keystrokes went
 * nowhere, and Submit was clicked on an EMPTY box — Snapdeal refused it, and the
 * run reported "none arrived in the mailbox" for a code that had arrived.
 *
 * So the field's own value is read back after typing. If it is not the code,
 * the value is set directly with the events the page listens for, and read back
 * again. Three tries; if the field still does not hold the code, nothing is
 * submitted and the caller is told why.
 */
async function typeOtp(page, otpValue) {
    const input = await page
        .waitForSelector(OTP_INPUT, { visible: true, timeout: 10000 })
        .catch(() => null);

    if (!input) throw new Error("OTP_INVALID: OTP input no longer present on page");

    const fields = await describeOtpFields(page);

    console.log(`   🔎 OTP fields on the page: ${fields.length} — ${fields.join("; ")}`);

    for (let attempt = 1; attempt <= 3; attempt++) {
        console.log(`   ⌨️  Typing OTP ${otpValue} into the OTP field (attempt ${attempt}/3)...`);

        await input.click({ clickCount: 3 });
        await input.focus();
        await page.keyboard.press("Backspace");
        // ElementHandle.type focuses the field itself, unlike page.keyboard.
        await input.type(otpValue, { delay: 80 });

        let typed = await readOtpField(input);

        if (typed !== otpValue) {
            console.warn(
                `   ⚠️  OTP field holds "${typed ?? ""}" after typing, not "${otpValue}" — setting it directly`
            );

            await input
                .evaluate(
                    (el, value) => {
                        const setter = Object.getOwnPropertyDescriptor(
                            window.HTMLInputElement.prototype,
                            "value"
                        ).set;

                        el.focus();
                        setter.call(el, value);
                        el.dispatchEvent(new Event("input", { bubbles: true }));
                        el.dispatchEvent(new Event("change", { bubbles: true }));
                    },
                    otpValue
                )
                .catch(() => undefined);

            typed = await readOtpField(input);
        }

        if (typed === otpValue) {
            console.log(`   ✅ OTP field verified: holds ${typed} (${typed.length} digits)`);
            console.log(`   🔎 OTP fields before Submit: ${(await describeOtpFields(page)).join("; ")}`);

            return true;
        }

        console.warn(`   ⚠️  OTP field still holds "${typed ?? ""}" — retrying`);
        await new Promise((r) => setTimeout(r, 1000));
    }

    return false;
}

/**
 * Type a code into the OTP panel and say whether Snapdeal took it.
 *
 * LIFTED OUT OF THE POLL LOOP so the mailbox path and the operator path submit
 * identically.
 *
 * Returns `{ typed, accepted }`. `typed: false` means the field never held the
 * code and Submit was NOT clicked — a typing failure, not a wrong code.
 *
 * WRONG CODE LEAVES THE INPUT ON THE PAGE. There is no error element to read,
 * so the input's own survival is the verdict.
 */
async function submitOtp(page, otpValue) {
    console.log(`   🔢 OTP to enter: ${otpValue} (${otpValue.length} digits)`);

    if (!(await typeOtp(page, otpValue))) {
        console.warn(`   ❌ The OTP field never held the code — NOT clicking Submit`);

        return { typed: false, accepted: false };
    }

    const submitBtn = await page.waitForSelector(OTP_SUBMIT, {
        visible: true,
        timeout: 5000,
    });

    console.log(`   🔎 Submit buttons: ${(await describeSubmitButtons(page)).join("; ")}`);

    /*
     * THREE WAYS TO PRESS SUBMIT, each checked before the next.
     *
     * A puppeteer click on #otp-button was seen to do nothing: the field held
     * the right code, the page never moved, and an operator clicking the same
     * button by hand signed straight in with that code. A mouse click lands on
     * whatever is at the button's coordinates, so an overlay or a mid-animation
     * layout swallows it. The DOM click fires on the button itself, and Enter
     * submits the form the field belongs to.
     */
    const presses = [
        ["mouse click", async () => {
            await submitBtn.evaluate((el) => el.scrollIntoView({ block: "center" }));
            await submitBtn.click();
        }],
        ["direct click on the button", () => submitBtn.evaluate((el) => el.click())],
        ["Enter in the OTP field", async () => {
            const input = await page.$(OTP_INPUT);

            if (input) await input.focus();
            await page.keyboard.press("Enter");
        }],
    ];

    let accepted = false;

    for (const [how, press] of presses) {
        if (!(await page.$(OTP_INPUT))) {
            accepted = true;
            break;
        }

        try {
            await press();
        } catch (err) {
            console.warn(`   ⚠️  OTP submit by ${how} failed: ${err.message}`);
            continue;
        }

        console.log(`   📩 OTP submitted by ${how}; verifying outcome...`);

        accepted = await otpPanelGone(page, 8000);

        if (accepted) break;

        console.warn(`   ⚠️  Still on the OTP panel after the ${how} (url: ${page.url()})`);
    }

    console.log(accepted ? `   ✅ Snapdeal accepted the OTP` : `   ❌ Snapdeal did not accept the OTP ${otpValue}`);

    if (!accepted) {
        console.log(`   🔎 After Submit: url=${page.url()} — OTP fields: ${(await describeOtpFields(page)).join("; ")}`);
    }

    return { typed: true, accepted };
}

/**
 * The mailbox reader this runner uses when the caller names none.
 *
 * ONLY WHERE THE MAILBOX IS CONFIGURED. The desktop app has no IMAP secret —
 * one inbox serves every seller, so shipping it would hand each installation
 * the whole mailbox — and it passes its own `fetchOtp` instead. Returning null
 * here leaves that installation exactly as it was: it asks the operator.
 */
// The shared waiter — same interval, same shape check, same quiet give-up as
// every other platform's OTP wait. Required lazily, like the reader below, so
// a build without the Gmail dependencies still loads this module.
function otpPoller() {
    return require("../../../flipkart/common/getOtp").pollForOtp;
}

function defaultOtpReader() {
    if (!process.env.GMAIL_IMAP_USER || !process.env.GMAIL_IMAP_PASSWORD) return null;

    try {
        const { GetSnapdealOTP } = require("../../common/getOtp");

        return (to, since) => GetSnapdealOTP(to, { since });
    } catch (err) {
        console.warn(`⚠️ Snapdeal OTP reader unavailable: ${err.message}`);

        return null;
    }
}

/**
 * @param {object} [options]
 * @param {(to: string, since: Date) => Promise<string|null>} [options.fetchOtp]
 *        where to read the emailed code. Defaults to this machine's mailbox;
 *        null disables the mail path and waits for the operator, as before.
 * @param {Date} [options.since] mail older than this is ignored — every one of
 *        these mails shares one subject, so without it the newest match can be
 *        the PREVIOUS sign-in's code, already retired.
 * @param {number} [options.mailDelayMs=0] wait this long before reading the
 *        mailbox, so the fresh code has landed.
 * @param {number} [options.resends=0] on a refused mailed code, click "Resend
 *        OTP" and try the new one, up to this many times.
 */
async function handleOtpFlow(page, username, jobId, cmsIds, options = {}) {
    const intervalMs = parseInt(process.env.OTP_POLL_INTERVAL_MS, 10) || 15000;
    const maxAttempts = parseInt(process.env.OTP_POLL_MAX_ATTEMPTS, 10) || 4;

    console.log(
        `🔢 OTP page detected. Notifying BE and polling for user OTP ` +
        `(interval=${intervalMs}ms, attempts=${maxAttempts}, total wait=${intervalMs * maxAttempts}ms)`
    );

    /*
     * THE MAILBOX FIRST, AND WITHOUT WAITING.
     *
     * Snapdeal emails the same code it texts. Where this machine can read that
     * mail, the sign-in finishes on its own — which is the difference between
     * a Snapdeal claim run that works at 02:00 and one that waits all night
     * for somebody to type six digits into a modal.
     *
     * The operator path below is untouched and still runs when the mail does
     * not arrive: a mailbox that is slow, or an account whose code only goes
     * to the phone, must not be a worse outcome than before.
     */
    const fetchOtp = options.fetchOtp === undefined ? defaultOtpReader() : options.fetchOtp;
    const since = options.since instanceof Date ? options.since : new Date(Date.now() - 5 * 60 * 1000);

    /** Why the mailbox path ended without signing in, for the error below. */
    let mailOutcome = "none-arrived";

    if (typeof fetchOtp === "function") {
        /*
         * WAIT BEFORE READING, AND RESEND ON A REFUSAL — both off unless the
         * caller asks (the server passes neither, and behaves as before).
         *
         * Read at once, the mailbox could still hand back the PREVIOUS sign-in's
         * code: the new mail had not landed, and that one was the newest. A
         * pause lets the fresh code arrive first. And when Snapdeal refuses a
         * code anyway, "Resend OTP" retires it and mails a new one — which,
         * after the same pause, is read with the cutoff moved to the resend.
         */
        const mailDelayMs = Math.max(0, Number(options.mailDelayMs) || 0);
        const resends = Math.max(0, Math.floor(Number(options.resends) || 0));
        let cutoff = since;

        for (let round = 0; round <= resends; round++) {
            if (round > 0) {
                const resend = await page.$("#resend_otp");

                if (!resend) {
                    console.warn(`   ⚠️  No "Resend OTP" link on the page; giving up on the mailbox`);
                    break;
                }

                cutoff = new Date();
                await resend.click();
                console.log(`   🔁 Clicked "Resend OTP" (resend ${round}/${resends})`);
            }

            if (mailDelayMs > 0) {
                console.log(`   ⏳ Waiting ${Math.round(mailDelayMs / 1000)}s for the new OTP mail before reading the mailbox...`);
                await new Promise((r) => setTimeout(r, mailDelayMs));
            }

            try {
                const mailed = await otpPoller()(() => fetchOtp(username, cutoff), {
                    timeoutMs: parseInt(process.env.SNAPDEAL_OTP_MAIL_TIMEOUT_MS, 10) || 60000,
                    intervalMs: 5000,
                });

                if (!mailed) {
                    mailOutcome = "none-arrived";
                    console.log(`   ⏳ No OTP mail arrived; asking the operator`);
                    break;
                }

                console.log(`   ✉️  OTP read from the mailbox: ${mailed}; submitting...`);

                const result = await submitOtp(page, mailed);

                if (result.accepted) {
                    console.log(`✅ OTP accepted; continuing into seller portal`);
                    await setOtpStatus(jobId, "CONSUMED");

                    return true;
                }

                // Not fatal: a code can be retired between the mail arriving
                // and the submit. Resend if allowed, else let a person try.
                mailOutcome = result.typed ? "rejected" : "not-typed";
                console.warn(
                    result.typed
                        ? `   ⚠️  Snapdeal rejected the mailed OTP ${mailed}`
                        : `   ⚠️  The mailed OTP could not be typed into Snapdeal's OTP field`
                );
            } catch (err) {
                console.warn(`   ⚠️  Could not read the OTP mailbox: ${err.message}`);
                break;
            }
        }
    }

    /*
     * NOBODY TO ASK. A scheduled run has no operator watching the modal, and
     * notifying the backend would leave a job sitting on a prompt that is never
     * answered — holding the browser for the whole poll window and failing
     * anyway.
     */
    if (options.operatorFallback === false) {
        // OTP_REQUIRED either way — callers classify on that prefix — but the
        // rest says what actually happened, which "none arrived" often was not.
        throw new Error(
            mailOutcome === "rejected"
                ? "OTP_REQUIRED: Snapdeal rejected the code read from the mailbox"
                : mailOutcome === "not-typed"
                  ? "OTP_REQUIRED: the code from the mailbox could not be typed into Snapdeal's OTP field"
                  : "OTP_REQUIRED: Snapdeal asked for a code and none arrived in the mailbox"
        );
    }

    await notifyOtpRequired(jobId, username, cmsIds);

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        await new Promise((r) => setTimeout(r, intervalMs));
        console.log(`🔍 OTP poll ${attempt}/${maxAttempts}`);

        const data = await getOtpFromBackend(jobId);
        const otpValue = (data && data.otp) ? String(data.otp).trim() : null;

        if (!otpValue) {
            console.log(`   ⏳ No OTP yet (status: ${data?.otpStatus || "unknown"})`);
            continue;
        }

        console.log(`   ✅ OTP received from user (length: ${otpValue.length}); submitting...`);

        let result;

        try {
            result = await submitOtp(page, otpValue);
        } catch (err) {
            await setOtpStatus(jobId, "INVALID");
            throw err;
        }

        if (!result.accepted) {
            await setOtpStatus(jobId, "INVALID");
            throw new Error(
                result.typed
                    ? "OTP_INVALID: Snapdeal rejected the OTP entered by the user"
                    : "OTP_INVALID: the OTP entered by the user could not be typed into Snapdeal's OTP field"
            );
        }

        console.log(`✅ OTP accepted; continuing into seller portal`);
        await setOtpStatus(jobId, "CONSUMED");
        return true;
    }

    await setOtpStatus(jobId, "TIMEOUT");
    throw new Error(
        `OTP_REQUIRED: Valid OTP not entered within ${(intervalMs * maxAttempts) / 1000}s window`
    );
}

// ---------------------------
// 🔐 Snapdeal Login
// ---------------------------
async function snapdealLogin(page, credentials, options = {}) {
    const {
        jobId = null,
        handleOtp = false,
        cmsIds = [],
        /*
         * WHERE AN EMAILED CODE COMES FROM, when one is asked for.
         *
         * Undefined means "this machine's mailbox, if it has one" — which is
         * what makes an unattended Snapdeal sign-in possible at all. The
         * desktop app passes its own reader (it holds no IMAP secret), and
         * null disables the mail path entirely, leaving the operator flow this
         * login had before.
         */
        fetchOtp = undefined,
        // See handleOtpFlow. 0 = read at once, never resend: as before.
        otpMailDelayMs = 0,
        otpResends = 0,
    } = options;
    const { username, password } = credentials;

    console.log("🔑 Starting Snapdeal login process...");
    console.log(`🔑 Logging in with user: ${username}`);

    // Navigate to Snapdeal Seller Portal
    console.log("🌐 Navigating to Snapdeal Seller Portal...");
    await page.goto("https://seller.snapdeal.com/#/", { waitUntil: "networkidle2" });
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Click Login Button on Homepage
    console.log("🔓 Clicking Login button on homepage...");
    await page.waitForSelector('::-p-text(Login)', { visible: true, timeout: 10000 });
    try {
        await page.evaluate(() => {
            const btn = Array.from(document.querySelectorAll('a, button, div, span'))
                .find(el => el.textContent.trim() === 'Login');
            if (btn) btn.click();
        });
    } catch (_) {
        const homepageLoginBtn = await page.$('::-p-text(Login)');
        if (homepageLoginBtn) await homepageLoginBtn.click();
    }
    console.log("    ✅ Homepage Login button clicked");

    // Wait for login page to load
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Enter Username
    console.log("📝 Entering username...");
    const usernameSelector = 'input[placeholder="Enter your username"]';
    await page.waitForSelector(usernameSelector, { visible: true, timeout: 15000 });
    await new Promise(resolve => setTimeout(resolve, 500));
    const usernameInput = await page.$(usernameSelector);
    await usernameInput.click({ clickCount: 3 });
    await page.keyboard.press('Backspace');
    await page.keyboard.type(username, { delay: 80 });
    console.log(`    ✅ Username entered: ${username}`);

    // Click "Login with Password" button
    console.log("🔑 Clicking 'Login with Password' button...");
    await new Promise(resolve => setTimeout(resolve, 500));
    const loginWithPassBtn = await page.waitForSelector('::-p-text(Login with Password)', { visible: true, timeout: 10000 });
    await loginWithPassBtn.click();
    console.log("    ✅ 'Login with Password' button clicked");

    // Wait for password field to appear
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Enter Password
    console.log("🔐 Entering password...");
    const passwordSelector = 'input[placeholder="Please enter password"]';
    await page.waitForSelector(passwordSelector, { visible: true, timeout: 10000 });
    await new Promise(resolve => setTimeout(resolve, 500));
    const passwordInput = await page.$(passwordSelector);
    await passwordInput.click({ clickCount: 3 });
    await page.keyboard.press('Backspace');
    await page.keyboard.type(password, { delay: 80 });
    console.log("    ✅ Password entered");

    // Click "Submit Password" button
    console.log("🔑 Clicking 'Submit Password' button...");
    await new Promise(resolve => setTimeout(resolve, 500));
    // STAMPED BEFORE THE CLICK, and this is the whole reason an OTP read can be
    // trusted: every one of these mails shares a subject, so without a cutoff
    // the newest match may be the PREVIOUS sign-in's code — retired, rejected,
    // and failing in a way that reads like a wrong password.
    const otpRequestedAt = new Date();
    const submitPassBtn = await page.waitForSelector('::-p-text(Submit Password)', { visible: true, timeout: 10000 });
    await submitPassBtn.click();
    console.log("    ✅ 'Submit Password' button clicked");

    // Wait for Login to Complete
    console.log("⏳ Waiting for login to complete...");
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Verify login by waiting for the seller-portal shell to render.
    // The URL-based check used to work (/dashboard suffix) but Snapdeal
    // now lands on https://seller.snapdeal.com/ and routes the dashboard
    // via Angular hash — so URL sniffing gives false negatives.
    //
    // Instead, wait for any of the logged-in nav items to appear. #nav_24
    // (Returns) is used by the auto-claim flow; #nav_26 (Reports) is used
    // by the master-data flow. If neither renders within 15s, login
    // really did fail.
    console.log(`    📍 Current URL after login: ${page.url()}`);

    // Race the post-login nav vs the OTP page. Some Snapdeal accounts skip
    // OTP entirely and land straight on the seller-portal shell, so we need
    // to detect both outcomes — otherwise no-OTP accounts always time out
    // and get incorrectly marked as LOGIN_FAILED.
    const NAV_SELECTOR = "#nav_24 a, #nav_26 a";
    const OTP_SELECTOR = "#verify-otp #otp, #otp";

    /**
     * Snapdeal saying the password is wrong, in its own words:
     *
     *   <div class="font-semibold text-[12px] leading-[150%] text-[#C80032]">
     *     Invalid Username or Password , please try again
     *   </div>
     *
     * MATCHED ON THE TEXT, NEVER THE CLASS. Those are Tailwind utilities —
     * `text-[#C80032]` is a colour and `text-[12px]` a size — and a redesign
     * that changed the red or the type scale would silently stop this working,
     * which is the one failure nobody would notice: a wrong password would go
     * back to looking like a timeout.
     *
     * The spacing is the portal's own ("Password , please") so the match is
     * deliberately loose about whitespace and stops before the comma.
     *
     * The pattern is written INSIDE the evaluated function, not lifted to a
     * constant: this runs in the page, serialised across the bridge, and a
     * closure over anything out here arrives undefined.
     */
    const rejectionSeen = () =>
        page.evaluate(() => {
            const text = document.body ? document.body.innerText || "" : "";

            return /invalid\s+username\s+or\s+password/i.test(text);
        });

    /**
     * Watch for the rejection while the other two outcomes are racing.
     *
     * A THIRD RACER, not a check afterwards. Without it a wrong password is
     * decided by "the shell never rendered, and 30s later the form is still
     * there" — true, but it costs the full timeout on every bad credential,
     * and it is a guess where the portal has given a plain answer.
     */
    const rejectionPromise = (timeout) =>
        new Promise((resolve, reject) => {
            const deadline = Date.now() + timeout;
            const tick = async () => {
                if (Date.now() > deadline) return reject(new Error("no rejection shown"));

                try {
                    if (await rejectionSeen()) return resolve("rejected");
                } catch {
                    // Navigating, or the page is gone. The other racers decide.
                }

                setTimeout(tick, 500);
            };

            tick();
        });

    const raceLoginOutcome = (timeout) => {
        const navPromise = page
            .waitForSelector(NAV_SELECTOR, { visible: true, timeout })
            .then(() => "nav");
        const otpPromise = page
            .waitForSelector(OTP_SELECTOR, { visible: true, timeout })
            .then(() => "otp");
        return Promise.any([navPromise, otpPromise, rejectionPromise(timeout)]);
    };

    let outcome;
    try {
        outcome = await raceLoginOutcome(15000);
    } catch (err) {
        // Neither the seller-portal nav nor the OTP page rendered. The page
        // is sometimes stuck mid-redirect — give it one reload + 15s before
        // declaring the session dead.
        console.warn("⚠️ No post-login content visible. Reloading page and waiting 15s before retry...");
        try {
            await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
        } catch (reloadErr) {
            console.warn(`⚠️ Page reload failed: ${reloadErr.message}`);
        }
        await new Promise((resolve) => setTimeout(resolve, 15000));
        console.log(`    📍 URL after reload: ${page.url()}`);

        try {
            outcome = await raceLoginOutcome(15000);
        } catch (retryErr) {
            // Distinguish a true auth failure (Snapdeal rejected the creds, so
            // the login form is still on screen) from a transient page issue
            // (slow portal, network, captcha) so the master-data cron only
            // unverifies creds on real password changes.
            //
            // If the password input is still visible after we waited 30s+, the
            // submit didn't navigate — that's overwhelmingly an invalid-creds
            // signal on Snapdeal's seller portal. Any error scraped from a
            // visible alert/error element is appended for the audit log.
            let invalidCreds = false;
            let errorText = "";
            try {
                const stillOnLoginPage =
                    (await page.$('input[placeholder="Please enter password"]')) !== null ||
                    (await page.$('input[placeholder="Enter your username"]')) !== null;
                if (stillOnLoginPage) {
                    invalidCreds = true;
                    errorText = await page.evaluate(() => {
                        // The portal's own rejection carries no `error` class
                        // — it is a Tailwind-styled div — so the text is read
                        // from the page as well as from the usual containers.
                        const body = document.body ? document.body.innerText || "" : "";
                        const said = body.match(/invalid\s+username\s+or\s+password[^\n]*/i);

                        if (said) return said[0].trim().slice(0, 200);

                        const candidates = Array.from(
                            document.querySelectorAll('.error, .error-message, [class*="error"], .toast, .alert')
                        );
                        for (const el of candidates) {
                            const text = (el.textContent || "").trim();
                            if (text) return text.slice(0, 200);
                        }
                        return "";
                    });
                }
            } catch (probeErr) {
                console.warn(`⚠️ Could not probe Snapdeal login state: ${probeErr.message}`);
            }

            if (invalidCreds) {
                throw new Error(
                    `INVALID_CREDENTIALS: Snapdeal rejected the login (form still visible). ${errorText}`.trim()
                );
            }
            throw new Error("LOGIN_FAILED: Seller portal shell did not render after login (even after reload)");
        }
    }

    /*
     * THE PORTAL SAID IT PLAINLY, so there is nothing to work out.
     *
     * `INVALID_CREDENTIALS:` is the prefix every consumer keys on —
     * `isInvalidCredentialsError` in ../../common/loginErrors.js — and it is
     * what flips `is_verified` to false on the credential. That matters more
     * than the speed: a wrong password reported as a timeout is retried every
     * night for ever, against an account that will never accept it.
     */
    if (outcome === "rejected") {
        throw new Error(
            "INVALID_CREDENTIALS: Snapdeal rejected the login — Invalid Username or Password"
        );
    }

    if (outcome === "otp") {
        const reader = fetchOtp === undefined ? defaultOtpReader() : fetchOtp;

        /*
         * EITHER WAY OF ANSWERING IS ENOUGH TO TRY.
         *
         * `handleOtp` used to be the only gate, and it asks a narrower
         * question than this one: "may I interrupt a person?". A run that
         * could read the code itself still threw OTP_REQUIRED because nobody
         * was there to ask — which is precisely the run that did not need
         * asking.
         */
        if (handleOtp || typeof reader === "function") {
            await handleOtpFlow(page, username, jobId, cmsIds, {
                fetchOtp: reader,
                since: otpRequestedAt,
                // Only interrupt a person when the caller said one is there.
                operatorFallback: handleOtp,
                mailDelayMs: otpMailDelayMs,
                resends: otpResends,
            });
            console.log("✅ Snapdeal login successful (OTP answered)!");
            return true;
        }

        throw new Error("OTP_REQUIRED: Snapdeal is asking for an OTP after password submission. Manual intervention needed.");
    }

    console.log("✅ Snapdeal login successful!");
    return true;
}

// ---------------------------
// 📋 Navigate to Returns
// ---------------------------
async function navigateToReturns(page) {
    console.log("📋 Navigating to Returns tab...");
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Use id selector (Rule 1 #3) — stable anchor
    const returnsSelector = '#nav_24 a';
    await page.waitForSelector(returnsSelector, { visible: true, timeout: 10000 });
    await page.click(returnsSelector);
    console.log("    ✅ Returns tab clicked");

    await new Promise(resolve => setTimeout(resolve, 3000));
    console.log("✅ Returns page loaded!");
    return true;
}

// ---------------------------
// 📦 Navigate to Delivered Returns & Search AWB
// ---------------------------
async function navigateToDeliveredReturns(page) {
    console.log("📦 Clicking 'Delivered Returns' tab...");

    // Click "Delivered Returns" link (Rule 1 #5 — text-based)
    const deliveredBtn = await page.waitForSelector('::-p-text(Delivered Returns)', { visible: true, timeout: 10000 });
    await deliveredBtn.click();
    console.log("    ✅ 'Delivered Returns' tab clicked");

    await new Promise(resolve => setTimeout(resolve, 3000));
    return true;
}

// Generic Returns-tab search: pick a field from the search dropdown, type the
// value, press Enter. The Returns list can be queried by more than one field, and
// a return that doesn't surface under one can still surface under another — so the
// caller can retry with a different field instead of giving up.
//
// `notFoundError` keeps each caller's original error string intact.
async function searchByField(page, { optionLabel, value, notFoundError }) {
    console.log(`🔍 Searching ${optionLabel}: ${value}...`);

    // Click search dropdown to open it
    const dropdownSelector = '.search-dropdown .dropdown-display';
    await page.waitForSelector(dropdownSelector, { visible: true, timeout: 10000 });
    await page.click(dropdownSelector);
    console.log("    ✅ Search dropdown opened");

    await new Promise(resolve => setTimeout(resolve, 1000));

    // Select the requested option from the dropdown
    const optionClicked = await page.evaluate((label) => {
        const options = document.querySelectorAll('.search-dropdown .dropdown-list div[ng-repeat] span');
        for (const option of options) {
            if (option.textContent.trim() === label) {
                option.parentElement.click();
                return true;
            }
        }
        return false;
    }, optionLabel);

    if (!optionClicked) {
        throw new Error(notFoundError || `${optionLabel.toUpperCase().replace(/\s+/g, "_")}_OPTION_NOT_FOUND`);
    }
    console.log(`    ✅ '${optionLabel}' selected from dropdown`);

    await new Promise(resolve => setTimeout(resolve, 1000));

    // Enter the value in the search input
    console.log(`    📝 Entering ${optionLabel}: ${value}...`);
    const searchInputSelector = 'input[placeholder="Search Here"]';
    await page.waitForSelector(searchInputSelector, { visible: true, timeout: 10000 });
    const searchInput = await page.$(searchInputSelector);
    await searchInput.click({ clickCount: 3 });
    await page.keyboard.press('Backspace');
    await page.keyboard.type(String(value), { delay: 80 });
    console.log(`    ✅ ${optionLabel} entered: ${value}`);

    // Press Enter to search
    await new Promise(resolve => setTimeout(resolve, 500));
    await page.keyboard.press('Enter');
    console.log("    ✅ Enter pressed — searching...");

    await new Promise(resolve => setTimeout(resolve, 3000));
    console.log(`✅ ${optionLabel} search completed!`);
    return true;
}

async function searchByAwbNumber(page, awbNumber) {
    return searchByField(page, {
        optionLabel: 'AWB Number',
        value: awbNumber,
        notFoundError: "AWB_NUMBER_OPTION_NOT_FOUND",
    });
}

// Fallback search for the Returns tab. Snapdeal doesn't always match a return by
// its AWB (blank/updated AWB on the row), but the suborder id is always present.
async function searchBySuborderId(page, subOrderNumber) {
    return searchByField(page, {
        optionLabel: 'Suborder Id',
        value: subOrderNumber,
        notFoundError: "SUBORDER_ID_OPTION_NOT_FOUND",
    });
}

// ---------------------------
// 🔎 Did the AWB search return a row?
// ---------------------------
// The Delivered Returns tab lists one `.product-row` per match. An AWB whose
// dispute was already raised has MOVED to Disputed Returns, so searching for it
// here legitimately returns nothing — that is a business outcome, not a failure.
//
// Called before clickRaiseDispute() so "no record" is distinguishable from
// "row present but the Raise Dispute link never rendered".
//
// Uses a short timeout because the caller already waited 3s after pressing Enter.
async function hasDeliveredReturnRecord(page, { timeoutMs = 8000 } = {}) {
    try {
        await page.waitForSelector('.product-row', { visible: true, timeout: timeoutMs });
        return true;
    } catch (_) {
        return false;
    }
}

// ---------------------------
// 🎫 Hover Product & Click Raise Dispute
// ---------------------------
async function clickRaiseDispute(page) {
    console.log("🎫 Hovering on product row to open actions...");

    // Wait for product row to appear
    const productRowSelector = '.product-row';
    await page.waitForSelector(productRowSelector, { visible: true, timeout: 10000 });

    // Hover over the product row to trigger action-list popup
    const productRow = await page.$(productRowSelector);
    await productRow.hover();
    console.log("    ✅ Hovered on product row");

    await new Promise(resolve => setTimeout(resolve, 1500));

    // Click "Raise Dispute" link inside the action-list
    console.log("    🔍 Looking for 'Raise Dispute' button...");
    const raiseDisputeSelector = 'a.raise-dispute-button';
    await page.waitForSelector(raiseDisputeSelector, { visible: true, timeout: 10000 });
    await page.click(raiseDisputeSelector);
    console.log("    ✅ 'Raise Dispute' clicked");

    await new Promise(resolve => setTimeout(resolve, 3000));
    console.log("✅ Raise Dispute opened!");
    return true;
}

// ---------------------------
// 📝 Fill Dispute Form
// ---------------------------
async function fillDisputeForm(page, formData, tempPath) {
    try {
        console.log("📝 Filling Dispute form...");
        await new Promise(resolve => setTimeout(resolve, 2000));

        // 1. Select Issue Category
        await selectIssueCategory(page, formData.issueCategory);

        // 2. Upload Outer Packaging Image
        await uploadDisputeFile(page, formData.outerPackagingImage, 'Outer Packaging', 'outer', tempPath);

        // 3. Upload Inner Packaging Image
        await uploadDisputeFile(page, formData.innerPackagingImage, 'Inner Packaging', 'inner', tempPath);

        // 4. Upload Product Image
        await uploadDisputeFile(page, formData.attachProductImage, 'Product Image', 'product', tempPath);

        // 5. Upload Proof of Delivery Image
        await uploadDisputeFile(page, formData.proofOfDeliveryImage, 'Proof of Delivery', 'pod_slip', tempPath);

        // 6. Fill Description
        await fillDisputeDescription(page, formData.description);

        // 7. Upload Video
        await uploadDisputeVideo(page, formData.video, tempPath);

        // 8. Settle before submitting. The last upload's progress bar and the
        // form's validation both finish asynchronously, so give the modal a
        // moment before the click lands.
        console.log("  - ⏳ Waiting 5s before submit...");
        await new Promise(resolve => setTimeout(resolve, 10000));

        // 9. Click Raise Dispute submit button
        // if (useRobotSubmit()) {
        await clickRaiseDisputeSubmitWithRobot();
        // } else {
        //     await clickRaiseDisputeSubmit(page);
        // }

        console.log("✅ Dispute form filled & submitted successfully!");
        return true;
    } catch (error) {
        console.error(`🚨 Fill dispute form failed: ${error.message}`);
        throw error;
    }
}

async function selectIssueCategory(page, category) {
    console.log(`  - Selecting Issue Category: ${category}...`);

    // Click the dropdown inside dispute modal to open it
    const dropdownSelector = '.dispute-modal .sf-selectbox-container';
    await page.waitForSelector(dropdownSelector, { visible: true, timeout: 10000 });
    await page.click(dropdownSelector);
    console.log("    ✅ Issue category dropdown opened");

    await new Promise(resolve => setTimeout(resolve, 1000));

    // Select the option by matching span text inside dropdown
    const optionClicked = await page.evaluate((categoryText) => {
        const items = document.querySelectorAll('.sf-selectbox-container div[ng-repeat]');
        for (const item of items) {
            const span = item.querySelector('span');
            if (span && span.textContent.trim() === categoryText) {
                item.click();
                return true;
            }
        }
        return false;
    }, category);

    if (!optionClicked) {
        throw new Error(`Issue category "${category}" not found`);
    }
    console.log(`    ✅ Selected: ${category}`);
    await new Promise(resolve => setTimeout(resolve, 1000));
}

// The BE pads every image field to a fixed length, filling the empty slots with
// ".../trackvid/undefined" — a URL shape that 404s. Detect those before spending a
// request on them, and before they can be mistaken for a real attachment.
function isPlaceholderImageUrl(url) {
    if (typeof url !== "string") return true;
    const trimmed = url.trim();
    if (!trimmed) return true;
    // Last path segment is literally "undefined"/"null", or the whole value is.
    const lastSegment = trimmed.split("?")[0].split("/").filter(Boolean).pop() || "";
    return /^(undefined|null)$/i.test(lastSegment) || /^(undefined|null)$/i.test(trimmed);
}

/**
 * Upload every genuinely-downloadable file for one dispute field.
 *
 * Rules:
 *   - placeholder URLs (".../undefined") are skipped without a network call
 *   - a URL that fails to download is skipped — NOT replaced by an earlier image.
 *     Re-uploading the previous file just attaches the same photo twice, which is
 *     worse than attaching it once: Snapdeal counts it against the 10-file limit
 *     and a reviewer sees a duplicate where a distinct angle was expected.
 *   - the same URL listed twice is uploaded once
 *
 * @returns {Promise<number>} how many files actually attached
 */
// Human-readable name for a config image URL, used verbatim in error messages
// so a failure points at the exact CMS asset ("<name> not uploaded").
function imageNameFromUrl(url, fallback) {
    try {
        const base = path.basename(new URL(url).pathname);
        return decodeURIComponent(base) || fallback;
    } catch (_) {
        return fallback;
    }
}

async function uploadDisputeFile(page, files, label, attachmentType, tempPath) {
    const fileList = Array.isArray(files) ? files : [files];
    const selector = `input[type="file"][ng-click*="'${attachmentType}'"]`;

    const seenUrls = new Set();
    let uploadedCount = 0;

    for (let i = 0; i < fileList.length; i++) {
        const url = fileList[i];
        if (!url) continue;

        if (isPlaceholderImageUrl(url)) {
            console.log(`  - Skipping ${label} ${i + 1}/${fileList.length} — placeholder URL (${url})`);
            continue;
        }

        if (seenUrls.has(url)) {
            console.log(`  - Skipping ${label} ${i + 1}/${fileList.length} — duplicate of a URL already uploaded`);
            continue;
        }
        seenUrls.add(url);

        console.log(`  - Uploading ${label} (${i + 1}/${fileList.length})...`);
        const imgName = imageNameFromUrl(url, `${attachmentType}_${i + 1}`);
        let localPath;
        try {
            localPath = await downloadFile(url, `${attachmentType}_${i}`, tempPath);
        } catch (err) {
            throw new Error(`UPLOAD_FAILED: ${imgName} not uploaded — download failed: ${err.message}`);
        }
        if (!localPath) {
            throw new Error(`UPLOAD_FAILED: ${imgName} not uploaded — download returned no file`);
        }
        const absolutePath = path.resolve(localPath);

        try {
            await page.waitForSelector(selector, { timeout: 10000 });

            const [fileChooser] = await Promise.all([
                page.waitForFileChooser(),
                page.click(selector),
            ]);
            await fileChooser.accept([absolutePath]);

            uploadedCount++;
            console.log(`    ✅ ${imgName} uploaded`);
            await new Promise(resolve => setTimeout(resolve, 3000));
        } catch (err) {
            throw new Error(`UPLOAD_FAILED: ${imgName} not uploaded — upload step failed: ${err.message}`);
        }
    }

    if (uploadedCount === 0) {
        console.warn(`  ⚠️ ${label}: nothing attached (no downloadable file in ${fileList.length} entry/entries)`);
    } else {
        console.log(`  📎 ${label}: ${uploadedCount} file(s) attached (all distinct)`);
    }
    return uploadedCount;
}

/**
 * Convert the CMS claim template (HTML) to plain text for the dispute textarea.
 *
 * Snapdeal's Description is a plain <textarea>, so raw markup would be raised
 * verbatim on the ticket. Anchors collapse to their href so the evidence links
 * stay clickable-as-text; <p>/<li>/<br> become newlines. Mirrors the helper in
 * the Nykaa / AJIO claim scripts.
 */
function htmlToText(html) {
    if (!html) return "";
    html = String(html);
    html = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "");
    html = html.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "");
    html = html.replace(/<a [^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/gi, (_, href) => href);
    html = html.replace(/<br\s*\/?>/gi, "\n");
    html = html.replace(/<\/p>/gi, "\n");
    // One newline per <li> (closing tag only) so the evidence list stays a
    // tight block instead of double-spacing every line.
    html = html.replace(/<\/li>\s*/gi, "\n");
    html = html.replace(/<li[^>]*>/gi, "");
    html = html.replace(/<[^>]+>/g, "");
    html = html.replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<")
        .replace(/&gt;/gi, ">").replace(/&quot;/gi, '"').replace(/&#39;/gi, "'");
    html = html.replace(/\n{2,}/g, "\n\n");
    html = html.split("\n").map((l) => l.replace(/[ \t]+/g, " ").trim()).join("\n").replace(/\n{2,}/g, "\n\n").trim();
    return html;
}

async function fillDisputeDescription(page, description) {
    console.log("  - Filling Description...");
    const text = htmlToText(description);
    if (!text) {
        console.warn("    ⚠️ Description is empty after HTML cleanup — skipping");
        return;
    }
    const descSelector = 'textarea[placeholder="Description"]';
    await page.waitForSelector(descSelector, { visible: true, timeout: 10000 });
    await page.click(descSelector);

    await page.$eval(descSelector, (el, val) => {
        const setter = Object.getOwnPropertyDescriptor(
            window.HTMLTextAreaElement.prototype, 'value'
        ).set;
        setter.call(el, val);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
    }, text);

    console.log("    ✅ Description filled");
    await new Promise(resolve => setTimeout(resolve, 500));
}

async function uploadDisputeVideo(page, fileUrl, tempPath) {
    console.log("  - Uploading Video...");

    if (!fileUrl) {
        console.log("    ⏭️ No video provided, skipping");
        return;
    }

    let localPath;
    try {
        localPath = await downloadFile(fileUrl, 'dispute_video', tempPath, page);
    } catch (err) {
        console.warn(`    ⚠️ Skipping Video — download failed: ${err.message}`);
        return;
    }

    try {
        const absolutePath = path.resolve(localPath);
        const videoSelector = 'input[type="file"][file-upload="deliveredCtrl.uploadIssueVideo"]';
        await page.waitForSelector(videoSelector, { timeout: 10000 });

        const [fileChooser] = await Promise.all([
            page.waitForFileChooser(),
            page.click(videoSelector),
        ]);
        await fileChooser.accept([absolutePath]);

        console.log(`    ✅ Video uploaded`);
        await new Promise(resolve => setTimeout(resolve, 3000));
    } catch (err) {
        console.warn(`    ⚠️ Skipping Video — upload step failed: ${err.message}`);
    }
}

// ---------------------------
// 🖱️ Click Raise Dispute Submit via robotjs (OS-level mouse)
// ---------------------------
// Snapdeal's submit button sometimes ignores a synthetic DOM click (AngularJS
// binds the handler in a way that a programmatic .click() doesn't always trigger).
// A real OS-level mouse click is indistinguishable from a human one.
//
// The trade-off is that these are SCREEN coordinates, not page coordinates, so
// this only works when:
//   - the browser runs HEADFUL — scriptNew.js now launches with headless:true,
//     so this path requires flipping that back before it can work
//   - the window is in a predictable position/size
//   - macOS has granted Accessibility permission to the terminal/node
// It cannot work on the headless server, which is why it is opt-in.
//
//   SNAPDEAL_ROBOT_SUBMIT=true          enable it
//   SNAPDEAL_SUBMIT_CLICK_X=1000        screen x (default 1000)
//   SNAPDEAL_SUBMIT_CLICK_Y=780         screen y (default 780)
const useRobotSubmit = () => process.env.SNAPDEAL_ROBOT_SUBMIT === "true";

async function clickRaiseDisputeSubmitWithRobot() {
    // DESABLE_SAVE=true → never move the real mouse onto the submit button.
    assertClaimSubmitEnabled("Snapdeal", "'Raise Dispute' submit click (robotjs)");

    const x = Number(process.env.SNAPDEAL_SUBMIT_CLICK_X) || 1000;
    const y = Number(process.env.SNAPDEAL_SUBMIT_CLICK_Y) || 780;

    // Required lazily: robotjs is a native module and throws on a machine with no
    // display. Requiring at module load would break every import of this file on
    // the server, including the flows that never touch robotjs.
    let robot;
    try {
        robot = require("robotjs");
    } catch (err) {
        throw new Error(
            `robotjs unavailable (${err.message}). Unset SNAPDEAL_ROBOT_SUBMIT to fall back to the selector click.`
        );
    }

    const screen = robot.getScreenSize();
    if (x < 0 || y < 0 || x > screen.width || y > screen.height) {
        throw new Error(
            `Submit click point (${x}, ${y}) is outside the screen (${screen.width}x${screen.height}). ` +
            `Set SNAPDEAL_SUBMIT_CLICK_X / SNAPDEAL_SUBMIT_CLICK_Y.`
        );
    }

    console.log(`🖱️  Clicking 'Raise Dispute' submit via robotjs at (${x}, ${y}) on ${screen.width}x${screen.height}...`);
    robot.moveMouseSmooth(x, y);
    robot.moveMouseSmooth(y, x);
    robot.moveMouseSmooth(x, y);
    robot.mouseClick("left"); // once — a second click would raise a duplicate dispute
    robot.mouseClick("left"); // once — a second click would raise a duplicate dispute
    robot.mouseClick("left"); // once — a second click would raise a duplicate dispute
    await new Promise(resolve => setTimeout(resolve, 10000));
    console.log("    ✅ Submit clicked (robotjs, 1 click)");

    // Same settle time the selector path uses, so the caller's next step
    // (ticket-id capture) sees the post-submit page either way.
    await new Promise(resolve => setTimeout(resolve, 5000));
}

// ---------------------------
// 🚀 Click Raise Dispute Submit Button
// ---------------------------
async function clickRaiseDisputeSubmit(page) {
    // DESABLE_SAVE=true → the dispute form stays filled but unsubmitted.
    assertClaimSubmitEnabled("Snapdeal", "'Raise Dispute' submit click");

    console.log("🚀 Clicking 'Raise Dispute' submit button...");
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Selector candidates, most-stable first:
    //   1. AngularJS ng-click binding (won't change with CSS renames)
    //   2. New button class (sf-modal-btn) — current UI
    //   3. Legacy footer wrapper — old UI
    //   4. Text fallback
    const selectors = [
        'button[ng-click*="disputeHandler"]',
        'button.sf-button-primary.sf-modal-btn',
        '.sf-modal-footer button.sf-button-primary',
    ];

    let submitBtn = null;
    for (const sel of selectors) {
        try {
            submitBtn = await page.waitForSelector(sel, { visible: true, timeout: 4000 });
            if (submitBtn) {
                console.log(`    📌 Found submit button via selector: ${sel}`);
                break;
            }
        } catch (_) {
            // try next selector
        }
    }

    if (!submitBtn) {
        // Last-ditch text-based lookup
        try {
            submitBtn = await page.waitForSelector('::-p-text(Raise Dispute)', { visible: true, timeout: 4000 });
            if (submitBtn) console.log(`    📌 Found submit button via text match`);
        } catch (_) {
            // fall through
        }
    }

    if (!submitBtn) {
        throw new Error("Raise Dispute submit button not found (UI may have changed again)");
    }

    await submitBtn.click();
    console.log("    ✅ 'Raise Dispute' submit button clicked");

    await new Promise(resolve => setTimeout(resolve, 5000));
}

// ---------------------------
// 🎫 Capture Ticket ID from Disputed Returns
// ---------------------------
async function getSnapdealTicketId(page, subOrderNumber) {
    try {
        console.log(`🔍 Capturing Ticket ID for Suborder: ${subOrderNumber}`);

        // 1. Click "Disputed Returns" tab
        console.log("📋 Clicking 'Disputed Returns' tab...");
        const disputedBtn = await page.waitForSelector('::-p-text(Disputed Returns)', { visible: true, timeout: 10000 });
        await disputedBtn.click();
        console.log("    ✅ 'Disputed Returns' tab clicked");

        await new Promise(resolve => setTimeout(resolve, 3000));

        // 2. Open search dropdown and select "Suborder Id"
        console.log("    🔽 Opening search dropdown...");
        const dropdownSelector = '.search-dropdown .dropdown-display';
        await page.waitForSelector(dropdownSelector, { visible: true, timeout: 10000 });
        await page.click(dropdownSelector);

        await new Promise(resolve => setTimeout(resolve, 1000));

        const suborderSelected = await page.evaluate(() => {
            const options = document.querySelectorAll('.search-dropdown .dropdown-list div[ng-repeat] span');
            for (const option of options) {
                if (option.textContent.trim() === 'Suborder Id') {
                    option.parentElement.click();
                    return true;
                }
            }
            return false;
        });

        if (!suborderSelected) {
            throw new Error("Suborder Id option not found in dropdown");
        }
        console.log("    ✅ 'Suborder Id' selected");

        await new Promise(resolve => setTimeout(resolve, 1000));

        // 3. Enter suborder number and press Enter
        console.log(`    📝 Entering Suborder: ${subOrderNumber}...`);
        const searchInputSelector = 'input[placeholder="Search Here"]';
        await page.waitForSelector(searchInputSelector, { visible: true, timeout: 10000 });
        const searchInput = await page.$(searchInputSelector);
        await searchInput.click({ clickCount: 3 });
        await page.keyboard.press('Backspace');
        await page.keyboard.type(subOrderNumber, { delay: 80 });

        await new Promise(resolve => setTimeout(resolve, 500));
        await page.keyboard.press('Enter');
        console.log("    ✅ Enter pressed — searching...");

        await new Promise(resolve => setTimeout(resolve, 5000));

        // 4. Extract Ticket ID from the dispute record
        const ticketId = await page.evaluate(() => {
            const ticketSpans = document.querySelectorAll('.dispute-details .dispute-value');
            // First .dispute-value in the row is the Ticket ID
            if (ticketSpans.length > 0) {
                return ticketSpans[0].textContent.trim();
            }
            return null;
        });

        if (ticketId) {
            console.log(`✅ Found Ticket ID: ${ticketId}`);
            return ticketId;
        } else {
            console.warn(`⚠️ Ticket ID not found for suborder ${subOrderNumber}`);
            return null;
        }
    } catch (err) {
        console.warn(`⚠️ Error while capturing Ticket ID: ${err.message}`);
        return null;
    }
}

module.exports = {
    enableStealthMode,
    handleDialog,
    snapdealLogin,
    navigateToReturns,
    navigateToDeliveredReturns,
    searchByAwbNumber,
    searchBySuborderId,
    searchByField,
    hasDeliveredReturnRecord,
    clickRaiseDispute,
    fillDisputeForm,
    htmlToText,
    getSnapdealTicketId,
};
