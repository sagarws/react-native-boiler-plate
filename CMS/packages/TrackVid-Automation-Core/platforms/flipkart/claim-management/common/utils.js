// -----------------------------------------------------------------------------
// Flipkart Seller Portal — Auto Claim utilities (Selenium, Node.js)
// -----------------------------------------------------------------------------
// Extracted from Automated-scripts/flipCartAutomation.js (the interactive
// skeleton) into a reusable helper module for the BE-driven auto-claim runner
// in scriptNew.js. Same locator + wait patterns proved out there; anything
// touching per-claim state (formData/orderId) is a pure function here so
// scriptNew.js can loop over configArr and reuse a single logged-in driver.
//
// Exports:
//   - buildDriver()                                          (chrome + stealth options)
//   - downloadFile(url, filename, tempPath)                  (remote URL → local file)
//   - flipkartLogin(driver, credentials)                     (landing → modal → next → password)
//   - openSpfClaimsPage(driver)                              (sidebar Payments hover → SPF option; searchQuery/Target kept for BC)
//   - openRaiseNewClaim(driver, claimArea)                   (Raise New Claim → area option)
//   - fillOrderIdAndProceed(driver, orderId)                 (Order-id modal → Proceed)
//   - fillClaimForm(driver, formData)                        (shipping label, area, type, desc, evidence)
//   - submitClaim(driver)                                    (click Submit + wait)
//   - getFlipkartTicketId(driver, orderId)                   (best-effort ticket capture)
// -----------------------------------------------------------------------------

const path = require("path");
const fs = require("fs-extra");
const axios = require("axios");
const { Builder, By, until, Key } = require("selenium-webdriver");
const chrome = require("selenium-webdriver/chrome");
const { GetFlipKartOTP, pollForOtp } = require("../../common/getOtp");
const { assertClaimSubmitEnabled } = require("../../../../common/claimSubmitGuard");
const { resolveExecutablePath, chromeServiceBuilder } = require("../../../../common/browserRuntime.js");
const { isHeadless } = require("../../../../common/headless.js");
const { settleBeforeOtpRead } = require("../../../../common/otpTiming.js");
const { track, forget } = require("../../../../common/openBrowsers.js");
const { waitForOtpInputs } = require("../../../../common/otpModal.js");
const { flipkartWindowExpired } = require("../../../../common/claimErrors");

// Long enough to outlast Flipkart's SMS/mail gateway. Overridable for a host
// with a slower one; the cost of waiting is a pause, the cost of not waiting is
// a sign-in that reports success without completing.
const OTP_MODAL_TIMEOUT_MS = Number(process.env.FLIPKART_OTP_MODAL_TIMEOUT_MS) || 30000;

// ---------------------------
// ⏱️ Timeouts & small helpers
// ---------------------------
const WAIT_TIMEOUT = 20000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Random sleep in [minMs, maxMs] — used only in login to avoid the
// perfectly-regular timing that bot detection watches for. Everything else
// keeps deterministic sleeps for reproducibility.
const humanSleep = (minMs, maxMs) => sleep(minMs + Math.floor(Math.random() * (maxMs - minMs)));

// Human-like typing for anti-bot login fields.
// Per-char delay is jittered (110–260ms). Every 3–6 chars we insert a longer
// 300–800ms "thinking" pause. A ~40ms micro-pause between keydown/keyup is
// approximated implicitly by ChromeDriver's dispatch model, so we only need
// to jitter the char-level cadence.
async function typeHuman(driver, el, value) {
    await driver.executeScript("arguments[0].scrollIntoView({block:'center'});", el);
    await humanSleep(200, 400);
    try { await el.click(); } catch (_) { await driver.executeScript("arguments[0].focus();", el); }
    await humanSleep(150, 300);
    // Clear any prefilled value first (works on mac + linux).
    await el.sendKeys(Key.chord(Key.COMMAND, "a"));
    await el.sendKeys(Key.BACK_SPACE);
    await el.sendKeys(Key.chord(Key.CONTROL, "a"));
    await el.sendKeys(Key.BACK_SPACE);
    await humanSleep(120, 250);

    const chars = String(value);
    let sincePause = 0;
    const pauseEvery = 3 + Math.floor(Math.random() * 4); // 3–6
    for (const ch of chars) {
        await el.sendKeys(ch);
        await humanSleep(110, 260);
        sincePause++;
        if (sincePause >= pauseEvery) {
            await humanSleep(300, 800);
            sincePause = 0;
        }
    }
}

// Re-throw selenium TimeoutError with a concise, label-based message instead
// of the full XPath. Keeps error logs readable when a locator misses.
async function waitFor(driver, label, condition, timeout = WAIT_TIMEOUT) {
    try {
        return await driver.wait(condition, timeout);
    } catch (err) {
        if (err && err.name === "TimeoutError") {
            const e = new Error(`Failed at step: ${label} (element not found within ${timeout}ms)`);
            e.name = "StepTimeoutError";
            throw e;
        }
        throw err;
    }
}

// Click with retry-on-intercept. Modal backdrops / cookie banners / tooltips
// sometimes intercept the click during their open/close animation; retrying
// gives the overlay time to settle, and JS click is the final fallback.
async function clickWhenReady(driver, locator, label) {
    console.log(`🖱️  Waiting for: ${label}`);
    const el = await waitFor(driver, label, until.elementLocated(locator));
    await waitFor(driver, `${label} (visible)`, until.elementIsVisible(el));
    await waitFor(driver, `${label} (enabled)`, until.elementIsEnabled(el));
    await driver.executeScript("arguments[0].scrollIntoView({block:'center'});", el);
    await sleep(300);

    const MAX_TRIES = 4;
    for (let attempt = 1; attempt <= MAX_TRIES; attempt++) {
        try {
            await el.click();
            console.log(`    ✅ Clicked: ${label}`);
            return el;
        } catch (err) {
            const isIntercepted = err && err.name === "ElementClickInterceptedError";
            if (!isIntercepted || attempt === MAX_TRIES) {
                if (isIntercepted) {
                    console.log(`    ⚠️  Click intercepted ${attempt}/${MAX_TRIES}, falling back to JS click`);
                    await driver.executeScript("arguments[0].click();", el);
                    console.log(`    ✅ Clicked via JS: ${label}`);
                    return el;
                }
                throw err;
            }
            console.log(`    ⏳ Click intercepted ${attempt}/${MAX_TRIES}, waiting for overlay to clear...`);
            await sleep(800);
        }
    }
    return el;
}



// ---------------------------
// 📥 Download File Helper (shared pattern with Myntra/Snapdeal)
// ---------------------------
// BE hands us signed S3 URLs; Selenium's file input needs a local path, so
// stream them into tempPath first. Local paths pass through untouched.
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

async function downloadFile(url, filename, tempPath) {
    if (!url) return null;
    if (!/^https?:\/\//i.test(url)) return url; // Already a local path
    try {
        const response = await axios.get(url, { responseType: "arraybuffer", timeout: 30000 });
        const ext = path.extname(new URL(url).pathname) || ".jpg";
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
// 🌐 Browser launcher (stealth options baked in)
// ---------------------------
/**
 * @param {object} [options]
 * @param {boolean} [options.headless] overrides the environment/company policy.
 *        Omit and the shared `isHeadless()` decides, which is what the server
 *        does. A caller passes `false` when the run may need a PERSON — a
 *        headless browser cannot be typed into, so a one-time code prompt in
 *        one is a guaranteed timeout rather than a challenge.
 */
async function buildDriver({ headless } = {}) {
    const options = new chrome.Options();
    // HEADLESS=false → visible browser; default (unset) headless.
    const HEADLESS = headless === undefined ? isHeadless() : headless;
    if (HEADLESS) options.addArguments("--headless=new");

    options.addArguments(
        "--window-size=1440,900",
        "--disable-blink-features=AutomationControlled",
        "--no-sandbox",
        "--disable-dev-shm-usage",
        "--disable-notifications",
    );
    options.excludeSwitches("enable-automation");
    options.setUserPreferences({
        credentials_enable_service: false,
        "profile.password_manager_enabled": false,
        // Flipkart shows a native "site would like to send you notifications"
        // prompt right after login that blocks all interaction. Disable it.
        "profile.default_content_setting_values.notifications": 2,
    });

    // A binary this process was told to use wins; otherwise the server's
    // production path. See common/browserRuntime.js.
    const binary = resolveExecutablePath(
        process.env.NODE_ENV === "production" ? "/usr/bin/google-chrome" : undefined
    );
    if (binary) {
        options.setChromeBinaryPath(binary);
    }

    let builder = new Builder().forBrowser("chrome").setChromeOptions(options);
    // Selenium needs the driver as well as the browser, and they must match on
    // major version. The desktop app pins both; the server leaves this null and
    // Selenium finds chromedriver on PATH.
    const service = chromeServiceBuilder();
    if (service) builder = builder.setChromeService(service);

    // TRACKED while it is open, so a sign-out can end it mid-step rather than
    // leaving a marketplace being driven for a company the app has just left.
    // See common/openBrowsers — `destroyDriver` below is the matching forget.
    const driver = track(await builder.build());

    await driver.manage().setTimeouts({ implicit: 0, pageLoad: 60000 });
    await driver.manage().window().setRect({ width: 1440, height: 900 });
    return driver;
}

/** Quit the driver, and stop remembering it. */
async function destroyDriver(driver) {
    if (!driver) return;

    forget(driver);

    try {
        await driver.quit();
    } catch (_) {
        /* already gone */
    }
}

// ---------------------------
// 🔐 OTP challenge (conditional)
// ---------------------------
// After a password login, Flipkart sometimes shows a 6-digit OTP modal
// (email + phone). No-op if the modal never appears. When it does we poll
// Gmail via platforms/flipkart/common/getOtp for the fresh OTP mail sent to the
// account's registered email, then type it into the 6 `.otp-input` boxes
// and Enter on the last one to nudge auto-submit.
//
// `otpEmail` is the address the Flipkart OTP mail is delivered to (usually
// == credentials.username, but a seller can register a separate address).
// `sinceDate` is a cutoff — anything older is ignored, so a stale OTP from
// a previous run is never picked up.
async function fetchLatestFlipkartOtp(otpEmail, sinceDate, timeoutMs = 90000) {
    // The waiting, the shape check and the quiet give-up are shared with the
    // desktop app's own lookup — see pollForOtp. Only the fetch differs.
    return pollForOtp(() => GetFlipKartOTP(otpEmail, { since: sinceDate }), {
        timeoutMs,
        intervalMs: 3000,
        // A transient IMAP error says nothing about whether the mail exists.
        retryOnError: true,
    });
}

// Best-effort click on a "Resend OTP" / "Resend Code" control if visible.
// Flipkart usually gates this behind a countdown, so it may be disabled —
// silently no-op in that case. Returns true if we managed to click.
async function tryClickResendOtp(driver) {
    const XPATH =
        "//button[contains(translate(normalize-space(.), 'RESND', 'resnd'), 'resend')]" +
        " | //a[contains(translate(normalize-space(.), 'RESND', 'resnd'), 'resend')]" +
        " | //*[@role='button'][contains(translate(normalize-space(.), 'RESND', 'resnd'), 'resend')]";
    try {
        const btns = await driver.findElements(By.xpath(XPATH));
        for (const btn of btns) {
            try {
                if (!(await btn.isDisplayed())) continue;
                const disabled = await btn.getAttribute("disabled");
                const ariaDisabled = await btn.getAttribute("aria-disabled");
                if (disabled !== null || ariaDisabled === "true") continue;
                try { await btn.click(); }
                catch (_) { await driver.executeScript("arguments[0].click();", btn); }
                console.log("    🔄 Clicked 'Resend OTP'");
                return true;
            } catch (_) { /* keep scanning */ }
        }
    } catch (_) { /* noop */ }
    return false;
}

/**
 * Wait for a PERSON to type the code, instead of fetching it.
 *
 * The desktop app runs this browser visibly on an operator's own machine, so
 * the code is already in their hand — Flipkart sent it to them. Reading their
 * mailbox to save them six keystrokes would mean shipping IMAP credentials to
 * every installation, which is a far worse trade than a short wait.
 *
 * Success is the modal disappearing, exactly as it is on the fetched path.
 */
async function waitForOperatorOtp(driver, OTP_INPUT_CSS, timeoutMs) {
    console.log(
        `    🧑 Flipkart is asking for a one-time code. It was sent to the account's registered email — ` +
        `enter it in the browser window. Waiting up to ${Math.round(timeoutMs / 1000)}s...`
    );

    // Bring the window forward. The operator cannot answer a prompt they never
    // saw, and this browser opens behind whatever they were doing.
    try {
        await driver.manage().window().maximize();
    } catch (_) { /* best-effort — never fail a login over window placement */ }

    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
        const stillThere = await driver.findElements(By.css(OTP_INPUT_CSS));

        if (stillThere.length === 0) {
            console.log("    ✅ OTP accepted — modal closed");

            return true;
        }

        await sleep(1000);
    }

    throw new Error(
        `OTP_ENTRY_FAILED: nobody entered the one-time code within ${Math.round(timeoutMs / 1000)}s. ` +
        "Flipkart sent it to the account's registered email. The browser window stays open while it waits — " +
        "run this again and type the code there."
    );
}

// Type a 6-digit OTP into the 6 `.otp-input` boxes. Clears each box first so
// a stale/wrong OTP left over from a previous attempt doesn't get appended.
async function enterOtpDigits(driver, otp, OTP_INPUT_CSS) {
    const inputs = await driver.findElements(By.css(OTP_INPUT_CSS));
    if (inputs.length < 6) {
        throw new Error(`OTP_ENTRY_FAILED: OTP inputs disappeared before we could fill them (found ${inputs.length})`);
    }
    const digits = otp.split("").slice(0, 6);
    for (let i = 0; i < 6; i++) {
        const el = inputs[i];
        try { await el.click(); }
        catch (_) { await driver.executeScript("arguments[0].focus();", el); }
        // Clear any prior digit — on a wrong-OTP retry Flipkart sometimes
        // leaves the boxes populated with the previous entry.
        try {
            await el.sendKeys(Key.chord(Key.COMMAND, "a"));
            await el.sendKeys(Key.BACK_SPACE);
            await el.sendKeys(Key.chord(Key.CONTROL, "a"));
            await el.sendKeys(Key.BACK_SPACE);
        } catch (_) { /* noop */ }
        await el.sendKeys(digits[i]);
        await sleep(120);
    }
    try { await inputs[5].sendKeys(Key.ENTER); } catch (_) { /* noop */ }
}

async function handleOtpChallenge(
    driver,
    credentials,
    otpRequestedAt,
    { fetchOtp = fetchLatestFlipkartOtp, operatorTimeoutMs = 180000, operatorFallback = false } = {},
) {
    console.log("⏳ Watching for an OTP challenge modal...");

    // Detection is delegated to common/otpModal so it survives a Flipkart
    // redesign. Their modal is CSS-in-JS — `sc-pLyGp JpPRk` — so any selector
    // written against those class names dies at their next deploy. The shared
    // probe tries the semantic and accessible names first and falls back to
    // what an OTP box structurally IS: a short run of single-character inputs.
    //
    // The window is also no longer 8 seconds. The modal only appears after
    // Flipkart has actually SENT the code, which is a round trip to an SMS
    // gateway; 8s was routinely shorter than that, so a modal about to appear
    // was reported as "no OTP modal" and the sign-in continued as if it had
    // succeeded — which is what you see as a login that silently does nothing.
    const detected = await waitForOtpInputs(
        (script) => driver.executeScript(`return ${script}`),
        { timeoutMs: OTP_MODAL_TIMEOUT_MS }
    );

    if (!detected.found) {
        console.log("    (no OTP modal — continuing)");
        return false;
    }

    console.log(`    🔢 OTP modal found: ${detected.count} inputs (matched by ${detected.matchedBy})`);

    // Re-read through the matching selector so the digits go into the boxes the
    // probe actually found, not a guess about which selector won.
    const OTP_INPUT_CSS = detected.matchedBy;
    let inputs = await driver.findElements(By.css(OTP_INPUT_CSS));

    // WHO SUPPLIES THE CODE. On the server it is Gmail, read with IMAP
    // credentials that only the server has. The desktop app has none of that —
    // and by design must not read automation env keys — but it does have
    // something better: a person sitting in front of a visible browser. Passing
    // `fetchOtp: null` means "wait for them to type it", which is the same
    // contract the app's other scripted sign-ins already use.
    if (fetchOtp === null) {
        return waitForOperatorOtp(driver, OTP_INPUT_CSS, operatorTimeoutMs);
    }

    const otpEmail = credentials.otpEmail || credentials.username;
    if (!otpEmail) {
        throw new Error("OTP_FETCH_FAILED: no email available (credentials.otpEmail or .username)");
    }

    // Flipkart dispatches the OTP mail a few seconds after the login click, and
    // the mailbox mirror lags behind that. Reading immediately does not just
    // burn a fetch cycle finding nothing — it can return the PREVIOUS code,
    // which the portal retired the moment it sent this one, and the login then
    // fails on a code that was correct five minutes ago. Ten seconds was not
    // margin enough in practice; the shared settle is where that number lives
    // now. See common/otpTiming.
    await settleBeforeOtpRead("flipkart", { reason: "after the login click" });

    // Try entering an OTP up to MAX_OTP_ATTEMPTS times. If the first OTP is
    // rejected (modal doesn't close within 15s), Flipkart likely didn't accept
    // it — wait 10s (some flows auto-send a new OTP; otherwise click Resend),
    // pull a FRESH OTP mail (new cutoff), and retry. Throw OTP_WRONG on final
    // failure so the outer login retry loop reopens the browser instead of
    // pressing on with a broken session.
    const MAX_OTP_ATTEMPTS = 2;
    let cutoff = otpRequestedAt;

    for (let attempt = 1; attempt <= MAX_OTP_ATTEMPTS; attempt++) {
        console.log(`    🔐 OTP attempt ${attempt}/${MAX_OTP_ATTEMPTS} — polling Gmail for OTP to ${otpEmail}`);
        const otp = await fetchOtp(otpEmail, cutoff);
        if (!otp) {
            // Nothing arrived. On the server that is the end of it — there is
            // nobody to ask. Where there IS somebody (the desktop app, with
            // this browser on their screen), handing over beats failing a claim
            // over a mail that was slow or went to a mailbox we cannot read.
            if (operatorFallback) {
                console.log(`    ↩️ No OTP mail found for ${otpEmail} — asking the operator instead`);

                return waitForOperatorOtp(driver, OTP_INPUT_CSS, operatorTimeoutMs);
            }

            throw new Error(`OTP_FETCH_FAILED: no fresh Flipkart OTP arrived for ${otpEmail} within 90s`);
        }
        if (otp.length < 6) {
            throw new Error(`OTP_FETCH_FAILED: OTP '${otp}' is shorter than 6 digits`);
        }
        console.log(`    📥 Fetched OTP: ${otp}`);

        // Modal may have closed while we were polling Gmail (rare — user
        // dismissed, or a stale-session auto-continue).
        inputs = await driver.findElements(By.css(OTP_INPUT_CSS));
        if (inputs.length === 0) {
            console.log("    ✅ OTP modal closed while polling — no entry needed");
            return true;
        }

        await enterOtpDigits(driver, otp, OTP_INPUT_CSS);

        // Wait for the modal to disappear (inputs are removed from the DOM
        // on successful verification).
        const CLOSE_DEADLINE = Date.now() + 15000;
        let closed = false;
        while (Date.now() < CLOSE_DEADLINE) {
            const stillThere = await driver.findElements(By.css(OTP_INPUT_CSS));
            if (stillThere.length === 0) {
                console.log(`    ✅ OTP accepted — modal closed (attempt ${attempt})`);
                closed = true;
                break;
            }
            await sleep(500);
        }
        if (closed) return true;

        if (attempt < MAX_OTP_ATTEMPTS) {
            console.log("    ⚠️  OTP modal still visible after 15s — assuming wrong OTP, requesting resend...");
            // Best-effort: click Resend so Flipkart mails a new code. If the
            // resend button is behind a countdown timer it'll no-op; a new
            // cutoff still filters out the (now-stale) first OTP.
            await tryClickResendOtp(driver);
            // Same wait, same reason, and more acute here: the code just
            // typed is still the newest mail in the box, so a quick read hands
            // it straight back and the retry fails identically.
            cutoff = new Date();
            await settleBeforeOtpRead("flipkart", { reason: "after the resend" });
        }
    }

    throw new Error(
        "OTP_WRONG: Flipkart did not accept the OTP after retry — " +
        "likely wrong/expired OTP or bot detection. Reopening browser for a fresh session."
    );
}

// ---------------------------
// 🔑 Flipkart login
// ---------------------------
// Landing → Login button → modal → username → Next (auto-enables) → password →
// Login. Post-login we don't hard-fail on redirect timeout so an operator can
// eyeball a stalled captcha in non-headless mode.
/**
 * @param {object} driver
 * @param {{username: string, password: string, otpEmail?: string}} credentials
 * @param {object} [options]
 * @param {Function|null} [options.fetchOtp] where the one-time code comes from.
 *        Defaults to reading the account's Gmail — what the server does. Pass
 *        `null` to wait for a person to type it into the visible browser, which
 *        is the only option on a machine without the server's IMAP credentials.
 * @param {number} [options.operatorTimeoutMs] how long to wait for that person.
 * @param {boolean} [options.operatorFallback] when a lookup finds no mail, ask
 *        the operator instead of failing. Only meaningful where somebody is
 *        actually watching the browser, which is why it is off by default.
 */
async function flipkartLogin(
    driver,
    credentials,
    { fetchOtp = fetchLatestFlipkartOtp, operatorTimeoutMs = 180000, operatorFallback = false } = {},
) {
    const { username, password } = credentials || {};
    if (!username || !password) {
        throw new Error("LOGIN_FAILED: missing username or password");
    }

    const url = process.env.FLIPKART_LOGIN_URL || "https://seller.flipkart.com/";
    console.log(`🌐 Navigating to ${url}`);
    await driver.get(url);
    // Longer initial settle so bot-detection / analytics finish bootstrapping
    // before we start interacting. Slow-start is a strong human signal.
    await humanSleep(6000, 8500);

    // Flipkart's edge occasionally serves an nginx "502 Bad Gateway" HTML page
    // on cold navigation; the landing "Login" button doesn't exist there and
    // the whole flow would fail. Detect it and reload a few times before
    // giving up.
    const isBadGateway = async () => {
        try {
            return await driver.executeScript(
                "return /502\\s*Bad\\s*Gateway/i.test(document.title || '') " +
                "|| !!document.querySelector('h1') && /502\\s*Bad\\s*Gateway/i.test(document.querySelector('h1').textContent || '');"
            );
        } catch (_) { return false; }
    };
    const maxReloads = 4;
    for (let attempt = 1; attempt <= maxReloads && (await isBadGateway()); attempt++) {
        console.warn(`⚠️ Flipkart returned 502 Bad Gateway (attempt ${attempt}/${maxReloads}) — reloading...`);
        try { await driver.navigate().refresh(); } catch (_) { await driver.get(url); }
        await humanSleep(4000, 6500);
        if (attempt === maxReloads && (await isBadGateway())) {
            throw new Error("LOGIN_FAILED: Flipkart edge served 502 Bad Gateway on every reload attempt");
        }
    }

    console.log(`📍 Landed at: ${await driver.getCurrentUrl()}`);

    // Step 1 — landing "Login" button
    await clickWhenReady(
        driver,
        By.xpath("//button[normalize-space()='Login']"),
        "'Login' button (landing)",
    );

    // Step 2 — wait for the modal + username input, then "reading" pause
    console.log("⏳ Waiting for login modal + username input...");
    const usernameEl = await waitFor(
        driver,
        "username input in modal",
        until.elementLocated(By.css('input[name="username"]')),
    );
    await humanSleep(1400, 2400);

    // Step 3 — type username slowly, click Next once it enables
    console.log(`⌨️  Typing username slowly...`);
    await typeHuman(driver, usernameEl, username);
    await humanSleep(800, 1600);

    console.log("⏳ Waiting for Next button to enable...");
    const nextBtn = await waitFor(
        driver,
        "'Next' button (located)",
        until.elementLocated(By.xpath("//button[.//span[normalize-space()='Next']]")),
    );
    await driver.wait(async () => {
        const disabled = await nextBtn.getAttribute("disabled");
        return disabled === null;
    }, 10000, "'Next' button never became enabled");
    await driver.executeScript("arguments[0].scrollIntoView({block:'center'});", nextBtn);
    // Small "hover-then-click" delay — humans don't fire click the same
    // millisecond the mouse arrives.
    try {
        await driver.actions({ async: true }).move({ origin: nextBtn }).perform();
    } catch (_) { /* noop */ }
    await humanSleep(400, 900);
    try { await nextBtn.click(); } catch (_) { await driver.executeScript("arguments[0].click();", nextBtn); }
    console.log("    ✅ Clicked: 'Next' button");

    // Step 4 — password + Login submit
    //
    // Flipkart's modal transitions username→password via a React re-render, so
    // `until.elementLocated` can resolve on the OLD (about-to-be-detached) input
    // while the transition is in flight. Then `typeHuman` fires per-character
    // WebDriver calls — if the field gets re-mounted mid-typing, the next key
    // hits a detached element and Selenium throws `element not interactable`,
    // which the outer catch treats as session-fatal and tears the browser down.
    //
    // Fix: wait for visible + enabled (not just present), click to force focus,
    // then retry ONCE on stale-reference / not-interactable by re-locating and
    // retyping. Covers both the transition race and any single re-mount blip.
    console.log("⏳ Waiting for password input to be interactable...");
    await humanSleep(1800, 3000);
    const locatePwd = () => driver.findElement(By.css('input[name="password"]'));
    let passwordEl = await waitFor(
        driver,
        "password input",
        until.elementLocated(By.css('input[name="password"]')),
    );
    try {
        await driver.wait(until.elementIsVisible(passwordEl), 10000, "password input not visible");
        await driver.wait(until.elementIsEnabled(passwordEl), 10000, "password input not enabled");
    } catch (_) {
        // Original reference may have detached during the transition — re-locate
        // and re-check on the fresh one.
        passwordEl = await locatePwd();
        await driver.wait(until.elementIsVisible(passwordEl), 5000, "password input not visible (retry)");
        await driver.wait(until.elementIsEnabled(passwordEl), 5000, "password input not enabled (retry)");
    }
    await driver.executeScript("arguments[0].scrollIntoView({block:'center'});", passwordEl);
    try { await passwordEl.click(); } catch (_) { /* focus is best-effort */ }
    await humanSleep(250, 550);

    console.log(`⌨️  Typing password slowly...`);
    try {
        await typeHuman(driver, passwordEl, password);
    } catch (err) {
        if (!/not interactable|stale element/i.test(err.message || "")) throw err;
        console.warn(`⚠️ Password field went stale mid-typing (${err.message}) — re-locating and retyping...`);
        await humanSleep(600, 1100);
        const fresh = await locatePwd();
        await driver.wait(until.elementIsVisible(fresh), 5000, "password input not visible (post-stale)");
        await driver.wait(until.elementIsEnabled(fresh), 5000, "password input not enabled (post-stale)");
        // Clear any partial value the first attempt may have committed before it broke.
        try { await driver.executeScript("arguments[0].value='';", fresh); } catch (_) { /* noop */ }
        try { await fresh.click(); } catch (_) { /* noop */ }
        await humanSleep(200, 400);
        await typeHuman(driver, fresh, password);
        passwordEl = fresh;
    }
    await humanSleep(900, 1800);

    // Scope to the login-modal footer. The landing-page "Login" launcher was
    // already clicked earlier and may still linger in the DOM (hidden by the
    // modal overlay); an unscoped XPath sometimes returned that stale reference,
    // producing a "click" that never dismissed the modal.
    const LOGIN_SUBMIT_XPATH_PRIMARY =
        "//div[contains(@class,'login-modal-footer')]//button[.//span[normalize-space()='Login']]";
    const LOGIN_SUBMIT_XPATH_FALLBACK =
        "//form//button[.//span[normalize-space()='Login']]";
    const locateLoginSubmit = async () => {
        try {
            return await driver.findElement(By.xpath(LOGIN_SUBMIT_XPATH_PRIMARY));
        } catch (_) {
            return await driver.findElement(By.xpath(LOGIN_SUBMIT_XPATH_FALLBACK));
        }
    };
    let loginBtn;
    try {
        loginBtn = await waitFor(
            driver,
            "'Login' button in modal (scoped to modal footer)",
            until.elementLocated(By.xpath(LOGIN_SUBMIT_XPATH_PRIMARY)),
        );
    } catch (_) {
        loginBtn = await waitFor(
            driver,
            "'Login' button in modal (form-scoped fallback)",
            until.elementLocated(By.xpath(LOGIN_SUBMIT_XPATH_FALLBACK)),
        );
    }
    await driver.wait(async () => {
        const disabled = await loginBtn.getAttribute("disabled");
        return disabled === null;
    }, 10000, "'Login' button never became enabled");
    await driver.executeScript("arguments[0].scrollIntoView({block:'center'});", loginBtn);
    try {
        await driver.actions({ async: true }).move({ origin: loginBtn }).perform();
    } catch (_) { /* noop */ }
    await humanSleep(500, 1100);
    // Capture the OTP request cutoff BEFORE the click so any mail arriving
    // after this instant is considered fresh, and any older OTP is ignored.
    const otpRequestedAt = new Date();

    // Click, then verify we actually advanced past the PASSWORD step. Flipkart
    // reuses the same modal container for every step (username → password →
    // OTP), so a simple "modal still open" check false-triggers when the modal
    // just transitions to OTP. What we actually want to know is whether the
    // Login-labeled submit button is still present in the footer — if so, our
    // click didn't submit; if it's gone, we've advanced (to OTP, to the
    // dashboard, or to an inline error) and the OTP handler / URL check
    // downstream will take it from here.
    const stillOnPasswordStep = async () => {
        try {
            const el = await driver.findElement(
                By.xpath(LOGIN_SUBMIT_XPATH_PRIMARY)
            );
            return await el.isDisplayed();
        } catch (_) { return false; }
    };
    const clickLogin = async () => {
        try { await loginBtn.click(); } catch (_) { await driver.executeScript("arguments[0].click();", loginBtn); }
    };

    await clickLogin();
    console.log("    ✅ Clicked: 'Login' submit");
    await humanSleep(2500, 3800);

    if (await stillOnPasswordStep()) {
        console.warn("⚠️ Still on password step after click (Login button still present) — retrying via JS click on freshly-located button...");
        try {
            loginBtn = await locateLoginSubmit();
            await driver.executeScript("arguments[0].click();", loginBtn);
        } catch (err) {
            // If we can't locate the Login button on retry, the modal already
            // advanced between our check and the re-locate — treat as success.
            console.warn(`⚠️ Retry locate/click no-op (modal likely already advanced): ${err.message}`);
        }
        await humanSleep(3500, 5000);
        if (await stillOnPasswordStep()) {
            throw new Error(
                "LOGIN_FAILED: Login submit clicked but the password step never advanced — " +
                "Flipkart likely rejected credentials, triggered reCAPTCHA, or is showing an inline error. " +
                "Verify credentials manually and check for captcha/lockout on this account."
            );
        }
        console.log("    ✅ Password step advanced on retry");
    }

    // Conditional 2FA — Flipkart may pop a 6-digit OTP modal here. No-op if
    // the modal never appears; otherwise pulls the fresh OTP from Gmail.
    await handleOtpChallenge(driver, credentials, otpRequestedAt, { fetchOtp, operatorTimeoutMs, operatorFallback });

    console.log("⏳ Waiting for post-login redirect...");
    // Longer post-login settle: gives Flipkart time to fingerprint the
    // session and hand out the dashboard without triggering a re-challenge.
    await humanSleep(8000, 11000);
    console.log(`📍 Post-login URL: ${await driver.getCurrentUrl()}`);

    // Verify we're actually inside the seller dashboard. If we're still on the
    // landing page (or the Payments rail never appears), the OTP was likely
    // rejected silently or bot detection served a decoy — throw an OTP-tagged
    // error so the outer login retry loop reopens the browser. This prevents
    // the failure from cascading into a "Payments rail trigger not found"
    // session-level error that would fail every AWB in the batch.
    try {
        await driver.wait(async () => {
            const url = await driver.getCurrentUrl();
            if (/dashboard/i.test(url)) return true;
            const paymentsTrigger = await driver.findElements(
                By.css('#trigger-nav-menu-Payments, [data-testid="trigger-menu-nav-menu-Payments"]'),
            );
            return paymentsTrigger.length > 0;
        }, 30000, "post-login dashboard never became visible");
    } catch (_) {
        const currentUrl = await driver.getCurrentUrl();
        throw new Error(
            `OTP_WRONG: post-login verification failed — still at ${currentUrl} with no Payments rail visible. ` +
            "OTP was likely rejected. Reopening browser for a fresh session."
        );
    }

    // Post-login "Congratulations 🎉 You are now a Seller on Flipkart" welcome
    // modal — a React portal (ReactModal__Content) that some accounts see on
    // fresh sessions. It has a lottie animation, a "Get Started" primary button,
    // and it blocks all sidebar clicks until dismissed (e.g. Payments rail).
    // Poll briefly (the modal can render a couple of seconds after the dashboard)
    // and click the button if present. Non-fatal: most sessions never see it.
    await dismissWelcomeModal(driver);
}

/**
 * Dismiss the post-login "Congratulations 🎉 You are now a Seller on Flipkart"
 * welcome modal by clicking its "Get Started" button. No-op if the modal never
 * appears within the poll window — the modal only shows on a subset of sessions
 * and would otherwise block sidebar nav (Payments rail, SPF Claims) later.
 */
async function dismissWelcomeModal(driver, { pollMs = 8000, intervalMs = 400 } = {}) {
    const WELCOME_BTN_XPATH =
        "//div[contains(@class,'ReactModal__Content')]//button[normalize-space()='Get Started']";
    const deadline = Date.now() + pollMs;
    while (Date.now() < deadline) {
        try {
            const btn = await driver.findElement(By.xpath(WELCOME_BTN_XPATH));
            if (await btn.isDisplayed()) {
                try { await btn.click(); }
                catch (_) { await driver.executeScript("arguments[0].click();", btn); }
                console.log("    ✅ Dismissed 'Congratulations' welcome modal (Get Started).");
                await humanSleep(1500, 2500);
                return true;
            }
        } catch (_) { /* element not present yet — keep polling */ }
        await new Promise((r) => setTimeout(r, intervalMs));
    }
    // Not present within window — normal for repeat sessions. Silent.
    return false;
}

// -----------------------------------------------------------------------------
// 🔎 Universal search: launcher → modal input → result click
// -----------------------------------------------------------------------------
// Sidebar-nav approach: hover the Payments rail item to open its popover
// menu, then click the "Seller Protection Fund (SPF)" option. The SPF option
// navigates via a hash route (#dashboard/payments/spf) — same tab, no window
// switching needed.
//
// `searchQuery` / `searchTarget` are ignored (kept for backwards-compat with
// existing callers that still pass them from configArr).
/**
 * Go straight to the SPF Claims route, without touching the sidebar.
 *
 * The sidebar path below is three fragile steps — hover a rail item, wait for a
 * `popover="auto"` that Chrome hides the moment the cursor drifts, click an
 * option inside it — and every one of them needs the dashboard chrome to have
 * rendered. It usually has. When it has not, the run failed at "Payments rail
 * trigger" with 20 seconds of nothing, and the claim was reported as broken
 * even though the session was fine and the page it wanted is a plain URL.
 *
 * So: read the anchor's href if it exists anywhere in the DOM, and otherwise
 * construct the hash route. Verified the same way the sidebar path is — by the
 * URL actually becoming the SPF route — so this cannot "succeed" onto a login
 * page or a half-loaded dashboard.
 */
async function gotoSpfDirect(driver) {
    const SPF_HREF_CSS = 'a[href*="dashboard/payments/spf"]';

    let target = null;

    try {
        const anchors = await driver.findElements(By.css(SPF_HREF_CSS));

        if (anchors.length > 0) target = await anchors[0].getAttribute("href");
    } catch (_) { /* fall through to the constructed route */ }

    const origin = (process.env.FLIPKART_LOGIN_URL || "https://seller.flipkart.com/").replace(/\/+$/, "");
    const candidates = [target, `${origin}/#dashboard/payments/spf`, `${origin}/index.html#dashboard/payments/spf`]
        .filter(Boolean);

    for (const url of candidates) {
        console.log(`    🧭 Navigating directly to ${url}`);

        try {
            await driver.get(url);
            await sleep(3000);

            const landed = await driver.getCurrentUrl();

            // THE URL PROVES NOTHING HERE. `#dashboard/payments/spf` is a hash
            // fragment, and a hash never fails to "land": a signed-out browser
            // serves Flipkart's public "Start Selling" marketing page at that
            // exact address, with a 200 and the fragment intact. Checking the
            // URL alone reported that as success, and the run went on to hunt
            // for a Raise New Claim button on a page that has a Login button.
            //
            // So the page itself has to say it is the dashboard. The sidebar
            // rail is the same thing the sign-in verifies with, and the public
            // page has nothing like it.
            const onDashboard = landed.includes("dashboard/payments/spf") && (await isDashboardLoaded(driver));

            if (onDashboard) {
                console.log(`📍 SPF Claims URL: ${landed}`);

                return true;
            }

            console.log(
                `    ↩️ ${landed} is not a signed-in dashboard` +
                (landed.includes("dashboard/payments/spf") ? " (the public site answers this route too)" : "")
            );
        } catch (err) {
            console.log(`    ↩️ Navigation failed: ${err.message}`);
        }
    }

    return false;
}

/**
 * Is this a real, signed-in seller dashboard — not the public site wearing the
 * same URL?
 *
 * The rail is the same element `flipkartLogin` verifies itself with. Sharing
 * the signal matters: a second, laxer definition of "we are in" is how a
 * signed-out page passed for a dashboard in the first place.
 */
async function isDashboardLoaded(driver, timeoutMs = 10000) {
    const RAIL_CSS = '#trigger-nav-menu-Payments, [data-testid="trigger-menu-nav-menu-Payments"]';

    try {
        await driver.wait(async () => {
            return (await driver.findElements(By.css(RAIL_CSS))).length > 0;
        }, timeoutMs, "dashboard sidebar never appeared");

        return true;
    } catch (_) {
        return false;
    }
}

async function openSpfClaimsPage(driver, /* searchQuery */ _q, /* searchTarget */ _t) {
    console.log("\n🧭 Opening SPF Claims via sidebar (Payments → Seller Protection Fund)");

    // A post-login welcome modal covers the whole dashboard and swallows every
    // sidebar click underneath it. The login dismisses it, but a REUSED session
    // never went through the login — and the modal reappears on some accounts.
    await dismissWelcomeModal(driver).catch(() => { /* never blocks navigation */ });

    const TRIGGER_CSS =
        '#trigger-nav-menu-Payments, [data-testid="trigger-menu-nav-menu-Payments"]';
    const POPOVER_CSS =
        '#content-nav-menu-Payments, [data-testid="content-menu-nav-menu-Payments"]';
    const SPF_OPTION_CSS =
        '[data-testid="option-item-Seller Protection Fund (SPF)-nav-menu-Payments"]';
    // Fallback anchor if the testid pattern ever drifts — the hash target
    // is stable ("#dashboard/payments/spf").
    const SPF_HREF_CSS = 'a[href*="dashboard/payments/spf"]';

    // Step 1 — hover the Payments rail item.
    //
    // Its absence is no longer fatal: the sidebar is a convenience, and the SPF
    // page is reachable by URL. Only the direct route failing means we really
    // cannot get there.
    let trigger;

    try {
        trigger = await waitFor(
            driver,
            "Payments rail trigger",
            until.elementLocated(By.css(TRIGGER_CSS)),
        );
    } catch (err) {
        console.warn(`⚠️ ${err.message} — trying the SPF route directly`);

        if (await gotoSpfDirect(driver)) return;

        throw new Error(
            "Failed at step: Payments rail trigger — the dashboard sidebar never rendered AND the SPF " +
            "route could not be opened directly. The session is probably signed out or the dashboard " +
            "did not finish loading."
        );
    }
    await driver.executeScript("arguments[0].scrollIntoView({block:'center'});", trigger);
    await sleep(300);
    try {
        await driver.actions({ async: true }).move({ origin: trigger }).perform();
    } catch (_) {
        // Very rare fallback if move() fails on this webdriver build.
        await driver.executeScript(
            "arguments[0].dispatchEvent(new MouseEvent('mouseover',{bubbles:true}));",
            trigger,
        );
    }
    console.log("    🖱️  Hovered: Payments");

    // Step 2 — wait for the popover menu container to appear AND for the SPF
    // option to render inside it. Popover uses HTML `popover="auto"`, which
    // Chrome shows on hover but hides quickly if the cursor leaves — so we
    // re-hover once if needed.
    let spfOption = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
        try {
            await waitFor(
                driver,
                "Payments popover menu",
                until.elementLocated(By.css(POPOVER_CSS)),
                5000,
            );
            spfOption = await driver.wait(async () => {
                const primary = await driver.findElements(By.css(SPF_OPTION_CSS));
                if (primary.length > 0) return primary[0];
                const fallback = await driver.findElements(By.css(SPF_HREF_CSS));
                return fallback[0] || null;
            }, 5000, "SPF option never appeared inside Payments popover");
            break;
        } catch (err) {
            if (attempt === 3) {
                console.warn(`⚠️ ${err.message} — trying the SPF route directly`);

                if (await gotoSpfDirect(driver)) return;

                throw err;
            }
            console.log(`    ⏳ Popover not settled (${attempt}/3), re-hovering...`);
            try {
                await driver.actions({ async: true }).move({ origin: trigger }).perform();
            } catch (_) { /* noop */ }
            await sleep(500);
        }
    }

    // Step 3 — click the SPF option. Use JS click as the primary path
    // because native click can miss during the popover's open animation.
    await driver.executeScript("arguments[0].scrollIntoView({block:'center'});", spfOption);
    await sleep(200);
    try { await spfOption.click(); }
    catch (_) { await driver.executeScript("arguments[0].click();", spfOption); }
    console.log("    ✅ Clicked: Seller Protection Fund (SPF)");

    // Step 4 — wait for the SPF hash route to become active before returning
    // so subsequent steps see the SPF Claims page, not the transitional state.
    await driver.wait(async () => {
        const url = await driver.getCurrentUrl();
        return url.includes("dashboard/payments/spf");
    }, 15000, "SPF Claims URL never loaded");
    await sleep(3000);
    console.log(`📍 SPF Claims URL: ${await driver.getCurrentUrl()}`);
}

// -----------------------------------------------------------------------------
// ➕ "Raise New Claim" dropdown → pick claim area option
// -----------------------------------------------------------------------------
async function openRaiseNewClaim(driver, claimArea) {
    await clickWhenReady(
        driver,
        By.css('[data-testid="raise-new-claim-primary-button"]'),
        "'Raise New Claim' dropdown trigger",
    );
    await waitFor(
        driver,
        "'Raise New Claim' menu",
        until.elementLocated(By.css('[data-testid="menu-items-raise-new-claim"]')),
    );
    await sleep(500);
    // The option's testid is keyed by the visible label — normalize the whitespace.
    await clickWhenReady(
        driver,
        By.css(`[data-testid="option-item-${claimArea}-raise-new-claim"]`),
        `claim area '${claimArea}'`,
    );
    await waitFor(
        driver,
        "dialog-focus-trap (order-id modal)",
        until.elementLocated(By.css(".dialog-focus-trap")),
    );
    await sleep(800);
}

// -----------------------------------------------------------------------------
// 🔢 Order ID modal → first product radio → Proceed
// -----------------------------------------------------------------------------
async function fillOrderIdAndProceed(driver, orderId, { username } = {}) {
    if (!orderId) throw new Error("fillOrderIdAndProceed: missing orderId");

    const orderInput = await waitFor(
        driver,
        "Order ID input",
        until.elementLocated(By.css('.dialog-focus-trap input[data-testid="test-input"]')),
    );
    await driver.executeScript("arguments[0].scrollIntoView({block:'center'});", orderInput);
    try { await orderInput.click(); } catch (_) { await driver.executeScript("arguments[0].focus();", orderInput); }
    await orderInput.sendKeys(Key.chord(Key.COMMAND, "a"));
    await orderInput.sendKeys(Key.BACK_SPACE);
    for (const ch of orderId) { await orderInput.sendKeys(ch); await sleep(80); }
    // Flipkart triggers the order lookup only on Enter — without it the modal
    // stays on "Find Return with Tracking ID / Order ID / Item ID" forever
    // and the product list (with "No requests available" or the real rows)
    // never renders.
    await sleep(400);
    await orderInput.sendKeys(Key.ENTER);
    console.log(`    ✅ Order ID entered + Enter pressed: ${orderId}`);

    // Product list renders async after the order lookup. Race between:
    //   (a) an ENABLED product radio appearing → normal path
    //   (b) a "SPF window has passed" footer note appearing → this order is
    //       past the 14-day SPF claim window and can never be filed.
    //   (c) a "No return packets found" search-results banner → the AWB isn't
    //       a valid return in this account (wrong account or bad AWB).
    // Failing fast on (b)/(c) avoids the 30s radio-wait timeout and gives a
    // specific per-AWB error the operator can act on.
    //
    // Flipkart renders the SPF notice + a DISABLED radio in the same modal
    // when the window has passed, so we can't just check "any radio exists" —
    // we prefer the notice, and only treat a radio as the normal path when
    // it's enabled.
    //
    // XPaths deliberately match the <span>/<div> that carries JUST the
    // message text so getText() returns exactly the notice, without sibling
    // or parent content bleeding in.
    console.log("⏳ Waiting for product list to load...");
    const SPF_EXPIRED_XPATH =
        "//span[contains(normalize-space(.), 'window to claim SPF has passed')]";
    const NO_RETURNS_XPATH =
        "//div[contains(normalize-space(.), 'No return packets found')]";
    const RADIO_CSS = 'input[type="radio"][name="received-return-selection"]';

    // (d) a resolved-claim chip on the packet card — Flipkart renders
    //     <div type="error">Not Approved</div> / <div type="success">Claim
    //     Approved</div> above a DISABLED product row (with a "0/1 Eligible"
    //     pill and a reason line) when this return already carries a claim.
    //     Scoped to the modal so an unrelated [type="error"] elsewhere on the
    //     page can't trigger it. Also picks up the reason line so the operator
    //     sees WHY it was rejected.
    // The REASON text varies a lot between rejections ("...in full working
    // condition", "Rejected by Claims and Risk Assessment Team", and others),
    // so it is captured for the operator's benefit but NEVER matched on.
    // Routing keys strictly off the chip itself, which is stable — every
    // "Not Approved" variant must land on the Not Approved tab.
    const RESOLVED_STATUS_JS = `
        const root = document.querySelector('.dialog-focus-trap') || document;
        // Chip markup seen so far:
        //   <div label="Not Approved"><div type="error">Not Approved</div></div>
        // Match on the wrapper's label attr AND the inner type attr so a drift
        // in either one still routes correctly. [class*="StatusValue"] is a
        // third net for the case where both attributes disappear.
        const nodes = root.querySelectorAll(
            '[type="error"], [type="success"], [label="Not Approved"], [label="Claim Approved"], [class*="StatusValue"]'
        );
        // Two passes: the chip's VISIBLE TEXT is authoritative, the label
        // attribute is only a fallback. If they ever disagree, the operator
        // sees the text, so the text decides which tab we search.
        const classify = (s) => {
            const v = (s || '').replace(/\\s+/g, ' ').trim();
            if (/^Not Approved$/i.test(v)) return { tab: 'REJECTED', label: 'Not Approved' };
            if (/^Claim Approved$/i.test(v)) return { tab: 'APPROVED', label: 'Approved' };
            return null;
        };
        const ordered = [];
        for (const n of nodes) ordered.push({ n: n, hit: classify(n.textContent) });
        for (const n of nodes) ordered.push({ n: n, hit: classify(n.getAttribute('label')) });
        for (const entry of ordered) {
            if (!entry.hit) continue;
            const n = entry.n;
            const tab = entry.hit.tab, label = entry.hit.label;
            // Reason line — informational only, never used for routing.
            const holder = n.closest('[class*="PacketCard"]') || root;
            let reason = '';
            const footer = holder.querySelector('[class*="ItemFooterText"], [class*="FooterText"], [class*="RejectionReason"]');
            if (footer) reason = (footer.textContent || '').replace(/\\s+/g, ' ').trim();
            return { tab: tab, label: label, reason: reason };
        }
        return null;
    `;
    // Don't read the chip during the first few seconds of the modal's life.
    // On a multi-product packet one line can be "Not Approved" while another
    // is still claimable; the enabled radio for the claimable one may render a
    // beat later. The grace period keeps the normal path winning that race.
    const STATUS_GRACE_MS = 4000;
    const raceStart = Date.now();

    const outcome = await driver.wait(async () => {
        const [radios, expired, noReturns] = await Promise.all([
            driver.findElements(By.css(RADIO_CSS)),
            driver.findElements(By.xpath(SPF_EXPIRED_XPATH)),
            driver.findElements(By.xpath(NO_RETURNS_XPATH)),
        ]);
        // Priority 1 — SPF-expired notice wins over any radio (disabled radio
        // co-renders with the notice, and we don't want to click it).
        for (const el of expired) {
            try { if (await el.isDisplayed()) return { kind: "expired", el }; } catch (_) { /* stale — skip */ }
        }
        // Priority 2 — "No return packets found" banner.
        for (const el of noReturns) {
            try { if (await el.isDisplayed()) return { kind: "no_returns", el }; } catch (_) { /* stale — skip */ }
        }
        // Priority 3 — only an enabled radio counts as the normal path.
        for (const r of radios) {
            try {
                const disabled = await r.getAttribute("disabled");
                const ariaDisabled = await r.getAttribute("aria-disabled");
                if (disabled === null && ariaDisabled !== "true") {
                    return { kind: "radio", el: r };
                }
            } catch (_) { /* stale — skip */ }
        }
        // Priority 4 — no enabled radio (Priority 3 just fell through) and the
        // packet card shows a resolved-claim chip. Deliberately last so a
        // partially-eligible packet still takes the normal path.
        //
        // The gate is "the packet card has rendered", not "a radio exists" —
        // some rejected packets render the chip + reason with no product row
        // at all, and keying off radios would drop those into the 30s timeout.
        if (Date.now() - raceStart > STATUS_GRACE_MS) {
            const cardRendered = radios.length > 0 || (await driver.findElements(
                By.css('[class*="PacketCard"], [data-testid="received-return-proceed-btn"]'),
            )).length > 0;
            if (cardRendered) {
                const status = await driver.executeScript(RESOLVED_STATUS_JS);
                if (status) return { kind: "resolved", status };
            }
        }
        return null;
    }, 30000, "neither an enabled product radio, SPF-expired notice, nor 'no return packets' banner appeared within 30s");

    if (outcome.kind === "resolved") {
        // Not a failure in the usual sense — the claim exists, it's just
        // already been decided. Carry the tab on the error so the runner's
        // salvage path can fetch that claim's ticket id and report the real
        // status (Rejected / Approved) instead of a blind Failed.
        const { tab, label, reason } = outcome.status;
        console.log(`    ℹ️  Existing '${label}' claim detected on this return${reason ? ` — ${reason}` : ""}`);
        const resolvedErr = new Error(
            `CLAIM_ALREADY_RESOLVED: This return already has a '${label}' SPF claim` +
            (reason ? ` — ${reason}` : ""),
        );
        resolvedErr.claimStatus = { tab, label };
        throw resolvedErr;
    }
    if (outcome.kind === "expired") {
        let noticeText = "14 days window to claim SPF has passed";
        try { noticeText = (await outcome.el.getText()).trim() || noticeText; } catch (_) { /* keep default */ }
        throw flipkartWindowExpired(noticeText);
    }
    if (outcome.kind === "no_returns") {
        throw new Error(
            `NO_RETURN_PACKETS: Wrong awb number, Not exist in account ${username || "unknown"}`
        );
    }

    const firstRadio = outcome.el;
    await driver.executeScript("arguments[0].scrollIntoView({block:'center'});", firstRadio);
    await sleep(300);
    try { await firstRadio.click(); } catch (_) { await driver.executeScript("arguments[0].click();", firstRadio); }
    console.log("    ✅ Selected first product radio");
    await sleep(500);

    // Second check — a few Flipkart flows show the SPF-window notice only
    // after the product is selected (per-line-item rule). Re-scan; if it's
    // visible now, fail with the same specific error.
    const postSelectExpired = await driver.findElements(By.xpath(SPF_EXPIRED_XPATH));
    for (const el of postSelectExpired) {
        try {
            if (await el.isDisplayed()) {
                let noticeText = "14 days window to claim SPF has passed";
                try { noticeText = (await el.getText()).trim() || noticeText; } catch (_) { /* keep default */ }
                throw flipkartWindowExpired(noticeText);
            }
        } catch (err) {
            if (err && err.code === "SPF_WINDOW_EXPIRED") throw err;
            /* stale — skip */
        }
    }

    const proceedBtn = await waitFor(
        driver,
        "Proceed button",
        until.elementLocated(By.css('[data-testid="received-return-proceed-btn"]')),
    );
    await driver.wait(async () => {
        const disabled = await proceedBtn.getAttribute("disabled");
        return disabled === null;
    }, 10000, "'Proceed to Raise Claim' never became enabled");
    try { await proceedBtn.click(); } catch (_) { await driver.executeScript("arguments[0].click();", proceedBtn); }
    console.log("    ✅ Clicked: Proceed to Raise Claim");
    await sleep(3000);
    console.log(`📍 After Proceed: ${await driver.getCurrentUrl()}`);
}

// -----------------------------------------------------------------------------
// 🗂️ react-select helper (Issue Area + Issue Type)
// -----------------------------------------------------------------------------
async function selectReactSelectByPlaceholder(driver, placeholderText, optionText) {
    console.log(`📂 react-select '${placeholderText}' -> '${optionText}'`);
    await clickWhenReady(
        driver,
        By.xpath(`//div[contains(@class,'Select-placeholder') and normalize-space()=${JSON.stringify(placeholderText)}]/ancestor::div[contains(@class,'Select')][1]`),
        `${placeholderText} trigger`,
    );
    await waitFor(
        driver,
        `${placeholderText} menu`,
        until.elementLocated(By.css(".Select-menu-outer")),
    );

    // Case-insensitive option match — Flipkart's own casing is inconsistent
    // ("Main Product" vs "Combo product"), and past bugs were pure casing
    // typos in configArr. Do the compare in JS so trivial case drift
    // ("Main product" vs "Main Product") doesn't kill the whole claim.
    console.log(`⏳ Waiting for option '${optionText}' (case-insensitive)...`);
    const optionEl = await driver.wait(async () => {
        return driver.executeScript(`
            const wanted = arguments[0].replace(/\\s+/g, ' ').trim().toLowerCase();
            const spans = Array.from(document.querySelectorAll(
                '.Select-menu-outer .select-option-label'
            ));
            for (const s of spans) {
                const t = (s.textContent || '').replace(/\\s+/g, ' ').trim().toLowerCase();
                if (t === wanted) return s;
            }
            return null;
        `, optionText);
    }, WAIT_TIMEOUT, `option '${optionText}' never appeared`);

    await driver.executeScript("arguments[0].scrollIntoView({block:'center'});", optionEl);
    await sleep(150);
    try { await optionEl.click(); }
    catch (_) { await driver.executeScript("arguments[0].click();", optionEl); }
    console.log(`    ✅ Clicked option: ${optionText}`);
    await sleep(500);
}

// -----------------------------------------------------------------------------
// 📤 File upload helper — hidden input[type=file] (single or multi via \n join)
// -----------------------------------------------------------------------------
async function sendFilesToInput(driver, locator, filePaths, label) {
    const paths = (Array.isArray(filePaths) ? filePaths : [filePaths]).filter(Boolean);
    if (paths.length === 0) return;
    for (const p of paths) {
        if (!fs.existsSync(p)) throw new Error(`${label}: file not found -> ${p}`);
    }
    console.log(`📤 Uploading ${paths.length} file(s) to: ${label}`);

    // Flipkart's evidence uploader (`#received-return-evidence-uploader`) ships
    // as a single-file input, so `sendKeys` in a loop overwrites the previous
    // file (last-in wins) and only 1 of N images reaches the panel. Force the
    // `multiple` attribute on so Selenium accepts the newline-joined batch and
    // the SPA's change handler receives the full FileList in one shot.
    let el = await waitFor(driver, label, until.elementLocated(locator));
    await driver.executeScript(
        "arguments[0].style.display='block';arguments[0].style.visibility='visible';" +
        "arguments[0].setAttribute('multiple','multiple');",
        el,
    );
    const isMulti = (await el.getAttribute("multiple")) !== null;

    if (isMulti || paths.length === 1) {
        await el.sendKeys(paths.join("\n"));
        await sleep(2500);
        // Verify the input actually holds every file we sent. A silently short
        // FileList means images the CMS supplied never reached Flipkart — fail
        // by name rather than submitting an incomplete claim.
        await assertAllFilesAccepted(driver, locator, paths, label);
        console.log(`    ✅ All ${paths.length} file(s) accepted by ${label}`);
        return;
    }

    // Single-file input, multiple files: loop one at a time. After each
    // sendKeys, dispatch a `change` event so the SPA registers the file, then
    // wait long enough for it to commit + reset the input before the next.
    // Re-query the element each iteration in case the SPA re-renders it.
    for (let i = 0; i < paths.length; i++) {
        console.log(`    📎 ${i + 1}/${paths.length}: ${path.basename(paths[i])}`);
        el = await waitFor(driver, `${label} (attempt ${i + 1})`, until.elementLocated(locator));
        await driver.executeScript(
            "arguments[0].style.display='block';arguments[0].style.visibility='visible';",
            el,
        );
        await el.sendKeys(paths[i]);
        await driver.executeScript(
            "arguments[0].dispatchEvent(new Event('change', { bubbles: true }));",
            el,
        );
        await sleep(3500);
    }
    console.log(`    ✅ All ${paths.length} files uploaded to ${label}`);
}

// Read back the file names the input accepted and compare with what we sent.
// Throws "<name> not uploaded" naming every file that is missing.
async function assertAllFilesAccepted(driver, locator, paths, label) {
    let accepted = [];
    try {
        const els = await driver.findElements(locator);
        for (const candidate of els) {
            const names = await driver.executeScript(
                "return Array.from((arguments[0].files || [])).map(f => f.name);",
                candidate,
            );
            if (Array.isArray(names) && names.length > accepted.length) accepted = names;
        }
    } catch (err) {
        // Some SPAs clear input.files once the FileList is consumed into their
        // own state. That is indistinguishable from "nothing landed", so we
        // can't fail on it — log and let the submit-time validation decide.
        console.warn(`    ⚠️ ${label}: could not read back file list (${err.message}) — skipping verification`);
        return;
    }

    if (accepted.length === 0) {
        console.warn(`    ⚠️ ${label}: input reports no files (likely consumed by the SPA) — skipping verification`);
        return;
    }

    const acceptedSet = new Set(accepted);
    const missing = paths
        .map((p) => path.basename(p))
        .filter((name) => !acceptedSet.has(name));

    if (missing.length > 0) {
        throw new Error(
            `UPLOAD_FAILED: ${missing.join(", ")} not uploaded — ` +
            `${label} accepted ${accepted.length}/${paths.length} file(s)`,
        );
    }
}

// -----------------------------------------------------------------------------
// 🧾 Fill the claim form — expects local paths for shippingLabel + evidenceImages
// -----------------------------------------------------------------------------
async function fillClaimForm(driver, {
    shippingLabel, issueArea, issueType, description, evidenceImages,
}) {
    // Shipping label — some form variants label it "Upload Shipping Label";
    // others just show the icon. Prefer the input near a matching heading;
    // fall back to the first image file input on the page.
    if (shippingLabel) {
        console.log(`\n📎 Shipping Label upload`);
        const primary = By.xpath(
            "//*[contains(normalize-space(.),'Upload Shipping Label') or contains(normalize-space(.),'Shipping Label')]" +
            "/following::input[@type='file'][1]",
        );
        const fallback = By.css('input[type="file"][accept*="image"]');
        const primaryHit = await driver.findElements(primary);
        await sendFilesToInput(
            driver,
            primaryHit.length > 0 ? primary : fallback,
            shippingLabel,
            "Shipping Label",
        );
    }

    // Issue Area (react-select — placeholder text is the anchor).
    if (issueArea) {
        await selectReactSelectByPlaceholder(
            driver,
            "Main Product, Combo Product, etc.",
            issueArea,
        );
    }

    // Issue Type.
    if (issueType) {
        await selectReactSelectByPlaceholder(
            driver,
            "What is wrong with the item(s)",
            issueType,
        );
    }

    // Description.
    console.log(`📝 Filling description...`);
    const desc = await waitFor(
        driver,
        "description textarea",
        until.elementLocated(By.css('textarea[class*="IssueDescriptionBox"]')),
    );
    await driver.executeScript("arguments[0].scrollIntoView({block:'center'});", desc);
    try { await desc.click(); } catch (_) { await driver.executeScript("arguments[0].focus();", desc); }
    await desc.sendKeys(Key.chord(Key.COMMAND, "a"));
    await desc.sendKeys(Key.BACK_SPACE);
    await desc.sendKeys(description || "");
    console.log(`    ✅ Description entered (${(description || "").length} chars)`);

    // Evidence — multiple files via `sendKeys(paths.join("\n"))`.
    if (Array.isArray(evidenceImages) && evidenceImages.length > 0) {
        await sendFilesToInput(
            driver,
            By.css('#received-return-evidence-uploader'),
            evidenceImages,
            "Evidence uploader",
        );
    }
}

// -----------------------------------------------------------------------------
// ✅ Submit — clicks 'Submit Claim' once enabled. Throws if it never enables.
// -----------------------------------------------------------------------------
async function submitClaim(driver) {
    console.log("\n🚦 Submitting claim...");
    // DESABLE_SAVE=true → the form is filled but the claim is never filed.
    assertClaimSubmitEnabled("Flipkart", "'Submit Claim' click");
    const btn = await waitFor(
        driver,
        "'Submit Claim' button",
        until.elementLocated(By.css('[data-testid="received-return-submit-btn"]')),
    );
    await driver.wait(async () => {
        const disabled = await btn.getAttribute("disabled");
        const ariaDisabled = await btn.getAttribute("aria-disabled");
        return disabled === null && ariaDisabled !== "true";
    }, 15000, "'Submit Claim' never became enabled");
    await driver.executeScript("arguments[0].scrollIntoView({block:'center'});", btn);
    await sleep(400);
    try { await btn.click(); } catch (_) { await driver.executeScript("arguments[0].click();", btn); }
    console.log("    ✅ Clicked: 'Submit Claim'");
    // Post-submit: the form navigates back to the SPF list or shows a toast.
    // 5s is empirically enough for the network round-trip.
    await sleep(5000);
}

// -----------------------------------------------------------------------------
// 🚪 Close the SPF claim side drawer if it's open. Safe no-op if not present.
// -----------------------------------------------------------------------------
// Used in two places:
//   (a) getFlipkartTicketId — the drawer stays open after submit and blocks
//       clicks on the underlying claim-list page.
//   (b) per-AWB failure recovery in scriptNew.js — if a claim fails mid-form
//       (Step 4/5), the drawer is left open. Closing it before the next claim
//       lets openSpfClaimsPage/openRaiseNewClaim interact with the page again.
// Also dispatches ESC as a fallback for the order-id modal / other overlays
// that don't have this specific close button.
async function closeClaimDrawer(driver) {
    try {
        const closeBtns = await driver.findElements(
            By.css('[data-testid="received-return-claim-drawer-button"]#received-return-claim-drawer-button'),
        );
        if (closeBtns.length > 0) {
            try { await closeBtns[0].click(); }
            catch (_) { await driver.executeScript("arguments[0].click();", closeBtns[0]); }
            console.log("    ✅ Claim drawer closed");
            // Let the drawer's slide-out animation finish so subsequent clicks
            // don't get intercepted by the fading overlay.
            await sleep(1500);
            return true;
        }
    } catch (_) { /* noop — best effort */ }

    // Fallback — the order-id modal (`.dialog-focus-trap`) has no drawer
    // button, so the block above is a no-op for it. It renders a full-page
    // backdrop, and leaving it open silently breaks everything that follows:
    // the salvage navigation can't hover the Payments rail, and the next AWB's
    // "Raise New Claim" click is intercepted. ESC is the only close affordance
    // Flipkart gives this modal.
    try {
        const visibleDialogs = async () => {
            const els = await driver.findElements(By.css(".dialog-focus-trap"));
            const shown = [];
            for (const el of els) {
                try { if (await el.isDisplayed()) shown.push(el); } catch (_) { /* stale — skip */ }
            }
            return shown;
        };

        if ((await visibleDialogs()).length === 0) return false;

        for (let attempt = 1; attempt <= 3; attempt++) {
            try {
                await driver.actions({ async: true }).sendKeys(Key.ESCAPE).perform();
            } catch (_) {
                // Some webdriver builds refuse a bare sendKeys with no element
                // focused — synthesise the keydown the focus trap listens for.
                await driver.executeScript(
                    "const t = document.activeElement || document.body;" +
                    "t.dispatchEvent(new KeyboardEvent('keydown'," +
                    "{key:'Escape',code:'Escape',keyCode:27,which:27,bubbles:true}));",
                );
            }
            await sleep(800);
            if ((await visibleDialogs()).length === 0) {
                console.log(`    ✅ Order-id modal closed (ESC, attempt ${attempt})`);
                return true;
            }
        }
        console.warn("    ⚠️ Order-id modal still open after 3 ESC attempts");
    } catch (_) { /* noop — best effort */ }
    return false;
}

// -----------------------------------------------------------------------------
// 🗂️ Claim-list sub-tab — "NFBF — Raised by you" vs "FBF — Auto approved"
// -----------------------------------------------------------------------------
// Claims the seller files (everything this runner submits, and every rejected
// claim we salvage) live under "NFBF — Raised by you". It's normally the
// default tab, but if the portal ever lands on FBF the status tiles all read 0
// and the ticket lookup silently finds nothing. Best-effort: never throws.
async function ensureRaisedByYouTab(driver) {
    try {
        const clicked = await driver.executeScript(`
            const nodes = Array.from(document.querySelectorAll('div,button,li,a,span'));
            let best = null;
            for (const el of nodes) {
                const t = (el.textContent || '').replace(/\\s+/g, ' ').trim();
                if (!/raised by you/i.test(t)) continue;
                if (t.length > 60) continue;              // skip page-level wrappers
                if (!best || t.length < best.t.length) best = { el: el, t: t };
            }
            if (!best) return null;
            // Already selected? Flipkart marks the active tab with aria-selected
            // or a class containing "active"/"selected".
            const el = best.el;
            const selected =
                el.getAttribute('aria-selected') === 'true' ||
                /active|selected/i.test(el.className || '') ||
                /active|selected/i.test((el.parentElement && el.parentElement.className) || '');
            if (selected) return 'already';
            el.click();
            return 'clicked';
        `);
        if (clicked === "clicked") {
            console.log("    ✅ Switched to 'Raised by you' claim tab");
            await sleep(2000);
        } else if (clicked === "already") {
            console.log("    ℹ️  'Raised by you' tab already active");
        }
    } catch (_) { /* best effort — tile click below is the real gate */ }
}

// -----------------------------------------------------------------------------
// 🔘 Status tile click — by id, falling back to the tile's visible label
// -----------------------------------------------------------------------------
// Flipkart ids the tiles #PROCESSING / #APPROVED / #REJECTED, but the visible
// labels ("Processing" / "Approved" / "Not Approved") are what an operator
// sees and are far less likely to churn. Try the id first, then match a tile
// rendered as "<count> <label>" (e.g. "1 Not Approved"), then the bare label.
async function clickStatusTile(driver, tab, tabLabel) {
    try {
        await clickWhenReady(driver, By.css(`#${tab}`), `'${tabLabel}' tile`);
        return true;
    } catch (err) {
        console.log(`    ⏳ Tile #${tab} unusable (${err.message}) — matching by label '${tabLabel}'...`);
    }

    const clicked = await driver.wait(async () => {
        return driver.executeScript(`
            const wanted = arguments[0].replace(/\\s+/g, ' ').trim().toLowerCase();
            const esc = wanted.replace(/[.*+?^\${}()|[\\]\\\\]/g, '\\\\$&');
            // \\s* not \\s+ — the count and label sit in adjacent spans with no
            // whitespace between them, so textContent reads "1Not Approved".
            const withCount = new RegExp('^\\\\d+\\\\s*' + esc + '$');
            const nodes = Array.from(document.querySelectorAll('div,button,li,a'));
            let counted = null, bare = null;
            for (const el of nodes) {
                // Ignore anything still inside the claim modal — the packet
                // card carries a "Not Approved" chip that would match too.
                if (el.closest('.dialog-focus-trap')) continue;
                if (!el.offsetWidth && !el.offsetHeight) continue;
                const t = (el.textContent || '').replace(/\\s+/g, ' ').trim().toLowerCase();
                if (withCount.test(t)) {
                    if (!counted || t.length < counted.len) counted = { el: el, len: t.length };
                } else if (t === wanted) {
                    if (!bare || t.length < bare.len) bare = { el: el, len: t.length };
                }
            }
            // Prefer the "<count> <label>" node: that's the tile box itself,
            // not the label span nested inside it.
            const target = (counted && counted.el) || (bare && bare.el);
            if (!target) return false;
            target.scrollIntoView({ block: 'center' });
            target.click();
            return true;
        `, tabLabel);
    }, 10000, `'${tabLabel}' tile never appeared (neither #${tab} nor a label match)`);

    if (clicked) console.log(`    ✅ Clicked '${tabLabel}' tile (label match)`);
    return clicked;
}

// -----------------------------------------------------------------------------
// 🎫 Ticket (Claim ID) capture — close drawer, filter, search, read first row
// -----------------------------------------------------------------------------
// After submit the SPF claims side drawer is still open, so any click on the
// underlying page fires "element not interactable". Flow (in order):
//   1. Close the drawer via [data-testid="received-return-claim-drawer-button"].
//   2. Click the status tile (default #PROCESSING; salvage lookups pass
//      { tab: 'REJECTED', tabLabel: 'Not Approved' } or
//      { tab: 'APPROVED', tabLabel: 'Approved' } depending on the modal's
//      status indicator).
//   3. Type the orderId into #spf-claims-search + press Enter.
//   4. Read the first <td> of the first row — that's the Claim ID.
// Returns null on any failure — we deliberately don't page-text-scrape as a
// fallback (past bug: the "Search by Tracking ID..." placeholder made the
// regex return the literal string "Tracking" as the ticket id).
async function getFlipkartTicketId(driver, orderId, { tab = "PROCESSING", tabLabel = "Processing" } = {}) {
    if (!orderId) return null;
    console.log(`\n🎫 Looking up Claim ID for order ${orderId} in '${tabLabel}' tab`);

    try {
        // 1. Close the claim side drawer. If it's already closed the button
        // won't exist — treat that as a no-op.
        console.log("🖱️  Closing claim side drawer (if open)...");
        await closeClaimDrawer(driver);

        // 2. Make sure we're on the seller's own claims tab, then click the
        //    requested status tile.
        await ensureRaisedByYouTab(driver);
        await clickStatusTile(driver, tab, tabLabel);
        await sleep(2500);

        // 3. Type the order id in the SPF Claims search box + press Enter.
        console.log(`⌨️  Typing order id into #spf-claims-search: ${orderId}`);
        const searchInput = await waitFor(
            driver,
            "#spf-claims-search input",
            until.elementLocated(By.css('#spf-claims-search')),
        );
        await driver.executeScript("arguments[0].scrollIntoView({block:'center'});", searchInput);
        try { await searchInput.click(); }
        catch (_) { await driver.executeScript("arguments[0].focus();", searchInput); }
        await searchInput.sendKeys(Key.chord(Key.COMMAND, "a"));
        await searchInput.sendKeys(Key.BACK_SPACE);
        await searchInput.sendKeys(orderId);
        await sleep(400);
        await searchInput.sendKeys(Key.ENTER);

        // 4. Poll for the first row of the claim list table. Give the API
        // 15s to reflect the freshly-submitted claim.
        console.log("⏳ Waiting for first row of claim-list-table...");
        const DEADLINE = Date.now() + 15000;
        let claimId = null;
        while (Date.now() < DEADLINE) {
            claimId = await driver.executeScript(
                `
                const row = document.querySelector(
                    'table[data-testid="claim-list-table"] tbody tr[data-testid="claim-list-table-row-0"]'
                ) || document.querySelector(
                    'table[data-testid="claim-list-table"] tbody tr'
                );
                if (!row) return null;
                const td = row.querySelector('td:first-child');
                if (!td) return null;
                return (td.textContent || '').replace(/\\s+/g, ' ').trim() || null;
                `,
            );
            if (claimId) break;
            await sleep(1000);
        }

        if (claimId) {
            console.log(`    🎫 Claim ID from listing: ${claimId}`);
            return claimId;
        }
        console.log("    ⚠️  Claim-list table returned no row for this order");
    } catch (err) {
        console.log(`    ⚠️  Ticket lookup failed: ${err.message}`);
    }

    console.log(`    ⚠️  Ticket id not captured for order ${orderId}`);
    return null;
}

module.exports = {
    gotoSpfDirect,
    dismissWelcomeModal,
    imageNameFromUrl,
    buildDriver,
    destroyDriver,
    downloadFile,
    flipkartLogin,
    openSpfClaimsPage,
    openRaiseNewClaim,
    fillOrderIdAndProceed,
    fillClaimForm,
    submitClaim,
    getFlipkartTicketId,
    closeClaimDrawer,
};
