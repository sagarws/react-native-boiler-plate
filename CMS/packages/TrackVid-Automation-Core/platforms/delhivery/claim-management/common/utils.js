// -----------------------------------------------------------------------------
// Delhivery One — Auto Claim utilities (Selenium, Node.js)
// -----------------------------------------------------------------------------
// Extracted from Automated-scripts/delhiveryAutomation.js (the interactive
// skeleton) into a reusable helper module for the BE-driven auto-claim runner
// in scriptNew.js. Same locator + wait patterns proved out there; anything
// touching per-claim state (formData/awb) is a pure function here so
// scriptNew.js can loop over configArr and reuse a single logged-in driver.
//
// Exports:
//   - buildDriver()                                              (chrome + stealth options)
//   - downloadFile(url, filename, tempPath)                      (remote URL → local file)
//   - delhiveryLogin(driver, credentials)                        (email → password → dashboard)
//   - pickDomesticAccount(driver, domesticName)                  (header dropdown, session-wide)
//   - openRaiseTicket(driver)                                    (sidebar Support → Raise a ticket modal)
//   - pickShipmentIssueAndSub(driver, shipmentIssue, subcategory)(two badges + Raise Claim → drawer)
//   - enterAwbAndClaimType(driver, awbNumber, claimType)         (AWB autocomplete + claim-type dropdown)
//   - uploadUnboxingDocs(driver, filePaths)                      (multi-file into unboxing input)
//   - submitClaimDrawer(driver)                                  (drawer Submit, waits for enable)
//   - getDelhiveryTicketId(driver, awbNumber)                    (open tickets → AWB search → row)
// -----------------------------------------------------------------------------

const path = require("path");
const fs = require("fs-extra");
const axios = require("axios");
const { Builder, By, until, Key } = require("selenium-webdriver");
const chrome = require("selenium-webdriver/chrome");
const { assertClaimSubmitEnabled } = require("../../../../common/claimSubmitGuard");
const { isHeadless } = require("../../../../common/headless.js");
const {
    INVALID_CREDENTIAL_TEXT,
    INVALID_CREDENTIAL_SELECTOR,
} = require("../../common/loginErrors");

// ---------------------------
// ⏱️ Timeouts & small helpers
// ---------------------------
const WAIT_TIMEOUT = 20000;

/**
 * How long the ticket search is given to replace the table before it is read.
 *
 * The list is already on screen when the AWB is submitted, so a read taken too
 * soon is a read of the PREVIOUS results. Two seconds is what it takes in
 * practice; `DELHIVERY_TICKET_SEARCH_SETTLE_MS` moves it on a slow connection.
 */
const SEARCH_SETTLE_MS = Number(process.env.DELHIVERY_TICKET_SEARCH_SETTLE_MS) || 2000;
// HEADLESS=false → visible browser; default (unset) headless.
// Read lazily so it works no matter when dotenv.config() runs.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Random sleep in [minMs, maxMs] — used only in login to avoid the
// perfectly-regular timing that bot detection watches for. Everything else
// keeps deterministic sleeps for reproducibility.
const humanSleep = (minMs, maxMs) => sleep(minMs + Math.floor(Math.random() * (maxMs - minMs)));

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

// Human-like typing. Per-char delay jittered (110–260ms); every 3–6 chars a
// longer "thinking" pause (300–800ms). Used for login fields where regular
// timing gets flagged by anti-bot signals.
async function typeHuman(driver, el, value) {
    await driver.executeScript("arguments[0].scrollIntoView({block:'center'});", el);
    await humanSleep(200, 400);
    try { await el.click(); } catch (_) { await driver.executeScript("arguments[0].focus();", el); }
    await humanSleep(150, 300);
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

// ---------------------------
// 📥 Download File Helper (shared pattern with Flipkart/Myntra/Snapdeal)
// ---------------------------
// BE hands us signed S3 URLs; Selenium's file input needs a local path, so
// stream them into tempPath first. Local paths pass through untouched.
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
// Delhivery's dashboard is layout-sensitive, so we lock window-size to
// 1440x900 (same as the interactive skeleton) — narrower widths collapse the
// sidebar differently and change the sequence of hover events we rely on.
async function buildDriver() {
    const options = new chrome.Options();
    if (isHeadless()) options.addArguments("--headless=new");

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
        "profile.default_content_setting_values.notifications": 2,
    });

    if (process.env.NODE_ENV === "production") {
        options.setChromeBinaryPath("/usr/bin/google-chrome");
    }

    const driver = await new Builder()
        .forBrowser("chrome")
        .setChromeOptions(options)
        .build();

    await driver.manage().setTimeouts({ implicit: 0, pageLoad: 60000 });
    await driver.manage().window().setRect({ width: 1440, height: 900 });
    return driver;
}

// ---------------------------
// 🔑 Delhivery login
// ---------------------------
// Landing → email → Continue → Keycloak password page → password → Login →
// wait for redirect off /login. The Keycloak password page renders hidden
// password inputs for browser autofill so we pick the *visible* input/button.
async function delhiveryLogin(driver, credentials) {
    const { username, password } = credentials || {};
    if (!username || !password) {
        throw new Error("LOGIN_FAILED: missing username or password");
    }

    const url = process.env.DELHIVERY_LOGIN_URL || "https://one.delhivery.com/";
    console.log(`🌐 Navigating to ${url}`);
    await driver.get(url);
    await humanSleep(3500, 5000);
    console.log(`📍 Landed at: ${await driver.getCurrentUrl()}`);

    // Step 1 — email input.
    const emailEl = await waitFor(
        driver,
        "email input",
        until.elementLocated(By.css('input[name="email"][type="email"]')),
    );
    console.log("⌨️  Typing email slowly...");
    await typeHuman(driver, emailEl, username);
    await humanSleep(500, 900);

    // Step 2 — Continue. Grab the URL first so we can detect the navigation
    // to Delhivery's dedicated password page.
    const preContinueUrl = await driver.getCurrentUrl();
    await clickWhenReady(
        driver,
        By.xpath("//button[normalize-space()='Continue']"),
        "'Continue' button",
    );

    // Delhivery navigates to a separate password page after Continue. Poll
    // for either the URL to change OR a password input to appear.
    console.log("⏳ Waiting for password page to load...");
    await driver.wait(async () => {
        const u = await driver.getCurrentUrl();
        if (u !== preContinueUrl) return true;
        const pw = await driver.findElements(By.css('input[type="password"]'));
        return pw.length > 0;
    }, 20000);
    await sleep(1500);
    console.log(`📍 Password page URL: ${await driver.getCurrentUrl()}`);

    // Step 3 — password. Keycloak renders extra hidden password inputs for
    // autofill, so a plain input[type=password] locator finds a 0×0 hidden
    // node first. Pick the actually-visible one instead.
    console.log("🔎 Locating the visible password input...");
    const pwEl = await driver.wait(async () => {
        const els = await driver.findElements(By.css('input[type="password"]'));
        for (const el of els) {
            const size = await el.getRect().catch(() => ({ width: 0, height: 0 }));
            const displayed = await el.isDisplayed().catch(() => false);
            if (displayed && size.width > 0 && size.height > 0) return el;
        }
        return null;
    }, 20000);
    if (!pwEl) {
        throw new Error("Failed at step: password input (no visible input[type=password] within 20000ms)");
    }
    await driver.executeScript("arguments[0].scrollIntoView({block:'center'});", pwEl);
    await sleep(200);
    try { await pwEl.click(); } catch (_) { await driver.executeScript("arguments[0].focus();", pwEl); }
    for (const ch of String(password)) { await pwEl.sendKeys(ch); await humanSleep(90, 180); }
    console.log(`    ✅ Entered password input`);
    await humanSleep(500, 900);

    // Step 4 — Login. Same Keycloak visibility quirk as the password input.
    console.log("🔎 Locating the visible Login button...");
    const loginBtn = await driver.wait(async () => {
        const els = await driver.findElements(By.xpath("//button[normalize-space()='Login']"));
        for (const el of els) {
            const size = await el.getRect().catch(() => ({ width: 0, height: 0 }));
            const displayed = await el.isDisplayed().catch(() => false);
            if (displayed && size.width > 0 && size.height > 0) return el;
        }
        return null;
    }, 20000);
    if (!loginBtn) {
        throw new Error("Failed at step: Login button (no visible 'Login' within 20000ms)");
    }
    await driver.executeScript("arguments[0].scrollIntoView({block:'center'});", loginBtn);
    await sleep(300);
    try { await loginBtn.click(); }
    catch (_) { await driver.executeScript("arguments[0].click();", loginBtn); }
    console.log("    ✅ Clicked: 'Login' button");

    // Wait for the URL to move off the login page — or for Delhivery to say
    // the password is wrong. A rejected login never redirects, so without this
    // check the run burned the full 20s wait and then died several steps later
    // on a dashboard selector, reported as a transient failure while the dead
    // credential stayed marked verified.
    console.log("⏳ Waiting for post-login redirect...");
    let portalRejectedLogin = false;
    await driver.wait(async () => {
        if (await hasInvalidCredentialBanner(driver)) {
            portalRejectedLogin = true;
            return true;
        }
        const u = await driver.getCurrentUrl();
        return !u.includes("/login") && u !== url;
    }, 20000).catch(() => { /* some tenants land on /home directly */ });

    if (portalRejectedLogin) {
        const err = new Error("INVALID_CREDENTIALS: Wrong credential");
        err.code = "INVALID_CREDENTIALS";
        throw err;
    }
    await humanSleep(4000, 6000);
    console.log(`📍 Post-login URL: ${await driver.getCurrentUrl()}`);

    // MoEngage NPS survey modal ("How satisfied are you with Delhivery One?")
    // steals focus/clicks a few seconds after landing on the dashboard. Poll
    // up to 8s and dismiss it — many claims previously failed because the
    // header dropdown click landed on the modal's Next button.
    await dismissNpsSurveyModal(driver, { waitMs: 8000 });
}

// ---------------------------
// 🚫 Rejected-password banner
// ---------------------------
// See ../loginErrors.js for the banner's markup and why the match is anchored
// on "invalid". Probe-only: any WebDriver hiccup answers "no banner", so the
// worst case is the old behaviour (a slow, mislabelled failure), never an
// unverified working credential.
async function hasInvalidCredentialBanner(driver) {
    try {
        return await driver.executeScript(
            `var re = new RegExp(arguments[0], "i");
             var hit = Array.prototype.slice
                 .call(document.querySelectorAll(arguments[1]))
                 .some(function (el) { return re.test(el.textContent || ""); });
             return hit || re.test((document.body && document.body.innerText) || "");`,
            INVALID_CREDENTIAL_TEXT.source,
            INVALID_CREDENTIAL_SELECTOR,
        );
    } catch (_) {
        return false;
    }
}

// ---------------------------
// 🪟 MoEngage NPS survey modal dismisser
// ---------------------------
// The modal is injected by MoEngage into <div id="moe-nps-root"> a few
// seconds after login lands. It has multiple screens (nps / detractor /
// improve / comment); only one is visible at a time (style="display:block").
// Each screen has its own <button class="moe-close" aria-label="Close">
// wired to handleClose('<screenCode>'). We click whichever close button is
// currently visible. No-op if the modal never appears.
async function dismissNpsSurveyModal(driver, { waitMs = 5000, pollMs = 500 } = {}) {
    console.log(`🔎 Checking for MoEngage NPS survey modal (up to ${waitMs}ms)...`);
    const deadline = Date.now() + waitMs;
    while (Date.now() < deadline) {
        try {
            const dismissed = await driver.executeScript(
                `
                const root = document.getElementById('moe-nps-root');
                if (!root) return { present: false };
                // Pick the currently-visible screen — style="display:block" on
                // one .moe-screen at a time; fall back to any visible close btn.
                const screens = Array.from(root.querySelectorAll('.moe-screen'));
                let visibleScreen = screens.find(s => {
                    const style = (s.getAttribute('style') || '').toLowerCase();
                    if (style.includes('display:block') || style.includes('display: block')) return true;
                    const cs = window.getComputedStyle(s);
                    return cs.display !== 'none' && cs.visibility !== 'hidden';
                });
                const closeBtn = (visibleScreen || root).querySelector('button.moe-close[aria-label="Close"]')
                    || root.querySelector('button.moe-close[aria-label="Close"]');
                if (!closeBtn) return { present: true, closed: false, reason: 'no-close-button' };
                closeBtn.click();
                return {
                    present: true,
                    closed: true,
                    screenId: visibleScreen ? visibleScreen.id : null,
                };
                `
            );
            if (!dismissed || !dismissed.present) {
                await sleep(pollMs);
                continue;
            }
            if (dismissed.closed) {
                console.log(
                    `    ✅ Dismissed NPS survey modal` +
                    (dismissed.screenId ? ` (screen=${dismissed.screenId})` : "")
                );
                // Let MoEngage's handleClose() tear the modal down before we
                // return — subsequent clicks will otherwise land on a still-
                // transitioning overlay.
                await sleep(600);
                return true;
            }
            console.warn(`    ⚠️ NPS modal present but no close button found (${dismissed.reason || 'unknown'})`);
            return false;
        } catch (err) {
            console.warn(`    ⚠️ NPS modal probe failed: ${err.message}`);
            await sleep(pollMs);
        }
    }
    console.log("    ℹ️ No NPS survey modal appeared — continuing");
    return false;
}

// ---------------------------
// 🚚 Pick account under the dashboard "Domestic" dropdown (session-wide)
// ---------------------------
// The header dropdown groups all accounts under the "Domestic" title; only
// the subtitle differs (e.g. "UNIVERSAL SPORTSBIZ SURFACE" vs
// "UNIVERSAL SPORTSBIZ EXPRESS"). Config passes a short keyword like
// "SURFACE" or "EXPRESS" and we substring-match against the subtitle so the
// caller doesn't have to spell out the account-prefix. Skips silently if
// the trigger already shows a subtitle containing the keyword. Should be
// called ONCE per session (not per AWB).
async function pickDomesticAccount(driver, domesticName) {
    if (!domesticName) throw new Error("Missing 'domestic' in config entry");
    console.log(`\n🚚 Selecting Domestic account matching: ${domesticName}`);

    // Safety net: the MoEngage NPS modal sometimes shows up a few seconds
    // after login returns, i.e. right when we're about to click the header.
    // Cheap 1.5s probe — no-op when the modal isn't present.
    await dismissNpsSurveyModal(driver, { waitMs: 1500 });

    // There are multiple `.ap-menu-trigger` widgets in the header; anchor on
    // the one whose selected item title is exactly "Domestic".
    console.log("🔎 Locating Domestic dropdown trigger (title = 'Domestic')...");
    let trigger;
    try {
        trigger = await driver.wait(async () => {
            return driver.executeScript(
                `
                const triggers = Array.from(document.querySelectorAll('.ap-menu-trigger'));
                for (const t of triggers) {
                    const title = t.querySelector('.selected-options-container .item-title');
                    if (!title) continue;
                    const text = (title.textContent||'').replace(/\\s+/g,' ').trim().toLowerCase();
                    if (text === 'domestic' && t.offsetWidth > 0 && t.offsetHeight > 0) return t;
                }
                return null;
                `
            );
        }, WAIT_TIMEOUT);
    } catch (err) {
        throw new Error(`Failed at step: Domestic dropdown trigger (not found within ${WAIT_TIMEOUT}ms)`);
    }
    if (!trigger) {
        throw new Error(`Failed at step: Domestic dropdown trigger (not found within ${WAIT_TIMEOUT}ms)`);
    }

    // If the trigger's own selected-subtitle already contains our keyword,
    // skip the click dance — Delhivery persists the last selection per
    // session.
    const alreadySelected = await driver.executeScript(
        `
        const want = arguments[1].replace(/\\s+/g,' ').trim().toLowerCase();
        const sub = arguments[0].querySelector('.selected-options-container .item-subtitle');
        if (!sub) return false;
        const text = (sub.textContent||'').replace(/\\s+/g,' ').trim().toLowerCase();
        return text.includes(want);
        `,
        trigger, domesticName
    );
    if (alreadySelected) {
        console.log("    ↳ Already selected; skipping dropdown open");
        return;
    }

    await driver.executeScript("arguments[0].scrollIntoView({block:'center'});", trigger);
    await sleep(300);
    try { await trigger.click(); }
    catch (_) { await driver.executeScript("arguments[0].click();", trigger); }
    console.log("    🖱️  Opened Domestic dropdown");
    await sleep(800);

    // Menu items live inside .ap-menu-items; pick the first one whose
    // subtitle contains our keyword (case-insensitive, whitespace-normalized).
    // Lets the caller pass "SURFACE" and match "UNIVERSAL SPORTSBIZ SURFACE".
    let optionEl;
    let matchedSubtitle = "";
    try {
        const result = await driver.wait(async () => {
            return driver.executeScript(
                `
                const want = arguments[0].replace(/\\s+/g,' ').trim().toLowerCase();
                const items = Array.from(document.querySelectorAll('.ap-menu-items .ap-menu-item'));
                for (const btn of items) {
                    const sub = btn.querySelector('.item-subtitle');
                    if (!sub) continue;
                    const text = (sub.textContent||'').replace(/\\s+/g,' ').trim();
                    if (text.toLowerCase().includes(want)) return { el: btn, subtitle: text };
                }
                return null;
                `,
                domesticName
            );
        }, WAIT_TIMEOUT);
        if (result) {
            optionEl = result.el;
            matchedSubtitle = result.subtitle || "";
        }
    } catch (err) {
        throw new Error(`Failed at step: Domestic option matching '${domesticName}' (not found within ${WAIT_TIMEOUT}ms)`);
    }
    if (!optionEl) {
        throw new Error(`Failed at step: Domestic option matching '${domesticName}' (not found within ${WAIT_TIMEOUT}ms)`);
    }

    await driver.executeScript("arguments[0].scrollIntoView({block:'center'});", optionEl);
    await sleep(200);
    try { await optionEl.click(); }
    catch (_) { await driver.executeScript("arguments[0].click();", optionEl); }
    console.log(`    ✅ Selected Domestic option: ${matchedSubtitle || domesticName}`);
    // Delhivery reloads context after account switch — let it settle before
    // we start hunting for sidebar items.
    await sleep(3000);
}

// ---------------------------
// 🧭 Open the "Raise a ticket" modal from the sidebar Support page
// ---------------------------
// Steps:
//   1. Hover the collapsed left sidebar to expand it.
//   2. Click the "Support" item.
//   3. On the Support page, click the "Raise a ticket" button.
// Returns once the modal is visible.
async function openRaiseTicket(driver) {
    // Step 1 — Hover the collapsed left sidebar. Use Actions.move so Vue's
    // mouseenter listener fires (a bare JS click on the child wouldn't).
    console.log("🖱️  Hovering left sidebar to expand...");
    const sidebar = await waitFor(
        driver,
        "left sidebar",
        until.elementLocated(By.css(".ap-sidebar-parent--left")),
    );
    try {
        await driver.actions({ async: true }).move({ origin: sidebar }).perform();
    } catch (_) {
        await driver.executeScript(
            "arguments[0].dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));",
            sidebar,
        );
    }
    await sleep(800);

    // Step 2 — Click "Support" inside the expanded sidebar. Anchor on the
    // visible label because icon-only class names are compiled/hashed.
    await clickWhenReady(
        driver,
        By.xpath("//a[contains(@class,'ap-sidebar__item')][.//div[normalize-space()='Support']]"),
        "Sidebar 'Support' item",
    );
    await sleep(4000);
    console.log(`📍 Support page URL: ${await driver.getCurrentUrl()}`);

    // Step 3 — Click "Raise a ticket".
    await clickWhenReady(
        driver,
        By.css('button[data-action="support-raise-a-ticket"]'),
        "'Raise a ticket' button",
    );
    await waitFor(
        driver,
        "Raise a ticket modal",
        until.elementLocated(By.css(".ap-modal--show")),
    );
    await sleep(1000);
}

// ---------------------------
// 🎯 Pick Shipment Issue + subcategory badges → Raise Claim → drawer
// ---------------------------
// Runs against the already-open "Raise a ticket" modal. After the two badge
// clicks the bot renders a "We're very sorry..." message with a "Raise Claim"
// CTA; clicking it opens the New Claim side drawer (either same tab or a new
// tab, depending on browser/session), so we switch handles until we find one
// with the drawer mounted.
async function pickShipmentIssueAndSub(driver, shipmentIssue, subcategory) {
    if (!shipmentIssue) throw new Error("Missing shipmentIssue in config entry");
    if (!subcategory) throw new Error("Missing subcategory in config entry");

    // Click the Shipment Issue badge.
    console.log(`🎯 Picking Shipment Issue: ${shipmentIssue}`);
    await clickWhenReady(
        driver,
        By.xpath(
            `//span[contains(@class,'badge')][./span[normalize-space()=${JSON.stringify(shipmentIssue)}]]`
        ),
        `Shipment Issue badge '${shipmentIssue}'`,
    );
    // The subcategory panel renders below with a small debounce.
    await sleep(1500);

    // Click the subcategory badge.
    console.log(`🎯 Picking subcategory: ${subcategory}`);
    await clickWhenReady(
        driver,
        By.xpath(
            `//span[contains(@class,'badge')][./span[normalize-space()=${JSON.stringify(subcategory)}]]`
        ),
        `Subcategory badge '${subcategory}'`,
    );

    // Wait for "Raise Claim" CTA to render.
    console.log("⏳ Waiting for 'Raise Claim' CTA to appear...");
    const raiseClaimBtn = await waitFor(
        driver,
        "'Raise Claim' button",
        until.elementLocated(
            By.xpath("//button[.//span[normalize-space()='Raise Claim']]"),
        ),
        20000,
    );
    await driver.executeScript("arguments[0].scrollIntoView({block:'center'});", raiseClaimBtn);
    await sleep(500);

    // Click Raise Claim. Depending on browser/popup-blocker/session state,
    // Delhivery either opens the claim form in a new tab or redirects the
    // current tab. The drawer probe below handles both.
    try { await raiseClaimBtn.click(); }
    catch (_) { await driver.executeScript("arguments[0].click();", raiseClaimBtn); }
    console.log("    ✅ Clicked: Raise Claim");
    await sleep(1500);

    // Iterate every non-devtools handle until we find one whose DOM contains
    // the side drawer, then leave Selenium focused on that tab.
    const SIDEDRAWER = By.css('[data-testid="sidedrawer-container"]');
    const DEADLINE = Date.now() + 30000;

    console.log("⏳ Finding tab with auto-opened New Claim side drawer...");
    while (Date.now() < DEADLINE) {
        const handles = await driver.getAllWindowHandles();
        for (const h of handles) {
            try { await driver.switchTo().window(h); }
            catch (_) { continue; }
            const url = await driver.getCurrentUrl().catch(() => "");
            if (url.startsWith("devtools://")) continue;
            const hits = await driver.findElements(SIDEDRAWER);
            if (hits.length > 0) {
                console.log(`    ✅ Side drawer found on tab: ${h}`);
                console.log(`📍 Drawer tab URL: ${url}`);
                await sleep(1500); // let mount animation finish
                return;
            }
        }
        await sleep(1000);
    }
    throw new Error("Failed at step: New claim side drawer (not found on any tab within 30000ms)");
}

// ---------------------------
// 🚫 Drawer notices Delhivery renders after an AWB is picked
// ---------------------------
// Once the AWB is selected from the autocomplete, Delhivery may replace the
// claim-type dropdown with a message explaining why no claim can be raised.
// These are business outcomes, not automation failures, so we surface
// Delhivery's own sentence verbatim (no wrapper text) instead of letting the
// step die on a generic "dropdown not found" timeout.
//
// The first entry is informational only — the claim window closed for *some*
// claim types but the rest are still selectable, so the run continues.
//
// `ticketMayExist` marks the notices that only render because a claim for this
// waybill already went through Delhivery's system. The caller looks the ticket
// up first and links it to CMS; only when no ticket turns up does it fail the
// AWB with the notice text verbatim.
const DRAWER_NOTICES = [
    {
        blocking: true,
        // Some claim types are past their window. Raising is still possible on
        // the remaining ones — but if the type we need is one of the closed
        // ones, a claim for this waybill was likely already filed.
        ticketMayExist: true,
        re: /The claim raise window for certain options has closed,?\s*but please check if the remaining claim types are what you were looking for\.?/i,
    },
    {
        blocking: true,
        // Nothing was ever raised here — the window simply expired.
        ticketMayExist: false,
        re: /The claim raise window for this waybill has passed\.\s*Next time,?\s*please ensure your claim is raised while the window is still active\.?/i,
    },
    {
        blocking: true,
        // "A claim has already been approved for AWB <awb>." — approved means a
        // ticket for this waybill exists on Delhivery, so look it up before
        // failing the AWB.
        ticketMayExist: true,
        re: /A claim has already been approved for AWB\s*\S+?\.?(?=\s|$)/i,
    },
    {
        blocking: true,
        // Field-level validation — the AWB was never accepted, so there is
        // nothing to look up. This sentence IS the failure reason.
        ticketMayExist: false,
        re: /Please enter a valid AWB number\.?/i,
    },
];

// Reads the drawer's *visible* text (innerText skips hidden nodes, so a stale
// validation message left in the DOM doesn't produce a false positive) and
// matches it against the notices above.
// The drawer is the usual host, but the inline "Please enter a valid AWB
// number" validation can render while the form is still a plain modal, so we
// fall back to the dialog container. Matching is against specific sentences,
// so the wider scope can't produce a false positive from an unrelated modal.
// Returns { text, blocking, ticketMayExist } for the first match, or null when
// the drawer is in a normal state.
async function readDrawerNotice(driver) {
    const text = await driver
        .executeScript(
            `
            const specificEl = document.querySelector('.css-1f2n801');
            if (specificEl) {
                const t = (specificEl.innerText || specificEl.textContent || '').replace(/\\s+/g, ' ').trim();
                if (t) return t;
            }
            const el = document.querySelector('[data-testid="sidedrawer-container"]')
                || document.querySelector('[data-testid="modal-container"]')
                || document.querySelector('[role="dialog"]');
            if (!el) return '';
            return (el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim();
            `,
        )
        .catch(() => "");
    if (!text) return null;

    for (const notice of DRAWER_NOTICES) {
        const m = text.match(notice.re);
        if (m) {
            return {
                text: m[0].trim(),
                blocking: notice.blocking,
                ticketMayExist: !!notice.ticketMayExist,
            };
        }
    }
    return null;
}

// Throws Delhivery's message verbatim when the drawer says the claim can't be
// raised. The thrown error is tagged `delhiveryNotice` so scriptNew.js reports
// the sentence as-is instead of prefixing it with "Step 4 (...) failed:", and
// `priorClaimExists` when the notice implies a ticket for this waybill already
// exists (e.g. "A claim has already been approved for AWB ...") — scriptNew.js
// then looks that ticket up and links it to CMS, and only rethrows this same
// error verbatim when no ticket is found.
// Returns the non-blocking notice object (or null) so the caller can reuse it
// if the claim type it needs turns out to be one of the closed ones.
async function assertNoBlockingDrawerNotice(driver) {
    const notice = await readDrawerNotice(driver);
    if (!notice) return null;
    if (!notice.blocking) {
        console.log(`    ℹ️  Delhivery notice (non-blocking): ${notice.text}`);
        return notice;
    }
    console.log(`    ⛔ Delhivery notice: ${notice.text}`);
    const err = new Error(notice.text);
    err.delhiveryNotice = true;
    if (notice.ticketMayExist) err.priorClaimExists = true;
    throw err;
}

// ---------------------------
// 🔢 Enter AWB + pick claim type inside the drawer
// ---------------------------
// The drawer only validates the AWB when you pick it from the autocomplete
// suggestion (data-testid="awb-suggestion-<awb>"). Just typing the digits
// leaves it in a "Please enter a valid AWB number" state and the claim-type
// dropdown never renders. If the suggestion doesn't appear on the first try
// (SPA debounce), backspace one char and retype it to nudge the query.
async function enterAwbAndClaimType(driver, awbNumber, claimType) {
    if (!awbNumber) throw new Error("Missing awbNumber");
    if (!claimType) throw new Error("Missing claimType");

    const AWB_INPUT = By.css('[data-testid="sidedrawer-container"] input[data-testid="search-input"]');
    const EXACT_SUGGESTION = By.css(`[data-testid="awb-suggestion-${awbNumber}"]`);
    const ANY_SUGGESTION = By.css('[data-testid^="awb-suggestion-"]');

    // Focus + fully clear the input so we start from a known state.
    const input = await waitFor(driver, "AWB input", until.elementLocated(AWB_INPUT));
    await driver.executeScript("arguments[0].scrollIntoView({block:'center'});", input);
    try { await input.click(); }
    catch (_) { await driver.executeScript("arguments[0].focus();", input); }
    await input.sendKeys(Key.chord(Key.COMMAND, "a"));
    await input.sendKeys(Key.BACK_SPACE);
    await input.sendKeys(Key.chord(Key.CONTROL, "a"));
    await input.sendKeys(Key.BACK_SPACE);

    // Type slowly, char-by-char. Delhivery's autocomplete debounces per
    // keystroke; 150ms/char keeps us out of the debounce window.
    console.log(`⌨️  Typing AWB ${awbNumber} char-by-char...`);
    for (const ch of String(awbNumber)) { await input.sendKeys(ch); await sleep(150); }

    // Poll for a suggestion (exact first, generic second). If none appears
    // within 8s, backspace one char + retype to re-fire the query. Up to 3
    // nudges.
    const findSuggestion = async () => {
        let els = await driver.findElements(EXACT_SUGGESTION);
        if (els.length === 0) els = await driver.findElements(ANY_SUGGESTION);
        return els[0] || null;
    };

    const MAX_NUDGES = 3;
    let suggestion = null;
    for (let attempt = 0; attempt <= MAX_NUDGES; attempt++) {
        const WAIT_MS = 8000, POLL_MS = 300;
        for (let waited = 0; waited < WAIT_MS; waited += POLL_MS) {
            await sleep(POLL_MS);
            suggestion = await findSuggestion();
            if (suggestion) break;
        }
        if (suggestion) break;
        if (attempt === MAX_NUDGES) {
            // Delhivery usually explains itself in the drawer ("Please enter a
            // valid AWB number") — report that sentence instead of our guess.
            // That inline validation is the whole reason: the AWB was never
            // accepted, so no ticket lookup follows it.
            await assertNoBlockingDrawerNotice(driver);
            throw new Error(
                `Failed at step: AWB suggestion for ${awbNumber} (not shown after ${MAX_NUDGES} nudges — ` +
                `AWB may not exist in this Delhivery account or the search API is failing)`,
            );
        }
        console.log(`    ↩️ Suggestion not shown, nudging (attempt ${attempt + 1}/${MAX_NUDGES})...`);
        await input.sendKeys(Key.BACK_SPACE);
        await sleep(400);
        await input.sendKeys(String(awbNumber).slice(-1));
    }

    const testid = await suggestion.getAttribute("data-testid").catch(() => "");
    console.log(`    ✅ Suggestion found (data-testid="${testid}")`);
    await driver.executeScript("arguments[0].scrollIntoView({block:'center'});", suggestion);
    await sleep(200);
    try { await suggestion.click(); }
    catch (_) { await driver.executeScript("arguments[0].click();", suggestion); }
    console.log(`    ✅ Clicked AWB suggestion for ${awbNumber}`);

    // The drawer re-renders after the AWB selection — the claim-type dropdown
    // mounts as part of that render, so any DOM ref taken too early goes
    // stale. Wait for the trigger to be present AND stable across two polls
    // before we try clicking it.
    const DROPDOWN_SELECTOR = By.css('[data-testid="sidedrawer-container"] [data-testid="dropdown-input-field"]');
    await sleep(2500);

    // The re-render is also where "claim window passed" / "already approved"
    // notices land. Check before waiting on a dropdown that will never mount.
    const partialWindowNotice = await assertNoBlockingDrawerNotice(driver);

    try {
        await driver.wait(async () => {
            const els1 = await driver.findElements(DROPDOWN_SELECTOR);
            if (els1.length === 0) return false;
            await sleep(400);
            const els2 = await driver.findElements(DROPDOWN_SELECTOR);
            return els2.length > 0;
        }, WAIT_TIMEOUT);
    } catch (err) {
        // A notice can render late (async validation). Re-check so the reason
        // reported is Delhivery's, not a bare timeout.
        await assertNoBlockingDrawerNotice(driver);
        throw err;
    }

    // Open the claim-type dropdown (trigger + listbox are scoped to the drawer).
    // Retry on StaleElementReferenceError — the drawer can re-render one more
    // time as async validation completes.
    console.log(`📂 Selecting claim type: ${claimType}`);
    for (let attempt = 1; attempt <= 3; attempt++) {
        try {
            await clickWhenReady(driver, DROPDOWN_SELECTOR, "claim-type dropdown trigger");
            break;
        } catch (err) {
            if (err && err.name === "StaleElementReferenceError" && attempt < 3) {
                console.log(`    ↩️ Dropdown trigger went stale, retrying (${attempt}/3)...`);
                await sleep(1000);
                continue;
            }
            throw err;
        }
    }
    // Listbox is portal-rendered; scope by testid + option text.
    try {
        await clickWhenReady(
            driver,
            By.xpath(
                "//div[@data-testid='dropdown-list-panel']" +
                `//div[@data-testid='dropdown-list-cell'][.//span[normalize-space()=${JSON.stringify(claimType)}]]`
            ),
            `option '${claimType}'`,
        );
    } catch (err) {
        // The requested claim type isn't offered. When Delhivery already told
        // us why (window closed for some options), that sentence is the whole
        // explanation — report it verbatim. Tagged `priorClaimExists` so the
        // caller checks for an existing ticket first: the type we need being
        // closed usually means a claim for this waybill was already filed.
        if (partialWindowNotice) {
            const e = new Error(partialWindowNotice.text);
            e.delhiveryNotice = true;
            if (partialWindowNotice.ticketMayExist) e.priorClaimExists = true;
            throw e;
        }
        throw err;
    }
    await sleep(1000);
}

// ---------------------------
// 📤 Upload files to the unboxing photo/video input
// ---------------------------
// Delhivery's unboxing input is multi-file and accepts a newline-joined batch
// via Selenium's `sendKeys`. The input is display:none/class="hidden"; we
// force-show it as a safety net (usually sendKeys works either way).
async function uploadUnboxingDocs(driver, filePaths) {
    const paths = (Array.isArray(filePaths) ? filePaths : [filePaths]).filter(Boolean);
    if (paths.length === 0) {
        console.log("    ↳ No unboxing docs to upload — skipping");
        return;
    }
    for (const p of paths) {
        if (!fs.existsSync(p)) {
            throw new Error(`Failed at step: Unboxing upload (file not found -> ${p})`);
        }
    }
    console.log(`📤 Uploading ${paths.length} unboxing file(s)...`);
    let el;
    try {
        el = await waitFor(
            driver,
            "Unboxing photo/video input",
            until.elementLocated(By.css('input[data-testid="photo-video-file-input"]')),
        );
    } catch (err) {
        // The photo/video input never rendered. Delhivery sometimes replaces
        // the upload UI with a rejected-claim banner ("We noticed a previous
        // claim for this issue wasn't approved..."). Surface that sentence
        // verbatim (tagged `delhiveryNotice`) so the CMS row shows the real
        // reason instead of a generic input-missing error.
        const bannerText = await driver
            .executeScript(
                `
                const b = document.querySelector('[data-testid="rejected-claim-info-banner"]');
                if (!b) return null;
                return (b.innerText || b.textContent || '').replace(/\\s+/g, ' ').trim();
                `,
            )
            .catch(() => null);
        const REJECTED_NOTICE = "We noticed a previous claim for this issue wasn't approved. Are you looking to raise a different concern for this waybill?";
        if (bannerText && bannerText.includes("We noticed a previous claim for this issue wasn't approved")) {
            console.log(`    ⛔ Delhivery notice: ${REJECTED_NOTICE}`);
            const noticeErr = new Error(REJECTED_NOTICE);
            noticeErr.delhiveryNotice = true;
            // This banner only renders because an EARLIER claim for this waybill
            // was already filed and rejected — so a ticket for this AWB exists on
            // Delhivery. The caller looks it up and links it to CMS instead of
            // failing blind; if no ticket turns up, it rethrows this same error.
            noticeErr.priorClaimExists = true;
            throw noticeErr;
        }

        const drawerNotice = await readDrawerNotice(driver).catch(() => null);
        if (drawerNotice && drawerNotice.text) {
            console.log(`    ⛔ Delhivery notice: ${drawerNotice.text}`);
            const noticeErr = new Error(drawerNotice.text);
            noticeErr.delhiveryNotice = true;
            noticeErr.priorClaimExists = !!drawerNotice.ticketMayExist;
            throw noticeErr;
        }

        // waitFor already produced "Failed at step: Unboxing photo/video input
        // (element not found within 20000ms)" — rethrow it instead of nesting
        // the same prefix inside itself.
        throw err;
    }
    await driver.executeScript(
        "arguments[0].classList.remove('hidden');" +
        "arguments[0].style.display='block';" +
        "arguments[0].style.visibility='visible';",
        el,
    );
    await el.sendKeys(paths.join("\n"));
    console.log(`    ✅ Unboxing files sent (${paths.length})`);
    await sleep(2500);
}

// ---------------------------
// 🚦 Submit the claim drawer
// ---------------------------
// The claim form has two submit buttons — `submit-add-new-btn` ("Submit & add
// new") and `submit-btn` ("Submit"). We use the plain Submit. We locate it
// by its raw `[data-testid="submit-btn"]`, filtering out the "Submit & add
// new" variant.
//
// Flow: click Submit → wait 10s for Delhivery to finish the POST → return
// (getDelhiveryTicketId then navigates to the tickets page). No page reload
// — that would abort the in-flight submission.
async function submitClaimDrawer(driver) {
    console.log("\n🚦 Submitting the claim...");
    // DESABLE_SAVE=true → the drawer stays filled, the POST never fires.
    assertClaimSubmitEnabled("Delhivery", "drawer 'Submit' click");

    const submitEl = await driver.wait(async () => {
        return driver.executeScript(`
            const nodes = Array.from(document.querySelectorAll('[data-testid="submit-btn"]'));
            for (const btn of nodes) {
                if (btn.getAttribute('data-testid') === 'submit-add-new-btn') continue;
                const rect = btn.getBoundingClientRect();
                if (rect.width === 0 || rect.height === 0) continue;
                return btn;
            }
            return null;
        `);
    }, WAIT_TIMEOUT).catch(() => null);
    if (!submitEl) {
        throw new Error("Failed at step: Submit button (not found within 20000ms)");
    }
    await sleep(1000);
    try { await driver.executeScript("arguments[0].scrollIntoView({block:'center'});", submitEl); }
    catch (_) { /* element may already be scrolled or gone; harmless */ }
    await sleep(300);

    // Click Submit. This often triggers a form POST that navigates/refreshes
    // the page, which invalidates the WebElement mid-click and makes selenium
    // throw StaleElementReferenceError. That error means "the click already
    // fired, then the DOM went stale" — NOT that we failed to click. If we
    // let it bubble up, scriptNew.js's outer catch triggers its recovery
    // navigation (`driver.get("https://one.delhivery.com/")`), which is the
    // instant "reload" we were seeing instead of the 10s wait.
    let clickedAt = Date.now();
    try {
        await submitEl.click();
        console.log("    ✅ Clicked: Submit (native)");
    } catch (err) {
        const isStale = err && (err.name === "StaleElementReferenceError" || /stale element/i.test(err.message || ""));
        if (isStale) {
            console.log("    ✅ Submit click fired (element went stale after click, which is expected on form submit)");
        } else {
            console.log(`    ↩️ Native click errored (${err.name || "unknown"}: ${err.message}), trying JS click...`);
            try {
                await driver.executeScript("arguments[0].click();", submitEl);
                console.log("    ✅ Clicked: Submit (JS fallback)");
            } catch (err2) {
                const isStale2 = err2 && (err2.name === "StaleElementReferenceError" || /stale element/i.test(err2.message || ""));
                if (!isStale2) throw err2;
                console.log("    ✅ Submit click fired (JS click, element went stale after)");
            }
        }
    }

    // Wait a full 10s. Pure JS timer — no selenium calls, no way for an
    // in-flight page navigation to interrupt it.
    console.log("    ⏳ Waiting 10s for Delhivery to process the claim...");
    await sleep(10000);
    console.log(`    ✅ 10s wait complete (elapsed: ${Date.now() - clickedAt}ms since click)`);
}

// ---------------------------
// 🎫 Ticket lookup — /support/support-tickets/open, filter by AWB, read row
// ---------------------------
// After submit, the newly-created ticket appears at the top of the "Open"
// support tickets list. We navigate there, switch the search dropdown from
// its default "Ticket ID" to "AWB", type the AWB, press Enter, then read the
// clickable ticket id from the first row.
//
// Searches three tabs in order — Open, Resolved, Closed — and reports which
// tab surfaced the ticket so the caller can flip CMS status: Resolved →
// Approved, Closed → Rejected, Open → (unchanged).
//
// Returns { ticketId: string, tab: 'open'|'resolved'|'closed' } on hit, or
// null when nothing matched on any tab.
async function getDelhiveryTicketId(driver, awbNumber) {
    if (!awbNumber) return null;

    const url = "https://one.delhivery.com/support/support-tickets/open";
    console.log(`\n🎫 Looking up ticket id for AWB ${awbNumber}`);
    console.log(`🌐 Navigating to: ${url}`);
    try {
        await driver.get(url);
        await waitFor(driver, "support tickets search bar", until.elementLocated(By.css('.ucp_ticket__search')), 8000).catch(() => null);
        await sleep(500);
        console.log(`📍 Support tickets URL: ${await driver.getCurrentUrl()}`);

        // Try Open first (default landing tab), then Resolved, then Closed.
        // Delhivery hides freshly-approved claims under Resolved and rejected
        // ones under Closed, so we walk all three before giving up.
        const TABS = [
            { key: "open", label: null },      // already on Open after navigation
            { key: "resolved", label: "Resolved" },
            { key: "closed", label: "Closed" },
        ];

        for (const tab of TABS) {
            if (tab.label) {
                console.log(`\n🗂️  Switching to "${tab.label}" tab...`);
                const clicked = await driver.executeScript(
                    `
                    const btns = Array.from(document.querySelectorAll('button.ap-tabs__nav-item'));
                    const target = btns.find(b => {
                        const t = (b.innerText || b.textContent || '').replace(/\\s+/g,' ').trim().toLowerCase();
                        return t.startsWith(arguments[0].toLowerCase());
                    });
                    if (!target) return false;
                    target.click();
                    return true;
                    `,
                    tab.label,
                );
                if (!clicked) {
                    console.log(`    ⚠️  "${tab.label}" tab button not found — skipping`);
                    continue;
                }
                await sleep(400);
            }

            // Every tab switch remounts the search widget: the type resets to
            // "Ticket ID" and the input clears. So the full sequence — pick AWB,
            // retype the AWB, press Enter — has to run again on each tab.
            const typeSelected = await selectAwbSearchType(driver);
            if (!typeSelected) {
                console.log(`    ⚠️  Could not set search type to AWB on "${tab.key}" tab — skipping`);
                continue;
            }

            const ticketId = await searchAwbAndReadTicket(driver, awbNumber);
            if (ticketId) {
                console.log(`    🎫 Ticket ID: ${ticketId} (found on "${tab.key}" tab)`);
                return { ticketId, tab: tab.key };
            }
            console.log(`    ⚠️  No ticket row on "${tab.key}" tab for AWB ${awbNumber}`);
        }

        console.log(`    ⚠️  Ticket not found on Open / Resolved / Closed for AWB ${awbNumber}`);
        return null;
    } catch (err) {
        console.log(`    ⚠️  Ticket lookup failed: ${err.message}`);
        return null;
    }
}

// Switch the search-type dropdown from its default "Ticket ID" to "AWB".
//
// Must run on EVERY tab: Delhivery remounts the search widget on each tab
// switch, which resets the type back to "Ticket ID". Anchored on
// `.ucp_ticket__search` so we don't grab unrelated `.ap-menu-trigger` widgets.
// Returns true when AWB is selected, false if the dropdown or option is missing.
async function selectAwbSearchType(driver) {
    console.log("🖱️  Setting search type to AWB (Ticket ID → AWB)...");
    try {
        const typeTrigger = await waitFor(
            driver,
            "search-type dropdown trigger",
            until.elementLocated(By.css('.ucp_ticket__search .ap-menu-trigger-root')),
            5000,
        );
        await driver.executeScript("arguments[0].scrollIntoView({block:'center'});", typeTrigger);
        await sleep(150);
        try { await typeTrigger.click(); }
        catch (_) { await driver.executeScript("arguments[0].click();", typeTrigger); }
        await sleep(250);

        // Match the AWB item inside the menu by its visible label.
        const awbOption = await driver.wait(async () => {
            return driver.executeScript(
                `
                const items = Array.from(document.querySelectorAll(
                    '.ucp_ticket__search .ap-menu-items .ap-menu-item'
                ));
                for (const btn of items) {
                    const t = (btn.textContent || '').replace(/\\s+/g,' ').trim().toLowerCase();
                    if (t === 'awb') return btn;
                }
                return null;
                `
            );
        }, 3000);

        if (!awbOption) {
            console.log("    ⚠️  AWB option not found in search-type dropdown");
            return false;
        }
        try { await awbOption.click(); }
        catch (_) { await driver.executeScript("arguments[0].click();", awbOption); }
        console.log("    ✅ Selected search-type: AWB");
        await sleep(250);
        return true;
    } catch (err) {
        console.log(`    ⚠️  Could not select AWB search type: ${err.message}`);
        return false;
    }
}

// Types the AWB into the search input on the currently-active tab, presses
// Enter, then polls the first row's TICKET ID cell. Returns the ticket id
// string, or null if no row surfaced within the poll window.
//
// Assumes the search type is already "AWB" — call selectAwbSearchType() first.
/**
 * Which row of the tickets table belongs to this waybill — run INSIDE the page.
 *
 * SERIALISED INTO THE BROWSER, so it must stay self-contained: no imports, no
 * closures, nothing from this module. Exported so a test can call it against a
 * faked table, because what it decides is which ticket number gets written onto
 * a claim.
 *
 * THE BUG IT EXISTS FOR. This used to read `tbody tr` — the FIRST row — the
 * instant after the search was submitted. The table on screen at that moment is
 * still the unfiltered list, so the first row is another parcel's ticket, and
 * that number went onto this claim: the AWB looks handled, its real ticket is
 * untracked, and somebody else's claim number is on the row.
 *
 * `stale` is the state that caused it — rows on screen, none of them this AWB —
 * and saying so is what lets the caller wait instead of guessing.
 *
 * @param {string} awb
 * @returns {{status: 'found', ticketId: string}|{status: 'empty'}|{status: 'loading'}|{status: 'stale', rows: number}}
 */
function readTicketRow(awb) {
    const wanted = String(awb);
    const table = document.querySelector('table.ap-table');

    if (!table) return { status: 'loading' };

    const rows = Array.from(table.querySelectorAll('tbody tr'));

    if (rows.length === 0) {
        const emptyState = document.querySelector('.ap-empty-state, .ucp_ticket__no-data, [data-testid="empty-state"]');

        return emptyState ? { status: 'empty' } : { status: 'loading' };
    }

    const first = (rows[0].innerText || rows[0].textContent || '').toLowerCase();

    if (first.includes('no data') || first.includes('no records') || first.includes('no tickets')) {
        return { status: 'empty' };
    }

    // The column holds both — it is literally "TICKET ID & AWB" — so the page
    // itself says which ticket belongs to which parcel.
    for (const row of rows) {
        const cell = row.querySelector('td[data-label="TICKET ID & AWB"]');

        if (!cell) continue;

        const cellText = cell.innerText || cell.textContent || '';

        if (!cellText.includes(wanted)) continue;

        const link = cell.querySelector('.text-cta-primary');
        const ticketId = link ? (link.textContent || '').trim() : null;

        if (ticketId) return { status: 'found', ticketId };
    }

    // Rows, but none for this AWB: the table is still showing the previous
    // result. Not empty, not found — ask again.
    return { status: 'stale', rows: rows.length };
}

async function searchAwbAndReadTicket(driver, awbNumber) {
    const searchInput = await waitFor(
        driver,
        "AWB search input",
        until.elementLocated(By.css('.ucp_ticket__search input.input[type="text"]')),
        5000,
    );
    await driver.executeScript("arguments[0].scrollIntoView({block:'center'});", searchInput);
    try { await searchInput.click(); }
    catch (_) { await driver.executeScript("arguments[0].focus();", searchInput); }
    // Clear whatever the previous tab left behind. Both modifiers, same as
    // typeHuman() — COMMAND is a no-op on the Linux server, CONTROL on macOS.
    await searchInput.sendKeys(Key.chord(Key.COMMAND, "a"));
    await searchInput.sendKeys(Key.BACK_SPACE);
    await searchInput.sendKeys(Key.chord(Key.CONTROL, "a"));
    await searchInput.sendKeys(Key.BACK_SPACE);
    await searchInput.sendKeys(String(awbNumber));
    await sleep(200);
    await searchInput.sendKeys(Key.ENTER);
    console.log(`    ⌨️  Typed AWB + Enter: ${awbNumber}`);

    /*
     * LET THE SEARCH LAND BEFORE READING THE TABLE.
     *
     * The table is already on screen when Enter is pressed — it is the
     * UNFILTERED list — and polling started immediately, so the first read
     * routinely happened before the results had been replaced. It then took the
     * first row, which is another parcel's ticket, and wrote that number onto
     * this claim. That is the worst outcome this function has: the AWB looks
     * handled, its real ticket is untracked, and the number on the row belongs
     * to somebody else's claim.
     *
     * The settle wait makes it unlikely; matching the AWB below makes it
     * impossible. Both, because a slow day beats the wait and a fast one makes
     * the match free.
     */
    await sleep(SEARCH_SETTLE_MS);

    console.log("    ⏳ Polling for the row that carries this AWB...");
    const DEADLINE = Date.now() + 8000;
    let ticketId = null;
    let emptyCount = 0;
    let staleSeen = false;
    while (Date.now() < DEADLINE) {
        // Serialised from the named function below rather than written as a
        // string here, so the thing the browser runs is the thing the test
        // runs. A reader that decides which ticket belongs to which claim is
        // not something to keep in a template literal nobody can exercise.
        const res = await driver
            .executeScript(`return (${readTicketRow})(arguments[0])`, String(awbNumber))
            .catch(() => ({ status: 'loading' }));

        if (res?.status === 'found' && res.ticketId) {
            ticketId = res.ticketId;
            break;
        }
        if (res?.status === 'empty') {
            emptyCount++;
            if (emptyCount >= 2) break; // Early exit when tab explicitly shows no data
        } else {
            emptyCount = 0;
        }

        if (res?.status === 'stale') {
            // Said once, and only once: rows are on screen for other parcels,
            // which is exactly the state that used to produce a wrong ticket.
            if (!staleSeen) {
                console.log(`    ⏳ ${res.rows} row(s) on screen, none for ${awbNumber} yet — waiting for the search to land`);
                staleSeen = true;
            }
        }
        await sleep(300);
    }
    return ticketId || null;
}

module.exports = {
    buildDriver,
    downloadFile,
    delhiveryLogin,
    dismissNpsSurveyModal,
    pickDomesticAccount,
    openRaiseTicket,
    pickShipmentIssueAndSub,
    enterAwbAndClaimType,
    uploadUnboxingDocs,
    submitClaimDrawer,
    getDelhiveryTicketId,
    readTicketRow,
    SEARCH_SETTLE_MS,
};
