// -----------------------------------------------------------------------------
// XBees Client Portal — Auto Claim utilities (Selenium, Node.js)
// -----------------------------------------------------------------------------
// Extracted from Automated-scripts/xbeesAutomation.js (the interactive
// skeleton). scriptNew.js drives the flow; everything here is stateless so a
// single logged-in driver can loop through configArr.
//
// Exports:
//   - buildDriver()
//   - downloadFile(url, filename, tempPath)
//   - xbeesLogin(driver, credentials)
//   - goToDisputePage(driver)
//   - openRaiseDisputeModal(driver)
//   - enterAwbAndGo(driver, awbNumber)
//   - selectMuiOption(driver, comboboxId, value, label)
//   - typeIntoInput(driver, locator, value, label)
//   - replaceSlotWithFile(driver, slotKey, filePath, humanLabel)
//   - uploadPackagePhotos(driver, packagePhotos)    (uses image_1..4 slot map)
//   - reportSubmitState(driver, tempPath)
//   - clickSubmit(driver)
//   - getXbeesTicketId(driver, awbNumber)
// -----------------------------------------------------------------------------

const path = require("path");
const fs = require("fs-extra");
const axios = require("axios");
const { Builder, By, Key, until } = require("selenium-webdriver");
const chrome = require("selenium-webdriver/chrome");
const { assertClaimSubmitEnabled } = require("../../../../common/claimSubmitGuard");
const { isHeadless } = require("../../../../common/headless.js");

// ---------------------------
// ⏱️ Timeouts & small helpers
// ---------------------------
const WAIT_TIMEOUT = 20000;
// HEADLESS=false → visible browser; default (unset) headless.
// Read lazily so it works no matter when dotenv.config() runs.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(driver, label, condition, timeout = WAIT_TIMEOUT) {
    try {
        return await driver.wait(condition, timeout);
    } catch (err) {
        if (err && err.name === "TimeoutError") {
            const e = new Error(`Failed at step: ${label} (not found within ${timeout}ms)`);
            e.name = "StepTimeoutError";
            throw e;
        }
        throw err;
    }
}

async function clickWhenReady(driver, locator, label) {
    console.log(`🖱️  Waiting for: ${label}`);
    const el = await waitFor(driver, label, until.elementLocated(locator));
    await waitFor(driver, `${label} (visible)`, until.elementIsVisible(el));
    await waitFor(driver, `${label} (enabled)`, until.elementIsEnabled(el));
    await driver.executeScript("arguments[0].scrollIntoView({block:'center'});", el);
    await sleep(300);
    try { await el.click(); }
    catch (_) { await driver.executeScript("arguments[0].click();", el); }
    console.log(`    ✅ Clicked: ${label}`);
    return el;
}

// Keycloak sometimes fails the standard visibility gate — pick the first
// element that reports isDisplayed() + has non-zero size.
async function findVisible(driver, locator, label, timeout = WAIT_TIMEOUT) {
    return driver.wait(async () => {
        const els = await driver.findElements(locator);
        for (const el of els) {
            const size = await el.getRect().catch(() => ({ width: 0, height: 0 }));
            const displayed = await el.isDisplayed().catch(() => false);
            if (displayed && size.width > 0 && size.height > 0) return el;
        }
        return null;
    }, timeout, `${label} — no visible element within ${timeout}ms`);
}

async function typeSlow(driver, el, value) {
    await driver.executeScript("arguments[0].scrollIntoView({block:'center'});", el);
    await sleep(200);
    try { await el.click(); } catch (_) { await driver.executeScript("arguments[0].focus();", el); }
    await el.sendKeys(Key.chord(Key.COMMAND, "a"));
    await el.sendKeys(Key.BACK_SPACE);
    await el.sendKeys(Key.chord(Key.CONTROL, "a"));
    await el.sendKeys(Key.BACK_SPACE);
    for (const ch of String(value)) { await el.sendKeys(ch); await sleep(80); }
}

async function typeIntoInput(driver, locator, value, label, { slow = false } = {}) {
    console.log(`⌨️  Typing into: ${label}`);
    const el = await waitFor(driver, label, until.elementLocated(locator));
    await waitFor(driver, `${label} (visible)`, until.elementIsVisible(el));
    if (slow) {
        await typeSlow(driver, el, value);
    } else {
        await driver.executeScript("arguments[0].scrollIntoView({block:'center'});", el);
        try { await el.click(); } catch (_) { await driver.executeScript("arguments[0].focus();", el); }
        await el.sendKeys(Key.chord(Key.COMMAND, "a"));
        await el.sendKeys(Key.BACK_SPACE);
        await el.sendKeys(value);
    }
    console.log(`    ✅ Entered ${label}`);
}

// ---------------------------
// 📥 Remote URL → local file (S3 URLs from BE become local paths for Selenium's
// file input, which only accepts absolute paths).
// ---------------------------
async function downloadFile(url, filename, tempPath) {
    if (!url) return null;
    const outPath = path.join(tempPath, filename);
    const writer = fs.createWriteStream(outPath);
    const response = await axios({ url, method: "GET", responseType: "stream", timeout: 60000 });
    response.data.pipe(writer);
    await new Promise((resolve, reject) => {
        writer.on("finish", resolve);
        writer.on("error", reject);
    });
    return outPath;
}

// ---------------------------
// 🌐 Browser
// ---------------------------
async function buildDriver() {
    const options = new chrome.Options();
    if (isHeadless()) options.addArguments("--headless=new");
    options.addArguments(
        "--window-size=1440,900",
        "--disable-blink-features=AutomationControlled",
        "--no-sandbox",
        "--disable-dev-shm-usage"
    );
    options.excludeSwitches("enable-automation");
    options.setUserPreferences({
        credentials_enable_service: false,
        "profile.password_manager_enabled": false,
    });
    const driver = await new Builder().forBrowser("chrome").setChromeOptions(options).build();
    await driver.manage().setTimeouts({ implicit: 0, pageLoad: 60000 });
    await driver.manage().window().setRect({ width: 1440, height: 900 });
    return driver;
}

// ---------------------------
// 🔑 Login (Keycloak SSO with bounce handling)
// ---------------------------
async function xbeesLogin(driver, { username, password }) {
    if (!username || !password) throw new Error("LOGIN_FAILED: missing username or password");
    const url = "https://clientportal.xbees.in/";
    console.log(`🌐 Navigating to ${url}`);
    await driver.get(url);
    await sleep(4000);
    console.log(`📍 Landed at: ${await driver.getCurrentUrl()}`);

    await clickWhenReady(
        driver,
        By.xpath("//button[normalize-space()='Sign in']"),
        "'Sign in' button (landing)"
    );

    console.log("⏳ Waiting for Keycloak login page to load...");
    await waitFor(driver, "Keycloak username field", until.elementLocated(By.id("username")));
    await sleep(1000);

    const userEl = await findVisible(driver, By.id("username"), "username input");
    await typeSlow(driver, userEl, username);
    const passEl = await findVisible(driver, By.id("password"), "password input");
    await typeSlow(driver, passEl, password);
    await sleep(400);

    const submitEl = await findVisible(driver, By.id("kc-login"), "'Sign In' submit");
    await driver.executeScript("arguments[0].scrollIntoView({block:'center'});", submitEl);
    try { await submitEl.click(); }
    catch (_) { await driver.executeScript("arguments[0].click();", submitEl); }
    console.log(`    ✅ Clicked: 'Sign In' submit`);

    console.log("⏳ Waiting to leave the Keycloak auth host...");
    await driver.wait(async () => {
        const u = await driver.getCurrentUrl();
        return u.includes("clientportal.xbees.in");
    }, 30000);
    await sleep(3000);
    console.log(`📍 Post-Keycloak URL: ${await driver.getCurrentUrl()}`);

    // Bounce handler — SSO round-trips may bring us back to the landing page
    // with a fresh "Sign in" button. Click it up to 3 times.
    for (let attempt = 1; attempt <= 3; attempt++) {
        const bounceBtns = await driver.findElements(
            By.xpath("//button[normalize-space()='Sign in']")
        );
        if (bounceBtns.length === 0) break;
        console.log(`↩️  Landed on Sign in again (attempt ${attempt}) — clicking through...`);
        try { await bounceBtns[0].click(); }
        catch (_) { await driver.executeScript("arguments[0].click();", bounceBtns[0]); }
        await sleep(4000);
    }

    const finalBounce = await driver.findElements(
        By.xpath("//button[normalize-space()='Sign in']")
    );
    if (finalBounce.length > 0) {
        throw new Error("LOGIN_FAILED: still on landing 'Sign in' after 3 bounce clicks");
    }
    console.log(`📍 Final post-login URL: ${await driver.getCurrentUrl()}`);
}

// ---------------------------
// 🧭 Navigation + dispute-form entry
// ---------------------------
async function goToDisputePage(driver) {
    const url = "https://clientportal.xbees.in/dispute";
    console.log(`🌐 Navigating to dispute page: ${url}`);
    await driver.get(url);
    await sleep(4000);
}

async function openRaiseDisputeModal(driver) {
    await clickWhenReady(
        driver,
        By.xpath("//button[contains(normalize-space(),'Raise Dispute')]"),
        "'+ Raise Dispute' button"
    );
    console.log("⏳ Waiting for Raise Dispute modal...");
    await waitFor(
        driver,
        "Raise Dispute modal",
        until.elementLocated(By.css('div[role="presentation"].MuiDialog-root'))
    );
    await sleep(800);

    // "Log Dispute For 1 Shipment" — the tile is a div with a direct-child
    // <span> holding the text (sibling SVG). Use ./span (direct child) so we
    // don't accidentally click the modal wrapper that also *contains* the
    // text as a descendant.
    await clickWhenReady(
        driver,
        By.xpath("//div[./span[normalize-space()='Log Dispute For 1 Shipment']]"),
        "'Log Dispute For 1 Shipment' tile"
    );

    console.log("⏳ Waiting for dispute form page to load...");
    await waitFor(
        driver,
        "AWB input on dispute form",
        until.elementLocated(By.css('input[name="awbnumber"]'))
    );
    await sleep(1500);
}

async function enterAwbAndGo(driver, awbNumber) {
    if (!awbNumber) throw new Error("Missing awbNumber");
    await typeIntoInput(
        driver,
        By.css('input[name="awbnumber"]'),
        awbNumber,
        `AWB input (${awbNumber})`,
        { slow: true }
    );
    await sleep(500);
    await clickWhenReady(
        driver,
        By.xpath("//button[normalize-space()='GO']"),
        "'GO' button"
    );

    console.log("⏳ Waiting for the dispute form body to render...");
    await waitFor(
        driver,
        "Dispute Reason dropdown",
        until.elementLocated(By.id("disputeReason"))
    );
    await sleep(1500);
}

// MUI renders its listbox in a portal at the end of <body>, not inside the
// original combobox. Open by clicking the combobox, then pick the option by
// visible text inside the corresponding role="listbox".
async function selectMuiOption(driver, comboboxId, value, label) {
    console.log(`📂 Selecting ${label}: ${value}`);
    await clickWhenReady(
        driver,
        By.css(`#${comboboxId}[role="combobox"]`),
        `${label} combobox`
    );
    // First try match by data-value; fall back to visible text so payloads
    // that ship the option label (e.g. "Wrong Product") still work when the
    // BE hasn't translated it to the portal's internal key.
    const byDataValue = By.css(
        `ul[role="listbox"][aria-labelledby="${comboboxId}"] li[data-value="${value}"]`,
    );
    const byText = By.xpath(
        `//ul[@role='listbox' and @aria-labelledby='${comboboxId}']//li[normalize-space()=${JSON.stringify(value)}]`,
    );
    try {
        await clickWhenReady(driver, byDataValue, `${label} option (data-value='${value}')`);
    } catch (_) {
        await clickWhenReady(driver, byText, `${label} option (text='${value}')`);
    }
    await sleep(500);
}

// ---------------------------
// 📤 File-upload slot helpers (image_1..4, UnboxingVideoProof1, PackagingVideoProof1)
// ---------------------------
async function removeSlotIfFilled(driver, slotKey) {
    const crossLocator = By.css(`.cross-icon[data-field-type="${slotKey}"]`);
    const existing = await driver.findElements(crossLocator);
    if (existing.length === 0) {
        return false;
    }
    console.log(`    🗑  Removing existing file in slot: ${slotKey}`);
    await driver.executeScript("arguments[0].scrollIntoView({block:'center'});", existing[0]);
    await sleep(200);
    try { await existing[0].click(); }
    catch (_) { await driver.executeScript("arguments[0].click();", existing[0]); }
    await sleep(800);
    return true;
}

async function openUploadModalForSlot(driver, slotKey) {
    console.log(`    📤 Opening upload modal for slot: ${slotKey}`);
    await clickWhenReady(
        driver,
        By.css(`[data-testid="actions"][title="${slotKey}"]`),
        `${slotKey} upload trigger`
    );
    await waitFor(
        driver,
        `${slotKey} upload modal`,
        until.elementLocated(By.css('[data-testid="dialog-content-area"]'))
    );
    await sleep(500);
}

async function uploadFileInModal(driver, filePath, slotKey) {
    if (!filePath) throw new Error(`${slotKey}: missing file path`);
    if (!fs.existsSync(filePath)) throw new Error(`${slotKey}: file not found -> ${filePath}`);

    const fileInput = await waitFor(
        driver,
        `${slotKey} file input`,
        until.elementLocated(By.css('[data-testid="file-upload-input-field"]'))
    );
    await fileInput.sendKeys(filePath);

    // react-dropzone ignores plain 'change' events on the hidden input; it
    // registers its onDrop via a drop listener on the surrounding dropzone
    // container. Synthesize a proper drop event using the File we just put
    // into input.files.
    await driver.executeScript(
        `
        const input = arguments[0];
        const dropzone = input.closest('[data-testid="upload-input-area"]') ||
                         input.parentElement;
        if (!input.files || input.files.length === 0) return 'no-file';
        const dt = new DataTransfer();
        dt.items.add(input.files[0]);
        for (const type of ['dragenter', 'dragover', 'drop']) {
            dropzone.dispatchEvent(new DragEvent(type, {
                bubbles: true, cancelable: true, dataTransfer: dt,
            }));
        }
        input.dispatchEvent(new Event('change', { bubbles: true }));
        return 'ok';
        `,
        fileInput,
    );

    const fname = path.basename(filePath);
    await driver.wait(async () => {
        const items = await driver.findElements(
            By.xpath(`//div[@data-testid='uploaded-list']//li[contains(., ${JSON.stringify(fname)})]`),
        );
        return items.length > 0;
    }, 10000, `UPLOAD_FAILED: ${fname} not uploaded — ${slotKey} upload list never showed it`);
    await sleep(500);

    await clickWhenReady(
        driver,
        By.xpath("//div[@data-testid='dialog-content-area']//button[normalize-space()='Upload']"),
        `${slotKey} 'Upload' commit button`,
    );

    await driver.wait(async () => {
        const els = await driver.findElements(By.css('[data-testid="dialog-content-area"]'));
        return els.length === 0;
    }, 15000, `UPLOAD_FAILED: ${fname} not uploaded — ${slotKey} modal did not close after Upload`);
    console.log(`    ✅ Slot ${slotKey} uploaded`);
    await sleep(800);
}

async function replaceSlotWithFile(driver, slotKey, filePath, humanLabel) {
    console.log(`\n📎 Slot: ${slotKey}${humanLabel ? ` (${humanLabel})` : ""}`);
    await removeSlotIfFilled(driver, slotKey);
    await openUploadModalForSlot(driver, slotKey);
    await uploadFileInModal(driver, filePath, slotKey);
}

async function uploadPackagePhotos(driver, packagePhotos) {
    // Positional mapping — the DOM uses image_1..image_4 with visible labels
    // Top/Bottom/Left/Right in that order (portal renders them in that order,
    // even though our config keys are Top/Right/Bottom/Left).
    const SLOT_ORDER = [
        ["image_1", "Top", packagePhotos.Top],
        ["image_2", "Bottom", packagePhotos.Bottom],
        ["image_3", "Left", packagePhotos.Left],
        ["image_4", "Right", packagePhotos.Right],
    ];
    for (const [slotKey, label, filePath] of SLOT_ORDER) {
        if (!filePath) { console.log(`\n(skipping ${label} — no file provided)`); continue; }
        await replaceSlotWithFile(driver, slotKey, filePath, label);
    }
}

// ---------------------------
// 🚦 Submit state + click
// ---------------------------
async function reportSubmitState(driver, tempPath) {
    console.log("\n🚦 Checking Submit button state...");
    try {
        const shot = path.join(tempPath, `xbees_final_state_${Date.now()}.png`);
        const b64 = await driver.takeScreenshot();
        fs.writeFileSync(shot, b64, "base64");
        console.log(`    📸 Final-state screenshot: ${shot}`);
    } catch (_) { /* noop */ }

    const submitEls = await driver.findElements(
        By.xpath("//button[normalize-space()='Submit']"),
    );
    if (submitEls.length === 0) return { isActive: false };
    const btn = submitEls[0];
    const disabled = await btn.getAttribute("disabled");
    const ariaDisabled = await btn.getAttribute("aria-disabled");
    const isActive = disabled === null && ariaDisabled !== "true";
    return { isActive, btn };
}

// Reads the topmost *visible* MUI alert the portal renders after an action
// (`<div class="MuiAlert-message ...">…</div>`). XBees uses the same widget for
// both outcomes, so severity comes from the alert root's class
// (`MuiAlert-standardError` / `-filledError` / `-colorError`); portal rejections
// that slip through with a neutral severity are caught by their wording
// ("Invalid! Shipment can not be mark as dispute after 216 hours").
// Returns { text, isError } or null when no alert is on screen.
async function readPortalAlert(driver) {
    const alert = await driver
        .executeScript(
            `
            // .MuiAlert-message first (the snackbar XBees uses for verdicts),
            // then any other live region, so an inline validation message still
            // gets picked up when no snackbar renders.
            const groups = [
                document.querySelectorAll('.MuiAlert-message'),
                document.querySelectorAll('[role="alert"]'),
            ];
            for (const group of groups) {
                for (const n of Array.from(group)) {
                    const rect = n.getBoundingClientRect();
                    if (rect.width === 0 || rect.height === 0) continue;
                    const text = (n.innerText || n.textContent || '').replace(/\\s+/g, ' ').trim();
                    if (!text) continue;
                    const root = n.closest('.MuiAlert-root') || n.parentElement;
                    const cls = String((root && root.className) || '') + ' ' + String(n.className || '');
                    return { text, severityError: /error/i.test(cls) };
                }
            }
            return null;
            `,
        )
        .catch(() => null);
    if (!alert || !alert.text) return null;

    const isError =
        alert.severityError ||
        /^invalid\b/i.test(alert.text) ||
        /\bcan\s?not\b|\bcannot\b|\bnot allowed\b|\bnot valid\b|\bfailed\b|\brequired\b/i.test(alert.text);
    return { text: alert.text, isError };
}

// Polls for an alert rather than sampling once: XBees' snackbar can render a
// second or two after the POST resolves and auto-hides a few seconds later, so
// a single read at a fixed offset misses it in both directions.
async function waitForPortalAlert(driver, windowMs = 6000, pollMs = 500) {
    const deadline = Date.now() + windowMs;
    while (Date.now() < deadline) {
        const alert = await readPortalAlert(driver);
        if (alert) return alert;
        await sleep(pollMs);
    }
    return null;
}

// The dispute form is still on screen as long as its Submit button is.
async function isSubmitFormOpen(driver) {
    const btns = await driver
        .findElements(By.xpath("//button[normalize-space()='Submit']"))
        .catch(() => []);
    return btns.length > 0;
}

// Clicks Submit up to 3 times and reports what the portal actually did.
//
// XBees answers a rejected dispute with a snackbar instead of an error page —
// e.g. "Invalid! Shipment can not be mark as dispute after 216 hours" — and
// leaves the form exactly where it was. Clicking once and sleeping meant the
// run treated "nothing happened" as submitted, limped into the ticket lookup,
// timed out on a search input the open modal was covering, and reported that
// timeout (or "Ticket id not captured after submit") instead of the real
// reason.
//
// Rules:
//   • the form closing is the ONLY proof the dispute went through;
//   • while it stays open we keep clicking (up to MAX_ATTEMPTS) — some
//     rejections are transient validation blips that clear on a retry;
//   • an error snackbar with the form still open is final: its own sentence is
//     thrown verbatim, tagged `portalNotice`, and nothing else is reported.
//
// Returns { accepted, alertText } when it doesn't throw. `accepted:false` with
// no alert means the form never closed and the portal said nothing — the caller
// decides that one after the ticket lookup, since a silent success can only be
// confirmed by the dispute row appearing.
async function clickSubmit(driver) {
    // DESABLE_SAVE=true → no click, so the dispute form is never accepted.
    assertClaimSubmitEnabled("Xbees", "'Submit' click");

    const MAX_ATTEMPTS = 3;
    let lastAlertText = null;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        if (!(await isSubmitFormOpen(driver))) {
            // The form unmounted — an earlier click already went through.
            console.log("    ✅ Submit form closed (dispute accepted)");
            await sleep(4000);
            return { accepted: true, alertText: lastAlertText };
        }

        const btn = await driver.findElement(By.xpath("//button[normalize-space()='Submit']"));
        await driver.executeScript("arguments[0].scrollIntoView({block:'center'});", btn);
        await sleep(300);
        try { await btn.click(); }
        catch (_) { await driver.executeScript("arguments[0].click();", btn); }
        console.log(`    ✅ Submit clicked (attempt ${attempt}/${MAX_ATTEMPTS})`);

        const alert = await waitForPortalAlert(driver, 6000);
        if (alert) {
            lastAlertText = alert.text;
            console.log(`    ${alert.isError ? "⛔ Portal rejected the submit" : "ℹ️  Portal alert"}: ${alert.text}`);
        }

        // Form gone → accepted, regardless of what the snackbar said.
        if (!(await isSubmitFormOpen(driver))) {
            console.log("    ✅ Submit accepted (form closed)");
            await sleep(4000);
            return { accepted: true, alertText: lastAlertText };
        }

        // Form still open + an error snackbar → the portal refused this claim.
        // Retrying past this point only re-triggers the same message.
        if (alert && alert.isError && attempt >= MAX_ATTEMPTS) break;

        if (attempt < MAX_ATTEMPTS) {
            console.log("    ↩️ Form still open — clicking Submit again...");
            await sleep(2000);
        }
    }

    if (lastAlertText) {
        // The portal's own sentence is the whole reason — surface only that.
        const err = new Error(lastAlertText);
        err.portalNotice = true;
        throw err;
    }

    console.log(`    ⚠️  Submit form still open after ${MAX_ATTEMPTS} clicks and no portal message`);
    return { accepted: false, alertText: null };
}

// ---------------------------
// 🎫 Ticket lookup — XBees exposes no numeric ticket id on the list, so we
// synthesize "Claim Raise On <raised-date>" from the top row's td[value="2"].
// ---------------------------
async function getXbeesTicketId(driver, awbNumber) {
    if (!awbNumber) throw new Error("Missing awbNumber for ticket lookup");
    console.log(`\n🎫 Looking up ticket for AWB ${awbNumber}`);

    // Try browser back first — cheapest path when submit landed on a
    // confirmation view. If that lands somewhere unexpected, force /dispute.
    // await driver.navigate().back();
    await sleep(4000);
    let currentUrl = await driver.getCurrentUrl();
    if (!currentUrl.includes("/dispute")) {
        console.log(`    (back landed at ${currentUrl} — forcing navigation to /dispute)`);
        await driver.get("https://clientportal.xbees.in/dispute");
        await sleep(4000);
    }

    await typeIntoInput(
        driver,
        By.css('input[placeholder="Search AWB Number"]'),
        awbNumber,
        `AWB search input (${awbNumber})`,
        { slow: true },
    );
    await sleep(400);
    const searchInput = await driver.findElement(
        By.css('input[placeholder="Search AWB Number"]'),
    );
    await searchInput.sendKeys(Key.ENTER);
    await sleep(500);

    await clickWhenReady(
        driver,
        By.xpath("//button[normalize-space()='Apply']"),
        "'Apply' filter button",
    );

    console.log("⏳ Waiting for the dispute row to render...");
    const DEADLINE = Date.now() + 20000;
    let raisedDate = null;
    while (Date.now() < DEADLINE) {
        raisedDate = await driver.executeScript(
            `
            const row = document.querySelector('table[aria-label="xbrcl-table"] tbody tr');
            if (!row) return null;
            const cell = row.querySelector('td[value="2"]');
            if (!cell) return null;
            const t = (cell.textContent || '').trim();
            return t.length > 0 ? t : null;
            `,
        );
        if (raisedDate) break;
        await sleep(1000);
    }
    if (!raisedDate) {
        throw new Error(
            `TICKET_LOOKUP_FAILED: no dispute row found for AWB ${awbNumber} within 20s`,
        );
    }
    const ticketId = `Claim Raise On ${raisedDate}`;
    console.log(`    🎫 Ticket: ${ticketId}`);
    return ticketId;
}

module.exports = {
    buildDriver,
    downloadFile,
    xbeesLogin,
    goToDisputePage,
    openRaiseDisputeModal,
    enterAwbAndGo,
    selectMuiOption,
    typeIntoInput,
    replaceSlotWithFile,
    uploadPackagePhotos,
    reportSubmitState,
    clickSubmit,
    getXbeesTicketId,
};
