// -----------------------------------------------------------------------------
// Myntra master-data shared Selenium helpers (request + download phases).
// Extracted from the static scriptNew.js / scriptDownload.js so both phases
// can reuse the same login, navigation, dropdown, and date-picker primitives.
// -----------------------------------------------------------------------------

const fs = require("fs");
const fsp = require("fs").promises;
const { Builder, By, until, Key } = require("selenium-webdriver");
const chrome = require("selenium-webdriver/chrome");
const {
    isProxyEnabled,
    isProxyAccount,
    buildProxyCredentials,
    createLocalAuthProxy,
    closeLocalAuthProxy,
    getNextProxySession,
    rotateProxySession,
    recordSessionIp,
} = require("../../common/proxyConfig");
const {
    probeCredentialErrorBanner,
    isCredentialErrorBanner,
    invalidCredentialsError,
    isInvalidCredentialsError,
} = require("../../common/loginErrors");

// OS-level mouse click on an element — robotjs through common/osInput, with
// the element-to-screen arithmetic calibrated and hover-verified. See it.
const { osClickElement } = require("../../common/osClickElement.js");
const { resolveHeadless } = require("../../../../common/headless");
const { realChromeBinaryPath, NO_REAL_CHROME_WARNING } = require("../../common/chromeBinary.js");

const WAIT_TIMEOUT = 20000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));


// -----------------------------------------------------------------------------
// In-page fetch/XHR capture around the LOG IN click
// -----------------------------------------------------------------------------
// "Network Error" is Akamai's fallback banner when the auth POST is rejected
// (HTTP/2 RST, 4xx, or timeout). Without capturing the actual response we
// can't tell WHY — is it wrong click coords (no POST at all), Akamai reject
// (400/403), proxy issue (timeout), or something else. This monkey-patches
// fetch() and XMLHttpRequest on the page so every request/response between
// arm and drain gets logged into `window.__mvAuthEvents`, which we then read
// out via executeScript.
async function armAuthCapture(driver) {
    try {
        await driver.executeScript(function () {
            if (window.__mvAuthCaptureArmed) {
                window.__mvAuthEvents = [];
                return;
            }
            window.__mvAuthCaptureArmed = true;
            window.__mvAuthEvents = [];
            var push = function (ev) {
                try { window.__mvAuthEvents.push(ev); } catch (_) { /* noop */ }
            };
            var origFetch = window.fetch && window.fetch.bind(window);
            if (origFetch) {
                window.fetch = function (input, init) {
                    var url = typeof input === "string" ? input : (input && input.url) || "";
                    var method = (init && init.method) || (typeof input === "object" && input && input.method) || "GET";
                    var start = Date.now();
                    return origFetch(input, init).then(function (res) {
                        var bodyPreview = "";
                        try {
                            var clone = res.clone();
                            return clone.text().then(function (t) {
                                bodyPreview = (t || "").slice(0, 300);
                                push({
                                    type: "fetch", method: method, url: url,
                                    status: res.status, statusText: res.statusText,
                                    duration: Date.now() - start,
                                    bodyPreview: bodyPreview,
                                    ts: new Date().toISOString(),
                                });
                                return res;
                            }, function () {
                                push({
                                    type: "fetch", method: method, url: url,
                                    status: res.status, statusText: res.statusText,
                                    duration: Date.now() - start,
                                    ts: new Date().toISOString(),
                                });
                                return res;
                            });
                        } catch (_) {
                            push({
                                type: "fetch", method: method, url: url,
                                status: res.status, statusText: res.statusText,
                                duration: Date.now() - start,
                                ts: new Date().toISOString(),
                            });
                            return res;
                        }
                    }, function (err) {
                        push({
                            type: "fetch", method: method, url: url,
                            error: (err && err.message) || String(err),
                            duration: Date.now() - start,
                            ts: new Date().toISOString(),
                        });
                        throw err;
                    });
                };
            }
            var proto = XMLHttpRequest.prototype;
            var origOpen = proto.open;
            var origSend = proto.send;
            proto.open = function (method, url) {
                this.__mvMethod = method;
                this.__mvUrl = url;
                this.__mvStart = Date.now();
                return origOpen.apply(this, arguments);
            };
            proto.send = function () {
                var self = this;
                try {
                    self.addEventListener("loadend", function () {
                        push({
                            type: "xhr",
                            method: self.__mvMethod,
                            url: self.__mvUrl,
                            status: self.status,
                            statusText: self.statusText,
                            duration: Date.now() - (self.__mvStart || Date.now()),
                            bodyPreview: (typeof self.responseText === "string" ? self.responseText : "").slice(0, 300),
                            ts: new Date().toISOString(),
                        });
                    });
                    self.addEventListener("error", function () {
                        push({
                            type: "xhr",
                            method: self.__mvMethod,
                            url: self.__mvUrl,
                            error: "xhr network error event",
                            duration: Date.now() - (self.__mvStart || Date.now()),
                            ts: new Date().toISOString(),
                        });
                    });
                } catch (_) { /* noop */ }
                return origSend.apply(this, arguments);
            };
        });
    } catch (err) {
        console.warn(`⚠️ Could not arm auth capture: ${err.message}`);
    }
}

async function drainAuthCapture(driver) {
    try {
        const events = await driver.executeScript(function () {
            var arr = window.__mvAuthEvents || [];
            window.__mvAuthEvents = [];
            return arr;
        });
        return Array.isArray(events) ? events : [];
    } catch (_) {
        return [];
    }
}

function logAuthEvents(events, label) {
    if (!events || !events.length) {
        console.log(`📡 [${label}] No fetch/XHR captured — click likely never triggered a network request`);
        return;
    }
    console.log(`📡 [${label}] Captured ${events.length} network events during LOG IN click:`);
    events.forEach((ev, i) => {
        const head = `  [${i + 1}] ${ev.type.toUpperCase()} ${ev.method || ""} ${ev.url || ""}`;
        console.log(head);
        console.log(`      ts=${ev.ts} duration=${ev.duration}ms`);
        if (ev.error) {
            console.log(`      ❌ ERROR: ${ev.error}`);
        } else {
            console.log(`      status=${ev.status} ${ev.statusText || ""}`);
        }
        if (ev.bodyPreview) {
            console.log(`      body: ${String(ev.bodyPreview).replace(/\s+/g, " ").slice(0, 300)}`);
        }
    });
}

async function waitFor(driver, label, condition, timeout = WAIT_TIMEOUT) {
    try {
        return await driver.wait(condition, timeout);
    } catch (err) {
        if (err && err.name === "TimeoutError") {
            const e = new Error(
                `Failed at step: ${label} (element not found within ${timeout}ms)`
            );
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

    const MAX_TRIES = 4;
    for (let attempt = 1; attempt <= MAX_TRIES; attempt++) {
        try {
            await el.click();
            console.log(`    ✅ Clicked: ${label}`);
            return el;
        } catch (err) {
            const intercepted = err && err.name === "ElementClickInterceptedError";
            if (!intercepted || attempt === MAX_TRIES) {
                if (intercepted) {
                    console.log(`    ⚠️  Click intercepted ${attempt}/${MAX_TRIES}, JS click fallback`);
                    await driver.executeScript("arguments[0].click();", el);
                    return el;
                }
                throw err;
            }
            console.log(`    ⏳ Click intercepted ${attempt}/${MAX_TRIES}, waiting...`);
            await sleep(800);
        }
    }
    return el;
}

async function hoverElement(driver, locator, label) {
    console.log(`🖱️  Hovering: ${label}`);
    const el = await waitFor(driver, label, until.elementLocated(locator));
    await waitFor(driver, `${label} (visible)`, until.elementIsVisible(el));
    await driver.executeScript("arguments[0].scrollIntoView({block:'center'});", el);
    await sleep(200);
    await driver.actions({ async: true }).move({ origin: el }).perform();
}

async function typeWhenReady(driver, locator, value, label, { perCharMs = 120 } = {}) {
    console.log(`⌨️  Typing: ${label}`);
    const el = await waitFor(driver, label, until.elementLocated(locator));
    await waitFor(driver, `${label} (visible)`, until.elementIsVisible(el));
    await driver.executeScript("arguments[0].scrollIntoView({block:'center'});", el);
    await sleep(200);

    try {
        await el.click();
    } catch (_) {
        await driver.executeScript("arguments[0].focus();", el);
    }
    await el.sendKeys(Key.chord(Key.COMMAND, "a"));
    await el.sendKeys(Key.BACK_SPACE);
    await el.sendKeys(Key.chord(Key.CONTROL, "a"));
    await el.sendKeys(Key.BACK_SPACE);

    if (perCharMs > 0) {
        for (const ch of String(value)) {
            await el.sendKeys(ch);
            await sleep(perCharMs);
        }
    } else {
        await el.sendKeys(value);
    }
}

// ---------------------------
// 🌐 Browser launcher (download path optional)
// ---------------------------
// Mirrors myntraAutoClaim/utils.js::buildDriver so both flows share the same
// flags / preferences. Only difference: optional `downloadDir` to route
// downloads into a known folder for the Phase 2 worker.
// `headless` defaults to what the ENVIRONMENT says, not to a hard-coded value.
//
// It was `headless = true` here and `headless = false` in buildDriverAndLogin
// below — two different hard-coded answers in one file, and neither consulted
// HEADLESS at all. So the desktop app's "browser visible" setting did nothing
// on this path while it worked everywhere else.
//
// `requiresDisplay` is the real reason this login ends up headed: Myntra's
// sign-in is completed by an OS-level click at screen coordinates, which needs
// a real window. Saying that in one line is the point of resolveHeadless —
// the claim-side utils already does it, and now this agrees with it.
async function buildDriver({ headless = null, downloadDir = null, sessionId = null, accountEmail = null } = {}) {
    const options = new chrome.Options();
    const runHeadless =
        typeof headless === "boolean"
            ? headless
            : resolveHeadless({ requiresDisplay: true, platform: "myntra", label: "Myntra master-import sign-in" });

    if (runHeadless) options.addArguments("--headless=new");

    options.addArguments(
        "--window-size=1920,1080",
        "--disable-blink-features=AutomationControlled",
        "--no-sandbox",
        "--disable-dev-shm-usage"
    );
    options.excludeSwitches("enable-automation");
    options.setUserPreferences({
        credentials_enable_service: false,
        "profile.password_manager_enabled": false,
        ...(downloadDir
            ? {
                "download.default_directory": downloadDir,
                "download.prompt_for_download": false,
                "download.directory_upgrade": true,
                "safebrowsing.enabled": true,
            }
            : {}),
    });

    // Local relay approach: spin up an anonymous proxy on 127.0.0.1 that
    // authenticates upstream to Bright Data. Chrome connects to it via
    // --proxy-server with no auth, sidestepping Chrome 130+ MV3 extension
    // restrictions that silently dropped chrome.proxy.settings.
    let localProxyUrl = null;
    let proxyMeta = null;
    if (sessionId && isProxyEnabled()) {
        const creds = buildProxyCredentials(sessionId, accountEmail);
        localProxyUrl = await createLocalAuthProxy(creds);
        const localHostPort = localProxyUrl.replace(/^https?:\/\//, "");
        options.addArguments(`--proxy-server=http://${localHostPort}`);
        proxyMeta = { host: creds.host, port: creds.port, username: creds.username, sessionId };
        console.log("🚀 Launching browser with Bright Data proxy (local relay)");
        console.log(`🔑 Session: ${sessionId}`);
        console.log(`   Upstream: ${creds.host}:${creds.port}`);
        console.log(`   Local:    ${localProxyUrl}`);
    } else if (sessionId) {
        console.log(`ℹ️  PROXY_MODE=none — sessionId "${sessionId}" ignored, launching direct browser`);
    }

    /*
     * THE SAME BROWSER THE CLAIM SIGN-IN USES — see ../../common/chromeBinary.
     *
     * This was one branch: Linux, in production only. So a master import from
     * the desktop app (Windows) or a mac dev machine launched whatever
     * selenium-manager found, which is the pinned Chrome for Testing when a
     * consumer has provisioned one — the browser Akamai answers with "Network
     * Error" on this very portal. Same login, same edge, so the same rule.
     */
    const realChrome = realChromeBinaryPath();

    if (!realChrome) console.warn(NO_REAL_CHROME_WARNING);
    else {
        options.setChromeBinaryPath(realChrome);
        console.log(`🌐 [myntra] Signing in with ${realChrome}`);
    }

    const driver = await new Builder()
        .forBrowser("chrome")
        .setChromeOptions(options)
        .build();

    await driver.manage().setTimeouts({ implicit: 0, pageLoad: 60000 });
    // Pin outer window to screen origin so robotjs coord computation is
    // reproducible across runs. macOS forces y under the menu bar (~25px);
    // osClickElement reads window.screenX/Y at runtime so the
    // menu-bar offset gets absorbed automatically.
    await driver.manage().window().setRect({ x: 0, y: 0, width: 1920, height: 1080 });

    driver._localProxyUrl = localProxyUrl;
    driver._proxyMeta = proxyMeta;
    return driver;
}

// Quit + tear down the per-driver local relay. Skipping the close would leak
// an open listener on 127.0.0.1 (and the credentials live inside it).
async function destroyDriver(driver) {
    if (!driver) return;
    try { await driver.quit(); } catch (_) { /* noop */ }
    if (driver._localProxyUrl) {
        await closeLocalAuthProxy(driver._localProxyUrl);
    }
}

// Configure Chrome's download folder via CDP AFTER login, so the launch-time
// Chrome preferences (and therefore the browser fingerprint seen by Akamai)
// are identical between the request phase and the download phase.
//
// Using Browser.setDownloadBehavior instead of setting
// download.default_directory at buildDriver() time means we no longer pass
// extra Chrome prefs that can alter the fingerprint during the login flow.
//
// Must be called with a fully-initialised driver (post-login is fine — CDP
// commands are independent of page state).
async function setDownloadDir(driver, downloadDir) {
    if (!driver || !downloadDir) return;
    try {
        await driver.sendDevToolsCommand("Browser.setDownloadBehavior", {
            behavior: "allow",
            downloadPath: downloadDir,
        });
        console.log(`📂 Download directory set via CDP: ${downloadDir}`);
    } catch (err) {
        // Non-fatal: log and continue. The download will still land in the
        // default Chrome temp directory; the caller's waitForDownloadComplete
        // will just not find it in tempFiles/ and will time out.
        console.warn(`⚠️ setDownloadDir (CDP) failed: ${err.message}`);
        throw err; // re-throw so the caller can decide whether to abort
    }
}

// Visit ipify and log the egress IP — sanity-check that the proxy is active
// and that session rotation actually swapped the exit IP.
async function getCurrentIp(driver, label) {
    try {
        await driver.get("https://api.ipify.org?format=json");
        await sleep(800);
        const body = await driver.executeScript("return document.body && document.body.innerText;");
        const match = body && String(body).match(/"ip"\s*:\s*"([^"]+)"/);
        const ip = match ? match[1] : null;
        const tag = label ? ` [${label}]` : "";
        if (ip) console.log(`🌍 Current script IP${tag}: ${ip}`);
        else console.log(`🌍 Current script IP${tag}: unknown (body=${String(body || "").slice(0, 120)})`);
        return ip;
    } catch (err) {
        console.warn(`⚠️ Could not fetch current IP: ${err.message}`);
        return null;
    }
}

// Errors that suggest the egress IP is flagged, not a real auth/UI problem.
// Rotate the Bright Data session and try again on these; bubble everything
// else (including INVALID_CREDENTIALS) up unchanged.
const PROXY_RETRYABLE_PATTERNS = [
    /network\s*error/i,
    /ERR_HTTP2_PROTOCOL_ERROR/i,
    /ERR_PROXY/i,
    /ERR_TUNNEL/i,
    /ERR_CONNECTION/i,
    /ERR_TIMED_OUT/i,
    /timed?\s*out/i,
    /element not found within/i,
];

function isProxyRetryableError(err) {
    // A confirmed credential banner is never an IP problem — rotating the
    // session and relaunching Chrome just burns ~40s to fail identically.
    if (isInvalidCredentialsError(err)) return false;
    const msg = err && err.message ? err.message : String(err);
    return PROXY_RETRYABLE_PATTERNS.some((re) => re.test(msg));
}

// One-stop helper: pick a sticky Bright Data session for this account, build
// the driver with the auth-proxy extension, log the egress IP, run myntraLogin.
// On retryable failures it tears the driver down, rotates the session (which
// gets persisted to proxySessions.json), and retries with a fresh browser.
//
// Returns `{ driver, sessionId }`. Caller owns lifecycle from here — call
// `destroyDriver(driver)` when done.
async function buildDriverAndLogin(credentials, {
    accountEmail,
    // null = "ask the environment" (see buildDriver). A caller can still force
    // it either way; nothing else in this file decides it.
    headless = null,
    downloadDir = null,
    maxAttempts = 2,
    postLogin = true,
    postLoginOptions = {},
} = {}) {
    const accountKey = accountEmail || (credentials && credentials.username) || null;
    // Only mapped accounts (proxyAccounts.js) go through Bright Data. Anything
    // else runs direct on the host IP even when PROXY_MODE is enabled globally.
    const useProxy = isProxyEnabled() && isProxyAccount(accountKey);
    let sessionId = useProxy ? getNextProxySession(accountKey) : null;
    console.log(`🔐 buildDriverAndLogin for ${accountKey} (session=${sessionId || "none"})`);

    let driver = null;
    let lastErr = null;
    let loggedIn = false;
    // Hoisted so callers that cache the session jar can record which egress IP
    // minted it (see sessionStore).
    let egressIp = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        console.log(
            `\n🔐 Login attempt ${attempt}/${maxAttempts}` +
            `${sessionId ? ` (session=${sessionId})` : " (no proxy)"}`
        );
        try {
            driver = await buildDriver({ headless, downloadDir, sessionId, accountEmail: accountKey });
            // Capture egress IP and persist it against the email so
            // proxySessions.json shows {sessionId, ip, updatedAt} per account.
            // No-op when running without a proxy (sessionId is null).
            const observedIp = await getCurrentIp(
                driver,
                sessionId ? `attempt ${attempt}, session=${sessionId}` : `attempt ${attempt}, no proxy`
            );
            egressIp = observedIp || null;
            if (sessionId && observedIp) {
                recordSessionIp(accountKey, observedIp);
            }
            // Stash the egress IP + account key on the driver so myntraLogin
            // can log which credential + IP is submitting each login click
            // without having to re-hit ipify mid-flow.
            driver._egressIp = observedIp || null;
            driver._accountKey = accountKey;
            await myntraLogin(driver, credentials);
            loggedIn = true;
            break;
        } catch (err) {
            lastErr = err;
            console.warn(`❌ Login attempt ${attempt}/${maxAttempts} failed: ${err.message}`);
            await destroyDriver(driver);
            driver = null;
            if (!isProxyRetryableError(err) || attempt === maxAttempts) break;
            if (sessionId) {
                const previous = sessionId;
                sessionId = rotateProxySession(accountKey);
                console.log(`🔄 Rotating proxy session: ${previous} → ${sessionId}`);
            }
            await sleep(2000 * attempt);
        }
    }

    if (!loggedIn) {
        throw lastErr || new Error("LOGIN_FAILED: exhausted retries");
    }

    // Past the login retry loop — post-login setup runs once, outside it, so a
    // modal hiccup can't rotate the proxy session and relaunch Chrome.
    if (postLogin) {
        try {
            await completePostLogin(driver, credentials, postLoginOptions);
        } catch (err) {
            await destroyDriver(driver);
            throw err;
        }
    }

    return { driver, sessionId, ip: egressIp };
}

// ---------------------------
// 🔑 Myntra login with Network-Error retry
// ---------------------------
async function myntraLogin(driver, credentials) {
    const { username, password } = credentials || {};
    if (!username || !password) {
        throw new Error("LOGIN_FAILED: Missing username or password");
    }
    const url = process.env.MYNTRA_LOGIN_URL || "https://partners.myntrainfo.com/";

    console.log(`🌐 Navigating to Myntra Partner Portal: ${url}`);
    await driver.get(url);
    await sleep(6000);

    const egressIp = driver._egressIp || "unknown";
    const maskedPassword = password ? `${"*".repeat(Math.max(password.length - 2, 0))}${password.slice(-2)}` : "";
    console.log(
        `🖱️  Clicking Homepage 'Login' button | user=${username} | password=${maskedPassword} | ip=${egressIp}`
    );
    await clickWhenReady(
        driver,
        By.xpath("//button[normalize-space()='Login']"),
        "Homepage 'Login' button"
    );
    await sleep(5000);

    await clickWhenReady(
        driver,
        By.xpath("//button[.//div[normalize-space()='Use Email And Password']]"),
        "'Use Email And Password' button"
    );
    await sleep(5000);

    await typeWhenReady(driver, By.id("email"), username, "email");
    await sleep(1500);
    await typeWhenReady(driver, By.id("password"), password, "password");
    await sleep(3000);

    const LOGIN_BTN_XPATH = "//button[normalize-space()='LOG IN']";
    const LOGIN_MAX_RETRIES = 1;
    // MYNTRA_LOGIN_CLICK_X/Y still override the computed position — read by
    // osClickElement itself.
    let redirected = false;
    for (let attempt = 1; attempt <= LOGIN_MAX_RETRIES; attempt++) {
        // Wait for the LOG IN button to be on screen / enabled so we don't
        // fire the OS click before the form is ready, but DO NOT click it
        // via WebDriver — the click itself must come from the OS to bypass
        // Akamai's bot detection (see ../../common/osClickElement).
        const loginBtn = await waitFor(
            driver,
            "LOG IN submit (locate)",
            until.elementLocated(By.xpath(LOGIN_BTN_XPATH))
        );
        await waitFor(driver, "LOG IN submit (visible)", until.elementIsVisible(loginBtn));
        await waitFor(driver, "LOG IN submit (enabled)", until.elementIsEnabled(loginBtn));
        await driver.executeScript("arguments[0].scrollIntoView({block:'center'});", loginBtn);
        await sleep(500);

        // The button's screen position is worked out from the page and
        // checked by hover before clicking — see ../../common/osClickElement.
        // 11 clicks × 500ms gap ≈ 5s of clicking per attempt. Extra clicks
        // spread over the 5s window cover the case where the button is still
        // mounting / animating when the first click fires.
        const CLICK_COUNT = 11;
        const CLICK_GAP_MS = 500;
        console.log(
            `🖱️  Submitting login via OS-level mouse × ${CLICK_COUNT} ` +
            `[attempt ${attempt}/${LOGIN_MAX_RETRIES}] ` +
            `| user=${username} | password=${maskedPassword} | ip=${egressIp}`
        );
        await armAuthCapture(driver);
        await osClickElement(driver, loginBtn, { times: CLICK_COUNT, gapMs: CLICK_GAP_MS });

        const preUrl = await driver.getCurrentUrl();
        const POLL_MS = 500;
        const MAX_WAIT_MS = 12000;
        let outcome = "timeout";
        for (let waited = 0; waited < MAX_WAIT_MS; waited += POLL_MS) {
            await sleep(POLL_MS);
            const currentUrl = await driver.getCurrentUrl();
            if (currentUrl !== preUrl) { outcome = "redirected"; break; }
            const errorEls = await driver.findElements(
                By.xpath("//*[contains(normalize-space(.),'Network Error')]")
            );
            if (errorEls.length > 0) { outcome = "network_error"; break; }
        }

        // Drain fetch/XHR captured between arm and outcome — logs the auth
        // POST's real status/body so we can tell whether "Network Error" was
        // Akamai rejecting (403/400), the proxy hanging (timeout), or the
        // click missing the button entirely (no request at all).
        const authEvents = await drainAuthCapture(driver);
        logAuthEvents(authEvents, `attempt ${attempt}, outcome=${outcome}`);

        if (outcome === "redirected") { redirected = true; break; }
        if (outcome === "network_error") {
            console.warn(`    ⚠️  'Network Error' on attempt ${attempt}/${LOGIN_MAX_RETRIES}`);
            if (attempt === LOGIN_MAX_RETRIES) {
                throw new Error("LOGIN_FAILED: 'Network Error' persisted across all retries");
            }
            await sleep(3000 * attempt);
            continue;
        }
        if (attempt < LOGIN_MAX_RETRIES) {
            await sleep(2000 * attempt);
            continue;
        }
    }

    console.log("⏳ Waiting for post-login redirect to settle...");
    await sleep(8000);
    const postLoginUrl = await driver.getCurrentUrl();
    console.log(`📍 Post-login URL: ${postLoginUrl}`);

    // Late-arriving redirect: the 12s polling window inside the click loop can
    // time out before Myntra finishes redirecting to /Dashboard. Re-check the
    // URL after the settle sleep so we don't trigger a spurious retry that
    // reloads the portal from an already-logged-in dashboard.
    if (!redirected && /\/Dashboard(\b|\/|\?|#)/i.test(postLoginUrl)) {
        console.log("✅ Post-login page detected after settle — login succeeded");
        redirected = true;
    }

    // Only treat the cred as password-changed when Myntra renders its specific
    // "Incorrect email or password." banner (div.global_errorMessage__u64W2).
    // Any other failure mode (form still visible without that banner, slow
    // portal, network, captcha) is reported as a generic "unable to login" so
    // the master-data cron leaves the cred verified instead of unverifying on
    // a transient issue.
    if (!redirected) {
        const errorText = await probeCredentialErrorBanner(driver);
        if (isCredentialErrorBanner(errorText)) {
            throw invalidCredentialsError(errorText);
        }
        throw new Error("LOGIN_FAILED: unable to login (no credential-error banner detected)");
    }

    // Login is DONE here — Myntra accepted the credentials and redirected us
    // off the login form. The "Select Relationship Type" modal is post-login
    // setup, not login, and lives in completePostLogin() so a modal failure is
    // never misread as a bad credential or a flagged proxy IP.
    console.log("✅ Login successful");
    return true;
}

// ---------------------------
// 🧩 Post-login setup (NOT part of login)
// ---------------------------
// Runs after myntraLogin has already succeeded. Dismisses the first-login
// "Select Relationship Type" modal, which is sticky and blocks every nav item
// until a radio + Done are clicked. No-op when the modal isn't shown.
// Uses credentials.partnerType (configBuilder field) or accountType (raw DB field).
//
// `modalBestEffort: true` downgrades a modal failure to a warning — for callers
// that only needed the session cookies and never touch the portal DOM. Mirrors
// the option in myntraAutoClaim/utils.js completePostLogin.
async function completePostLogin(driver, credentials, { modalBestEffort = false } = {}) {
    try {
        return await handleRelationshipTypeModal(
            driver,
            credentials?.partnerType || credentials?.accountType
        );
    } catch (modalErr) {
        if (modalBestEffort) {
            console.warn(
                `⚠️ Relationship-type modal handling failed (best-effort, continuing): ${modalErr.message}`
            );
            return false;
        }
        console.warn(`⚠️ Relationship-type modal handling failed: ${modalErr.message}`);
        throw new Error(`POST_LOGIN_FAILED: ${modalErr.message}`);
    }
}

// Login only — same contract as myntraLogin, with retries on a driver the
// caller already built. Callers that go on to use the portal UI must follow a
// success with completePostLogin(driver, credentials) to clear the
// relationship-type modal; buildDriverAndLogin already does that for you.
async function myntraLoginWithRetry(driver, credentials, maxAttempts = 3) {
    let lastError;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            await myntraLogin(driver, credentials);
            return true;
        } catch (err) {
            lastError = err;
            console.warn(`⚠️ Login attempt ${attempt}/${maxAttempts} failed: ${err.message}`);

            // Before spending another attempt, verify we're not already on a
            // post-login page. myntraLogin's polling window can miss a slow
            // redirect and throw LOGIN_FAILED even though Myntra ultimately
            // landed us on /Dashboard — retrying would then reload the portal
            // from a logged-in session and fail to find login elements.
            try {
                const currentUrl = await driver.getCurrentUrl();
                if (/\/Dashboard(\b|\/|\?|#)/i.test(currentUrl)) {
                    console.log(
                        `✅ Already on post-login page (${currentUrl}) — treating attempt ${attempt} as success`
                    );
                    return true;
                }
            } catch (_) { /* noop */ }

            if (attempt < maxAttempts) {
                await sleep(5000 * attempt);
                try { await driver.get("about:blank"); } catch (_) { /* noop */ }
                await sleep(2000);
            }
        }
    }
    throw lastError || new Error("LOGIN_FAILED: unknown");
}

// ---------------------------
// 🪟 "Select Relationship Type" modal
// ---------------------------
// On first dashboard load Myntra sometimes pops a modal asking the user to
// classify the account as VENDOR (OR/SOR/JIT) or PARTNER_SELLER (FBM/PPMP/
// MDirect) before any nav item becomes usable. The modal is sticky until a
// radio + Done are clicked. Most subsequent logins skip it, so we wait only
// briefly and no-op when it's absent.
const VENDOR_PARTNER_TYPES = new Set(["OR", "SOR", "JIT"]);

async function handleRelationshipTypeModal(driver, partnerType) {
    const normalized = partnerType ? String(partnerType).trim().toUpperCase() : "";
    const radioTestId = VENDOR_PARTNER_TYPES.has(normalized) ? "VENDOR" : "PARTNER_SELLER";

    const MODAL_TITLE_XPATH = "//h1[contains(@class,'u-modal-title') and normalize-space()='Select Relationship Type']";
    let modalPresent = false;
    try {
        await driver.wait(until.elementLocated(By.xpath(MODAL_TITLE_XPATH)), 5000);
        modalPresent = true;
    } catch (_) {
        // No modal — nothing to do.
    }
    if (!modalPresent) {
        console.log("ℹ️ 'Select Relationship Type' modal not shown — continuing");
        return false;
    }

    if (!normalized) {
        // Default to PARTNER_SELLER (FBM/PPMP/MDirect) — the marketplace path
        // covers the majority of accounts, so it's the safer auto-pick when
        // credentials don't declare a partnerType.
        console.warn(
            "⚠️ RELATIONSHIP_MODAL: partnerType missing on credentials — defaulting to PARTNER_SELLER (FBM/PPMP/MDirect)"
        );
    }

    console.log(
        `🪟 'Select Relationship Type' modal detected — picking ${radioTestId} for partnerType=${normalized || "<missing>"}`
    );

    await clickWhenReady(
        driver,
        By.xpath(`//label[.//input[@data-test-id='${radioTestId}']]`),
        `'${radioTestId}' radio`
    );
    await sleep(800);

    await clickWhenReady(
        driver,
        By.xpath(
            "//div[contains(@class,'u-modal-actions')]" +
            "//button[@data-test-id='target' and normalize-space()='Done']"
        ),
        "'Done' button on relationship-type modal"
    );

    try {
        await driver.wait(
            async () => (await driver.findElements(By.xpath(MODAL_TITLE_XPATH))).length === 0,
            8000
        );
    } catch (_) {
        console.warn("⚠️ Modal still visible after clicking Done — proceeding anyway");
    }
    await sleep(2000);
    return true;
}

// ---------------------------
// 🧭 Services → Reports → Operational Reports
// ---------------------------
async function navigateToOperationalReports(driver) {
    await hoverElement(driver, By.id("Services"), "'Services' nav button");
    await sleep(1500);

    const REPORTS_PARENT_XPATH =
        "//*[self::button or self::a or self::li or self::div or self::span]" +
        "[normalize-space(.)='Reports' or normalize-space(text())='Reports']";
    await hoverElement(driver, By.xpath(REPORTS_PARENT_XPATH), "'Reports' parent menu");
    await sleep(1200);

    const OP_REPORTS_XPATHS = [
        "//button[contains(@class,'aui-top-nav-hover-item-direct-link') and normalize-space()='Operational Reports']",
        "//button[normalize-space()='Operational Reports']",
        "//a[normalize-space()='Operational Reports']",
        "//*[normalize-space(text())='Operational Reports']",
    ];

    let lastErr;
    for (const xp of OP_REPORTS_XPATHS) {
        try {
            await clickWhenReady(driver, By.xpath(xp), "'Operational Reports' menu item");
            lastErr = null;
            break;
        } catch (err) {
            lastErr = err;
            await hoverElement(driver, By.id("Services"), "'Services' (re-hover)");
            await sleep(800);
            await hoverElement(driver, By.xpath(REPORTS_PARENT_XPATH), "'Reports' (re-hover)");
            await sleep(800);
        }
    }
    if (lastErr) throw lastErr;

    await driver.actions({ async: true })
        .move({ x: 0, y: 0, origin: "viewport" })
        .perform();
    await sleep(500);

    await sleep(4000);
    console.log(`📍 URL after opening Operational Reports: ${await driver.getCurrentUrl()}`);
}

// ---------------------------
// 📂 UIKit dropdown — select option by visible text
// ---------------------------
async function selectUDropdownOption(driver, fieldLabel, optionText) {
    console.log(`📂 Selecting ${fieldLabel}: ${optionText}`);

    const FIELD_CONTAINER_XPATH =
        `//div[contains(@class,'u-field-container')]` +
        `[.//label[.//span[normalize-space()='${fieldLabel}']]]`;
    const CONTROL_XPATH = FIELD_CONTAINER_XPATH + `//input[@data-test-id='control']`;
    const TRIGGER_XPATH = FIELD_CONTAINER_XPATH + `//div[@data-test-id='trigger']`;

    // Locate the combobox control up front to confirm the field exists; its
    // aria-controls/aria-owns names the <ul> that will hold the options.
    await waitFor(
        driver,
        `${fieldLabel} (combobox)`,
        until.elementLocated(By.xpath(CONTROL_XPATH))
    );

    // Read the listbox id from the LIVE control on every attempt. UIKit can
    // re-mount the Report select (re-assigning uikit-select-N-options) when
    // its options repopulate after Store/Partner Type changes, so an id read
    // once up front can go stale — a known cause of "option not found".
    const readListboxId = async () => {
        const el = await driver.findElement(By.xpath(CONTROL_XPATH));
        return (
            (await el.getAttribute("aria-controls")) ||
            (await el.getAttribute("aria-owns"))
        );
    };

    // The trigger's JS-click fallback (used when a real click is intercepted)
    // doesn't always toggle the UIKit listbox open, so the <li> never renders
    // and we time out. Verify the dropdown genuinely expanded via the same UI
    // element's aria-expanded before hunting for the option.
    const isExpanded = async () => {
        try {
            const el = await driver.findElement(By.xpath(CONTROL_XPATH));
            return (await el.getAttribute("aria-expanded")) === "true";
        } catch (_) {
            return false;
        }
    };

    const clearControl = async () => {
        const el = await driver.findElement(By.xpath(CONTROL_XPATH));
        await el.sendKeys(Key.chord(Key.COMMAND, "a"));
        await el.sendKeys(Key.BACK_SPACE);
        await el.sendKeys(Key.chord(Key.CONTROL, "a"));
        await el.sendKeys(Key.BACK_SPACE);
        return el;
    };

    const OPEN_TRIES = 3;
    let selected = false;
    let lastErr;

    for (let attempt = 1; attempt <= OPEN_TRIES && !selected; attempt++) {
        // 1) Open the dropdown (only if not already open, so we don't toggle a
        //    previously-opened list shut) and confirm it actually expanded.
        if (!(await isExpanded())) {
            try {
                await clickWhenReady(driver, By.xpath(TRIGGER_XPATH), `'${fieldLabel}' dropdown trigger`);
            } catch (err) {
                lastErr = err;
            }
            await sleep(600);
        }
        if (!(await isExpanded())) {
            // Trigger click didn't open it — focus the control and open via
            // keyboard, which UIKit always honours.
            try {
                const ctrl = await driver.findElement(By.xpath(CONTROL_XPATH));
                await driver.executeScript("arguments[0].focus();", ctrl);
                await ctrl.sendKeys(Key.ARROW_DOWN);
                await sleep(600);
            } catch (err) {
                lastErr = err;
            }
        }
        if (!(await isExpanded())) {
            console.log(`    ⚠️  '${fieldLabel}' dropdown did not open (attempt ${attempt}/${OPEN_TRIES})`);
            await sleep(700);
            continue;
        }

        const listboxId = await readListboxId();
        if (!listboxId) {
            lastErr = new Error(`Failed at step: ${fieldLabel} dropdown (aria-controls missing)`);
            await sleep(700);
            continue;
        }

        // 2) Wait for the listbox to actually render options. The Report list
        //    is populated asynchronously after Partner Type is chosen, so it
        //    can be briefly empty even once expanded.
        const ANY_OPTION_XPATH = `//ul[@id='${listboxId}']/li[@role='option']`;
        try {
            await waitFor(
                driver,
                `${fieldLabel} options rendered`,
                until.elementLocated(By.xpath(ANY_OPTION_XPATH)),
                8000
            );
        } catch (err) {
            lastErr = err;
            await sleep(700);
            continue;
        }

        const OPTION_XPATH = `//ul[@id='${listboxId}']/li[@role='option' and normalize-space()='${optionText}']`;

        // 3) Try to grab the option directly; if it isn't rendered yet (long or
        //    virtualized list), filter by typing the text — this is an
        //    autocomplete combobox (aria-autocomplete="both"), so typing
        //    collapses the list down to the match and guarantees the <li> is in
        //    the DOM instead of scrolled out of view.
        let present = await driver.findElements(By.xpath(OPTION_XPATH));
        if (present.length === 0) {
            try {
                await clearControl();
                const ctrl = await driver.findElement(By.xpath(CONTROL_XPATH));
                await ctrl.sendKeys(optionText);
                await sleep(900);
            } catch (typeErr) {
                lastErr = typeErr;
            }
        }

        try {
            const optionEl = await waitFor(
                driver,
                `'${optionText}' option`,
                until.elementLocated(By.xpath(OPTION_XPATH))
            );
            await driver.executeScript("arguments[0].scrollIntoView({block:'center'});", optionEl);
            await sleep(200);
            try {
                await optionEl.click();
            } catch (_) {
                await driver.executeScript("arguments[0].click();", optionEl);
            }
            console.log(`    ✅ Selected '${optionText}' for ${fieldLabel}`);
            selected = true;
        } catch (err) {
            lastErr = err;
            console.log(`    ⚠️  '${optionText}' not selected (attempt ${attempt}/${OPEN_TRIES}) — retrying`);
            await sleep(700);
        }
    }

    if (!selected) {
        throw lastErr || new Error(
            `Failed at step: '${optionText}' option (dropdown never yielded the option)`
        );
    }
    await sleep(500);
}

// ---------------------------
// 📅 Date picker (two-month panel calendar)
// ---------------------------
function dateTitle(d) { return d.toDateString(); }

function formatYMD(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
}

async function setNativeSelect(driver, selectEl, value) {
    await driver.executeScript(
        "arguments[0].value = arguments[1];" +
        "arguments[0].dispatchEvent(new Event('change', { bubbles: true }));",
        selectEl,
        String(value)
    );
}

// Read every currently-rendered, selectable day cell (not disabled, not
// empty) from the open picker and return the latest Date it exposes. Myntra
// disables not just today but the most recent few days (report-data
// settlement lag) plus every future date, so the newest *selectable* cell —
// not "yesterday" — is the real upper bound of the report window. Returns a
// Date or null (picker closed / no enabled cells rendered).
async function getLatestSelectableDate(driver) {
    const titles = await driver.executeScript(() => {
        const cells = document.querySelectorAll(
            ".u-input-date-day:not(.u-input-date-disabled):not(.u-input-date-empty)"
        );
        return Array.from(cells)
            .map((c) => c.getAttribute("title"))
            .filter(Boolean);
    });
    let latest = null;
    for (const t of titles) {
        const d = new Date(t);
        if (Number.isNaN(d.getTime())) continue;
        if (!latest || d > latest) latest = d;
    }
    return latest;
}

async function pickDateInCalendar(driver, targetDate, side) {
    const targetTitle = dateTitle(targetDate);
    console.log(`  - Picking ${targetTitle} (panel ${side})`);

    const PANEL_XPATH = `(//div[contains(@class,'u-input-date-month')])[${side}]`;
    const monthSelect = await driver.findElement(
        By.xpath(PANEL_XPATH + "//div[contains(@class,'u-input-date-select')][1]/select")
    );
    const yearSelect = await driver.findElement(
        By.xpath(PANEL_XPATH + "//div[contains(@class,'u-input-date-select')][2]/select")
    );

    await setNativeSelect(driver, yearSelect, targetDate.getFullYear());
    await sleep(500);
    await setNativeSelect(driver, monthSelect, targetDate.getMonth());
    await sleep(700);

    const dayXpath =
        PANEL_XPATH +
        `//div[contains(@class,'u-input-date-day')` +
        ` and @title='${targetTitle}'` +
        ` and not(contains(@class,'u-input-date-disabled'))` +
        ` and not(contains(@class,'u-input-date-empty'))]`;
    const dayEl = await waitFor(
        driver,
        `day cell ${targetTitle}`,
        until.elementLocated(By.xpath(dayXpath))
    );
    await driver.executeScript("arguments[0].scrollIntoView({block:'center'});", dayEl);
    await sleep(200);
    await dayEl.click();
    await sleep(700);
}

async function fillDateRange(driver, fromDate, toDate) {
    console.log(`📅 Filling Date Range: ${dateTitle(fromDate)} → ${dateTitle(toDate)}`);

    const fromInput = await waitFor(
        driver,
        "Date Range 'from' input",
        until.elementLocated(By.id("from"))
    );
    await driver.executeScript("arguments[0].scrollIntoView({block:'center'});", fromInput);
    await sleep(300);
    await fromInput.click();
    await sleep(900);

    // Clamp the requested window to what the picker actually allows. Myntra
    // disables the most recent few days (data-settlement lag) as well as today
    // and all future dates, so both the requested to-date (today-1) and, in an
    // up-to-date incremental run, the from-date can land on disabled cells that
    // pickDateInCalendar would never find (element-not-found timeout). Pull the
    // newest selectable cell from the open picker and clamp to it.
    const latestSelectable = await getLatestSelectableDate(driver);
    if (latestSelectable) {
        if (toDate > latestSelectable) {
            console.log(
                `  - to-date ${dateTitle(toDate)} is disabled in the picker; ` +
                `clamping to newest selectable ${dateTitle(latestSelectable)}`
            );
            toDate = latestSelectable;
        }
        if (fromDate > toDate) {
            console.log(
                `  - from-date ${dateTitle(fromDate)} is after the to-date; ` +
                `clamping to ${dateTitle(toDate)}`
            );
            fromDate = toDate;
        }
    } else {
        console.log("  - ⚠️  Could not read selectable dates from picker — using requested range as-is");
    }

    await pickDateInCalendar(driver, fromDate, 1);

    const panels = await driver.findElements(
        By.xpath("//div[contains(@class,'u-input-date-month')]")
    );
    if (panels.length < 2) {
        const toInput = await driver.findElement(By.id("to"));
        await toInput.click();
        await sleep(900);
    }

    await pickDateInCalendar(driver, toDate, 2);

    await driver.actions({ async: true }).sendKeys(Key.ESCAPE).perform();
    await sleep(600);

    // Return the dates actually clicked (post-clamp) so the caller verifies the
    // report row against these, not the originally-requested range.
    return { fromDate, toDate };
}

// ---------------------------
// 🚦 Generate Report submit
// ---------------------------
async function clickGenerateReport(driver) {
    await clickWhenReady(
        driver,
        By.xpath(
            "//button[@type='submit' and contains(@class,'u-button-primary')" +
            " and normalize-space()='Generate Report']" +
            " | //button[normalize-space()='Generate Report']"
        ),
        "'Generate Report' button"
    );
    await sleep(4000);
}

// ---------------------------
// 🚨 Detect Myntra's red error banner (rendered when the portal rejects
// the Generate Report request, e.g. "Internal server error while scheduling
// report job. (102008001)"). Returns the banner title text if present,
// otherwise null.
// ---------------------------
async function getMyntraBannerError(driver) {
    const BANNER_XPATH =
        "//div[contains(@class,'u-banner-container') and contains(@class,'u-banner-error')]" +
        "//div[contains(@class,'u-banner-title')]";
    const matches = await driver.findElements(By.xpath(BANNER_XPATH));
    if (matches.length === 0) return null;
    try {
        const text = (await matches[0].getText()).trim();
        return text || null;
    } catch (_) {
        return null;
    }
}

// ---------------------------
// 🔎 Find report row by date range (request-phase verification)
// ---------------------------
// After Generate Report, Myntra inserts a row at the top of the table with:
// 1=Store, 2=Report Name, 3=Partner Type, 4=Date Range, 5=Query Date,
// 6=Status, 7=Download, 8=Expected Finish Time.
// We match on (store, reportName, partnerType, dateRange) and return the
// freshest non-Completed row so we don't mistake an older identical run.
async function findReportRowByDateRange(driver, { store, reportName, partnerType, dateRange }) {
    console.log(
        `🔎 Verifying request row for store=${store}, name=${reportName}, ` +
        `partnerType=${partnerType}, range=${dateRange}`
    );
    await sleep(3000);

    const ROW_XPATH =
        `(//table[contains(@class,'u-table-table')]//tbody/tr[` +
        `td[1][normalize-space()='${store}']` +
        ` and td[2][normalize-space()='${reportName}']` +
        ` and td[3][normalize-space()='${partnerType}']` +
        ` and td[4][normalize-space()='${dateRange}']` +
        ` and not(.//span[contains(@class,'content') and normalize-space()='Completed'])])[1]`;

    let row;
    try {
        row = await waitFor(
            driver,
            `report row (${dateRange})`,
            until.elementLocated(By.xpath(ROW_XPATH))
        );
    } catch (_) {
        // Fallback: any-status row for the same range — in case the report
        // completed instantly.
        const FALLBACK_XPATH =
            `(//table[contains(@class,'u-table-table')]//tbody/tr[` +
            `td[1][normalize-space()='${store}']` +
            ` and td[2][normalize-space()='${reportName}']` +
            ` and td[3][normalize-space()='${partnerType}']` +
            ` and td[4][normalize-space()='${dateRange}']])[1]`;
        const matches = await driver.findElements(By.xpath(FALLBACK_XPATH));
        if (matches.length === 0) return null;
        row = matches[0];
    }

    const cells = await row.findElements(By.xpath("./td"));
    const text = await Promise.all(cells.map((c) => c.getText()));
    return {
        store: text[0],
        reportName: text[1],
        partnerType: text[2],
        dateRange: text[3],
        queryDate: text[4],
        status: text[5],
        expectedFinish: text[7],
    };
}

// ---------------------------
// 📥 Find row + click DOWNLOAD (download-phase)
// ---------------------------
// Same column model as findReportRowByDateRange, but the row MUST be
// status=Completed and we click the DOWNLOAD link. Returns the click target.
async function findAndClickDownload(driver, { store, reportName, partnerType, dateRange }) {
    console.log(
        `📥 Looking for completed row to download: store=${store}, name=${reportName}, ` +
        `partnerType=${partnerType}, range=${dateRange}`
    );
    await sleep(3000);

    const ROW_XPATH =
        `//table[contains(@class,'u-table-table')]//tbody/tr[` +
        `td[1][normalize-space()='${store}']` +
        ` and td[2][normalize-space()='${reportName}']` +
        ` and td[3][normalize-space()='${partnerType}']` +
        ` and td[4][normalize-space()='${dateRange}']` +
        ` and .//span[contains(@class,'content') and normalize-space()='Completed']` +
        `][1]`;

    let row;
    try {
        row = await waitFor(
            driver,
            "matching completed report row",
            until.elementLocated(By.xpath(ROW_XPATH))
        );
    } catch (err) {
        // Diagnostic — surface status of the same-range row (if any) so the
        // worker can choose to retry instead of failing the job permanently.
        const ANY_STATUS_XPATH =
            `//table[contains(@class,'u-table-table')]//tbody/tr[` +
            `td[1][normalize-space()='${store}']` +
            ` and td[2][normalize-space()='${reportName}']` +
            ` and td[3][normalize-space()='${partnerType}']` +
            ` and td[4][normalize-space()='${dateRange}']` +
            `][1]`;
        const anyMatches = await driver.findElements(By.xpath(ANY_STATUS_XPATH));
        if (anyMatches.length > 0) {
            const cells = await anyMatches[0].findElements(By.xpath("./td"));
            const text = await Promise.all(cells.map((c) => c.getText()));
            const status = text[5];
            const expectedFinish = text[7];
            const e = new Error(
                `Report row found but not Completed yet. Status: "${status}". ` +
                `Expected finish: ${expectedFinish}.`
            );
            e.notReadyYet = true;
            e.expectedFinish = expectedFinish;
            throw e;
        }
        throw new Error(
            `No row found for store=${store}, name=${reportName}, ` +
            `partnerType=${partnerType}, range=${dateRange}`
        );
    }

    await driver.executeScript("arguments[0].scrollIntoView({block:'center'});", row);
    await sleep(400);

    const DOWNLOAD_LINK_XPATH = ".//a[.//div[normalize-space()='DOWNLOAD']]";
    const DOWNLOAD_DIV_XPATH = ".//div[normalize-space()='DOWNLOAD']";

    const anchors = await row.findElements(By.xpath(DOWNLOAD_LINK_XPATH));
    if (anchors.length > 0) {
        try {
            await anchors[0].click();
            console.log("    ✅ Clicked DOWNLOAD <a>");
            return true;
        } catch (err) {
            console.log(`    ⚠️  DOWNLOAD <a> click failed (${err.message}), trying inner div`);
        }
    }
    const divs = await row.findElements(By.xpath(DOWNLOAD_DIV_XPATH));
    if (divs.length === 0) {
        throw new Error("DOWNLOAD link missing from matched row");
    }
    await driver.executeScript("arguments[0].click();", divs[0]);
    console.log("    ✅ Clicked DOWNLOAD via inner div (JS click)");
    return true;
}

module.exports = {
    sleep,
    waitFor,
    clickWhenReady,
    hoverElement,
    typeWhenReady,
    formatYMD,
    dateTitle,
    buildDriver,
    destroyDriver,
    setDownloadDir,
    getCurrentIp,
    buildDriverAndLogin,
    myntraLogin,
    myntraLoginWithRetry,
    completePostLogin,
    handleRelationshipTypeModal,
    navigateToOperationalReports,
    selectUDropdownOption,
    fillDateRange,
    clickGenerateReport,
    getMyntraBannerError,
    findReportRowByDateRange,
    findAndClickDownload,
};
