// -----------------------------------------------------------------------------
// Myntra Partner Portal — Auto Claim utilities (Selenium, Node.js)
// -----------------------------------------------------------------------------
// Translated from the puppeteer version in this folder using the locator +
// helper patterns proven in `scriptNew selenium.js`. Shared download helper
// kept (axios-based, framework-agnostic).
//
// Exports a set of step helpers used by scriptNew.js:
//   - buildDriver()                                          (chrome + stealth options)
//   - downloadFile(url, filename, tempPath)                  (remote URL → local file)
//   - myntraLogin(driver, credentials)                       (login flow w/ Network-Error retry)
//   - navigateToCreateClaim(driver)                          (Services → SPF → Create New Claim)
//   - searchAndApplyClaim(driver, orderId)                   (modal search → Apply Claim)
//   - fillClaimForm(driver, formData, tempPath, { resume, saveCtx })  (one claim)
//   - getMyntraTicketId(driver)                              (best-effort ticket capture)
// -----------------------------------------------------------------------------

const path = require("path");
const fs = require("fs-extra");
const axios = require("axios");
const { Builder, By, until, Key } = require("selenium-webdriver");
const chrome = require("selenium-webdriver/chrome");
// Dry-run guard (DESABLE_SAVE) — see claimApiFlow.js.
const { assertClaimSubmitEnabled } = require("@trackvid/automation-core/common/claimSubmitGuard");
// Archive each downloaded proof under the company's resource folder before Selenium
// attaches it and the temp copy is swept. No-ops unless enabled.
const { saveClaimResource } = require("@trackvid/automation-core/common/resourceSaver");
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
const {
    preferExecutablePath,
    chromeExecutablePath,
    chromedriverPath,
    driverPathFor,
    pinnedFallbackIsAllowed,
    chromeServiceFor,
} = require("../../../../common/browserRuntime.js");
const { resolveHeadless } = require("../../../../common/headless.js");
const { track, forget } = require("../../../../common/openBrowsers.js");

// ---------------------------
// ⏱️ Timeouts & small helpers
// ---------------------------
const WAIT_TIMEOUT = 20000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/*
 * WHICH CHROME — see ../../common/chromeBinary.js for why this platform picks
 * its own and what happens when it cannot find one.
 *
 * This used to be three inline branches: CHROME_BINARY_PATH, Linux in
 * production, macOS. WINDOWS WAS NOT AMONG THEM — and Windows is where the
 * desktop app runs — so every operator's Myntra sign-in fell through to the
 * pinned Chrome for Testing and met Akamai's "Network Error". The master-import
 * sign-in had its own, differently-broken copy of the same three branches.
 */
const {
    realChromeBinaryPath,
    realChromeRequiredError,
    NO_REAL_CHROME_WARNING,
} = require("../../common/chromeBinary.js");


// In-page fetch/XHR capture around the LOG IN click. Same design as
// myntraMasterData — arm before click, drain after outcome, log status/body
// so we can distinguish Akamai reject vs proxy timeout vs missed-button.
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
                        try {
                            var clone = res.clone();
                            return clone.text().then(function (t) {
                                push({
                                    type: "fetch", method: method, url: url,
                                    status: res.status, statusText: res.statusText,
                                    duration: Date.now() - start,
                                    bodyPreview: (t || "").slice(0, 300),
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
        console.log(`  [${i + 1}] ${ev.type.toUpperCase()} ${ev.method || ""} ${ev.url || ""}`);
        console.log(`      ts=${ev.ts} duration=${ev.duration}ms`);
        if (ev.error) console.log(`      ❌ ERROR: ${ev.error}`);
        else console.log(`      status=${ev.status} ${ev.statusText || ""}`);
        if (ev.bodyPreview) console.log(`      body: ${String(ev.bodyPreview).replace(/\s+/g, " ").slice(0, 300)}`);
    });
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

// Try each XPath in order and return the first one that finds a non-empty
// match. Useful when an element has multiple equally-valid anchors.
async function findFirstByXpaths(driver, xpaths) {
    for (const xp of xpaths) {
        const matches = await driver.findElements(By.xpath(xp));
        if (matches.length > 0) return { element: matches[0], xpath: xp };
    }
    return null;
}

// Quote an arbitrary string as an XPath 1.0 literal. XPath has no escape
// character, so values containing `'` (e.g. "seller's product") cannot be
// embedded inside single-quoted literals — they produce SyntaxError. When
// both quote types are present we fall back to concat(...).
function xpathLiteral(s) {
    const str = String(s);
    if (!str.includes("'")) return `'${str}'`;
    if (!str.includes('"')) return `"${str}"`;
    const parts = str.split("'");
    return "concat(" + parts.map((p) => `'${p}'`).join(",\"'\",") + ")";
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

async function hoverElement(driver, locator, label) {
    console.log(`🖱️  Hovering: ${label}`);
    const el = await waitFor(driver, label, until.elementLocated(locator));
    await waitFor(driver, `${label} (visible)`, until.elementIsVisible(el));
    await driver.executeScript("arguments[0].scrollIntoView({block:'center'});", el);
    await sleep(200);
    await driver.actions({ async: true }).move({ origin: el }).perform();
    console.log(`    ✅ Hovered: ${label}`);
}

async function typeWhenReady(driver, locator, value, label, { slow = false } = {}) {
    console.log(`⌨️  Waiting for input: ${label}`);
    const el = await waitFor(driver, label, until.elementLocated(locator));
    await waitFor(driver, `${label} (visible)`, until.elementIsVisible(el));
    await driver.executeScript("arguments[0].scrollIntoView({block:'center'});", el);
    await sleep(200);

    const MAX_TRIES = 4;
    let clicked = false;
    for (let attempt = 1; attempt <= MAX_TRIES; attempt++) {
        try {
            await el.click();
            clicked = true;
            break;
        } catch (err) {
            const isIntercepted = err && err.name === "ElementClickInterceptedError";
            if (!isIntercepted) throw err;
            if (attempt === MAX_TRIES) {
                console.log(`    ⚠️  Input click intercepted ${attempt}/${MAX_TRIES}, focusing via JS`);
                await driver.executeScript("arguments[0].focus();", el);
                clicked = true;
                break;
            }
            console.log(`    ⏳ Input click intercepted ${attempt}/${MAX_TRIES}, waiting for overlay to clear...`);
            await sleep(800);
        }
    }
    if (!clicked) await driver.executeScript("arguments[0].focus();", el);

    // Clear any prefilled value (works on mac & linux — selectAll then delete)
    await el.sendKeys(Key.chord(Key.COMMAND, "a"));
    await el.sendKeys(Key.BACK_SPACE);
    await el.sendKeys(Key.chord(Key.CONTROL, "a"));
    await el.sendKeys(Key.BACK_SPACE);

    if (slow) {
        // Per-char send for credential fields where bot detection is sensitive
        // to instant fills.
        for (const ch of String(value)) {
            await el.sendKeys(ch);
            await sleep(120);
        }
    } else {
        await el.sendKeys(value);
    }
    console.log(`    ✅ Entered ${label}`);
}

// ---------------------------
// 📥 Download File Helper (shared pattern)
// ---------------------------
async function downloadFile(url, filename, tempPath) {
    if (!url || !url.startsWith("http")) return url; // Already a local path or empty
    try {
        const response = await axios.get(url, { responseType: "arraybuffer", timeout: 30000 });
        const ext = path.extname(new URL(url).pathname) || ".tmp";
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
// `sessionId` is the Bright Data sticky-session ID. When provided AND
// PROXY_MODE != "none", buildDriver writes an MV3 auth-proxy extension to a
// per-driver temp directory and loads it via --load-extension. The extension
// path is stashed on the driver so destroyDriver() can wipe it.
async function buildDriver({ sessionId, accountEmail } = {}) {
    const options = new chrome.Options();
    // Myntra is the one login that cannot run headless: it is completed by an
    // OS-level mouse click at screen coordinates (see ../../common/osClickElement), and
    // there is no window to click in a headless browser. resolveHeadless says
    // so out loud rather than this file hard-coding false and leaving the next
    // reader to wonder why HEADLESS is ignored here.
    const HEADLESS = resolveHeadless({ requiresDisplay: true, platform: "myntra", label: "Myntra sign-in" });
    if (HEADLESS) options.addArguments("--headless=new");

    options.addArguments(
        "--window-size=1920,1080",
        "--disable-blink-features=AutomationControlled",
        "--no-sandbox",
        "--disable-dev-shm-usage"
    );
    options.excludeSwitches("enable-automation");
    options.setUserPreferences({ credentials_enable_service: false, "profile.password_manager_enabled": false });

    let localProxyUrl = null;
    let proxyMeta = null;
    if (sessionId && isProxyEnabled()) {
        const creds = buildProxyCredentials(sessionId, accountEmail);
        // Spin up a local anonymous proxy that authenticates upstream to Bright
        // Data. Chrome connects to 127.0.0.1:RANDOM with NO auth, and the relay
        // injects the Bright Data credentials before forwarding. This avoids
        // Chrome's MV3 extension restrictions entirely.
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

    // Myntra's OWN choice wins here, unlike every other platform. It resolves
    // the real installed Google Chrome deliberately: Chrome for Testing shows a
    // "only for automated testing" banner and fingerprints differently, and this
    // sign-in has to get past Akamai. A pinned testing build configured by a
    // consumer must not override that. See common/browserRuntime.js.
    const realChrome = realChromeBinaryPath();

    // SAID OUT LOUD, EVERY RUN. Without a real Chrome this sign-in will most
    // likely fail at Akamai, and it will fail wearing a message ("Network
    // Error") that points at the network rather than at the browser. One line
    // here is the difference between a five-minute fix and a day of guessing.
    if (!realChrome) {
        // A consumer that refused the pinned substitute gets the reason now,
        // before a window opens that Akamai is certain to refuse.
        if (!pinnedFallbackIsAllowed()) throw realChromeRequiredError("not-found");

        console.warn(NO_REAL_CHROME_WARNING);
    }

    const chromeBinaryPath = preferExecutablePath(realChrome);
    if (chromeBinaryPath) {
        options.setChromeBinaryPath(chromeBinaryPath);
        console.log(`🌐 [myntra] Signing in with ${chromeBinaryPath}`);
    }

    /*
     * THE DRIVER HAS TO MATCH THE BROWSER, and this browser is not the pinned
     * one. chromedriver matches on MAJOR version, so a consumer's pinned 131
     * driver cannot drive the operator's Chrome 152 — the consumer is asked for
     * a matching one instead (see common/browserRuntime.setDriverProvider).
     *
     * Null means nobody could supply one. Selenium Manager is then given its
     * chance, which is what used to happen here every time; the catch below is
     * for when that fails too.
     */
    const driverBinary = await driverPathFor(chromeBinaryPath);
    const build = async (binary, driverFor) => {
        const chromeOptions = binary ? options.setChromeBinaryPath(binary) : options;
        let builder = new Builder().forBrowser("chrome").setChromeOptions(chromeOptions);
        const service = chromeServiceFor(driverFor);

        if (service) builder = builder.setChromeService(service);

        return builder.build();
    };

    let driver;

    try {
        driver = await build(chromeBinaryPath, driverBinary);
    } catch (err) {
        /*
         * A SIGN-IN THAT CANNOT START IS WORSE THAN ONE THAT MIGHT BE REFUSED.
         *
         * Preferring the real Chrome turned "Akamai says Network Error" into
         * "Unable to obtain browser driver" on machines where no matching
         * driver could be fetched — the first is a login that sometimes works,
         * the second is a button that never does. So the pinned pair, which is
         * exactly what ran before the real Chrome was preferred, is the floor.
         *
         * Only when there is something to fall back TO, and only when the
         * failure is about the driver: a Chrome that crashed on launch will
         * crash the same way twice, and retrying hides it.
         */
        const pinnedChrome = chromeExecutablePath();
        const pinnedDriver = chromedriverPath();
        const driverProblem = /driver|selenium manager|cannot find|not found|ENOENT/i.test(
            String(err && err.message)
        );

        if (!driverProblem || !pinnedDriver || pinnedChrome === chromeBinaryPath) throw err;

        if (!pinnedFallbackIsAllowed()) throw realChromeRequiredError("no-driver", err);

        console.warn(
            `⚠️ [myntra] Could not drive ${chromeBinaryPath} (${err.message}). ` +
            "Falling back to the pinned automation browser — Myntra may refuse it with " +
            "\"Network Error\", so install Google Chrome on this machine if it does."
        );

        driver = await build(pinnedChrome, pinnedDriver);
    }

    await driver.manage().setTimeouts({ implicit: 0, pageLoad: 60000 });
    // Pin outer window to screen origin so osClickElement can
    // derive a stable robotjs target across runs. macOS forces y under the
    // menu bar; window.screenX/Y read at click time absorbs that offset.
    await driver.manage().window().setRect({ x: 0, y: 0, width: 1920, height: 1080 });

    driver._localProxyUrl = localProxyUrl;
    driver._proxyMeta = proxyMeta;

    // Tracked while open — see common/openBrowsers and `destroyDriver` below.
    return track(driver);
}

// Quit the driver and shut down the per-driver local relay started in
// buildDriver. If we don't close the relay, each session leaks an open
// listening socket on 127.0.0.1 (and the credentials live on inside it).
async function destroyDriver(driver) {
    if (!driver) return;

    forget(driver);

    try { await driver.quit(); } catch (_) { /* noop */ }
    if (driver._localProxyUrl) {
        await closeLocalAuthProxy(driver._localProxyUrl);
    }
}

// Visit ipify and log the egress IP. Used both as a sanity-check before login
// (proxy active?) and as a diagnostic after retries (did the session rotate?).
// `label` lets the caller tag the line (e.g. "attempt 2", "after rotation") so
// the log shows clearly which IP the script is *now* running on.
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

// Errors that look like proxy/IP-level flake rather than bad credentials.
// We rotate the session and retry on these; on anything else we surface the
// original error.
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
    // Neither is relaunching when the machine has no Chrome to launch.
    if (err && err.code === "REAL_CHROME_REQUIRED") return false;
    const msg = err && err.message ? err.message : String(err);
    return PROXY_RETRYABLE_PATTERNS.some((re) => re.test(msg));
}

// One-stop: pick a proxy session for this account, build a driver, log the
// egress IP, then run myntraLogin. On retryable failures we tear the driver
// down, rotate the Bright Data session, and try again from scratch.
//
// The retry loop covers LOGIN ONLY. Post-login setup (relationship-type modal
// + dashboard gate) runs once, after the loop, so a modal/nav hiccup can't
// burn a proxy session and relaunch Chrome — it isn't a login problem. Pass
// `postLogin: false` when the caller only needs proof the credentials work
// (e.g. checkMyntraCredentials) and never touches the dashboard, or
// `postLoginOptions` to soften individual steps — see completePostLogin.
//
// Returns `{ driver, sessionId }` — caller owns lifecycle from here.
/**
 * Re-labels a step timeout as what it actually is: Myntra not rendering.
 *
 * Rare, and entirely the portal's doing — the landing page comes back without
 * its login journey on it. Retrying a few minutes later works. Anything that is
 * NOT a step timeout passes through untouched, so a genuine script or driver
 * fault still surfaces as itself rather than being excused as a portal blip.
 */
async function asPortalRenderFailure(step, what) {
    try {
        return await step();
    } catch (err) {
        if (!err || err.name !== "StepTimeoutError") throw err;

        const e = new Error(
            `Myntra did not show its login form — ${what} after waiting. ` +
            `This is a problem on Myntra's side, not with the credential or the automation. Try again in a few minutes.`
        );
        e.code = "LOGIN_FORM_NOT_RENDERED";
        // Kept so the underlying step is still recoverable from a log.
        e.cause = err;
        throw e;
    }
}

async function buildDriverAndLogin(
    credentials,
    { accountEmail, maxAttempts = 2, postLogin = true, postLoginOptions = {} } = {}
) {
    const accountKey = accountEmail || (credentials && credentials.username) || null;
    // Only mapped accounts (proxyAccounts.js) go through Bright Data. Anything
    // else runs direct on the host IP even when PROXY_MODE is enabled globally.
    const useProxy = isProxyEnabled() && isProxyAccount(accountKey);
    let sessionId = useProxy ? getNextProxySession(accountKey) : null;
    console.log("sessionId==============>", sessionId, accountEmail);
    let driver = null;
    let lastErr = null;
    let loggedIn = false;
    // Hoisted so it survives the loop — callers that cache the session jar need
    // to know which egress IP minted it (see sessionStore).
    let egressIp = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        console.log(`\n🔐 Login attempt ${attempt}/${maxAttempts}${sessionId ? ` (session=${sessionId})` : " (no proxy)"}`);
        try {
            driver = await buildDriver({ sessionId, accountEmail: accountKey });
            // Always log egress IP — proves rotation is working in proxy mode,
            // and shows the office IP when running direct. When the proxy is
            // active, persist the IP into proxySessions.json against this
            // email so the file shows {sessionId, ip, updatedAt} per account.
            const ipLabel = sessionId
                ? `attempt ${attempt}, session=${sessionId}`
                : `attempt ${attempt}, no proxy`;
            const observedIp = await getCurrentIp(driver, ipLabel);
            egressIp = observedIp || null;
            if (sessionId && observedIp) {
                recordSessionIp(accountKey, observedIp);
            }
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

    // Past the login retry loop — the credentials are good and the session is
    // established. Post-login setup runs once; if it throws, the driver is torn
    // down and the POST_LOGIN_FAILED error propagates as-is so the caller can
    // see it was never a credential/IP problem.
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
// 🔑 Myntra login
// ---------------------------
// Homepage Login → Use Email And Password → fill email/password slowly →
// LOG IN with retry on transient "Network Error" toast (kept from puppeteer
// version because it's a recurring failure mode on first attempts).
async function myntraLogin(driver, credentials) {
    const { username, password, loginUrl } = credentials || {};
    if (!username || !password) {
        throw new Error("LOGIN_FAILED: Missing username or password");
    }

    // Per-call override > env > built-in default. Lets the credential-check
    // HTTP route pass the URL the BE was configured with, without mutating
    // process.env (which would race across concurrent requests).
    const url = loginUrl || process.env.MYNTRA_LOGIN_URL || "https://partners.myntrainfo.com/";
    console.log(`🌐 Navigating to Myntra Partner Portal: ${url}`);
    await driver.get(url);
    // Long initial wait lets bot-detection / analytics scripts bootstrap —
    // submitting too fast surfaces a red "Network Error" banner under LOG IN.
    await sleep(6000);

    // Steps 1 and 2 walk the portal's own login journey: the landing page's
    // "Login" button, then "Use Email And Password" on the SSO chooser.
    //
    // Both are wrapped because when Myntra has a bad moment it serves the
    // landing page without ever rendering that journey — no button, no chooser,
    // no form. Nothing is wrong with the credential or the selectors, and it
    // clears on its own. Unwrapped, the operator saw
    // "Failed at step: Homepage 'Login' button (element not found within
    // 20000ms)", which reads like a broken script and tells them nothing they
    // can act on.
    await asPortalRenderFailure(
        () => clickWhenReady(
            driver,
            By.xpath("//button[normalize-space()='Login']"),
            "Homepage 'Login' button"
        ),
        "the Login button never appeared on the landing page"
    );
    await sleep(2500);

    // Step 2: Click "Use Email And Password" on the SSO chooser
    await asPortalRenderFailure(
        () => clickWhenReady(
            driver,
            By.xpath("//button[.//div[normalize-space()='Use Email And Password']]"),
            "'Use Email And Password' button"
        ),
        "the sign-in options never appeared"
    );
    await sleep(2500);

    // Step 3 + 4: Fill email and password slowly (per-char to dodge bot heuristics)
    await typeWhenReady(driver, By.id("email"), username, "email", { slow: true });
    await sleep(1200);
    await typeWhenReady(driver, By.id("password"), password, "password", { slow: true });
    await sleep(2500);

    // Step 5: Click LOG IN — retry on transient "Network Error" toast.
    const MAX_RETRIES = 3;
    let success = false;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        // The form sometimes auto-submits (Enter key on slow type) and the LOG
        // IN button is gone before we get here. Pause 5s and check whether the
        // dashboard rendered — if it did, we're already logged in.
        let loginBtn;
        try {
            loginBtn = await waitFor(
                driver,
                "'LOG IN' submit button",
                until.elementLocated(By.xpath("//button[normalize-space()='LOG IN']")),
                10000
            );
        } catch (err) {
            console.warn(`⚠️ LOG IN button not found on attempt ${attempt}: ${err.message}`);
            console.log("⏳ Waiting 5s and checking for dashboard before giving up...");
            await sleep(5000);
            if (await isOnDashboard(driver)) {
                console.log("✅ Dashboard detected without clicking LOG IN — treating as logged in");
                success = true;
                break;
            }
            if (attempt < MAX_RETRIES) {
                console.warn(`   No dashboard either, retrying...`);
                await sleep(3000 * attempt);
                continue;
            }
            break;
        }
        await waitFor(driver, "'LOG IN' (enabled)", until.elementIsEnabled(loginBtn), 10000);
        await driver.executeScript("arguments[0].scrollIntoView({block:'center'});", loginBtn);
        await sleep(500);
        const preUrl = await driver.getCurrentUrl();

        // OS-level click via robotjs — WebDriver/JS clicks trip Akamai's
        // bot detection and reliably surface "Network Error" on this form.
        // The button's screen position is worked out from the page and
        // checked by hover before clicking — see ../../common/osClickElement.
        // 11 clicks × 500ms gap ≈ 5s of clicking per attempt. Extra clicks
        // spread over the 5s window cover the case where the button is still
        // mounting / animating when the first click fires.
        const CLICK_COUNT = 11;
        const CLICK_GAP_MS = 500;
        console.log(`🖱️  Submitting login via OS-level mouse × ${CLICK_COUNT} [attempt ${attempt}/${MAX_RETRIES}]`);
        await armAuthCapture(driver);
        await osClickElement(driver, loginBtn, { times: CLICK_COUNT, gapMs: CLICK_GAP_MS });

        console.log(`⏳ Waiting for login outcome (attempt ${attempt}/${MAX_RETRIES})...`);

        const POLL_MS = 500;
        const MAX_WAIT_MS = 12000;
        let outcome = "timeout";
        for (let waited = 0; waited < MAX_WAIT_MS; waited += POLL_MS) {
            await sleep(POLL_MS);
            const currentUrl = await driver.getCurrentUrl();
            if (currentUrl !== preUrl) { outcome = "redirected"; break; }
            const hasError = await driver.executeScript(
                "return Array.from(document.querySelectorAll('body *')).some(el => (el.textContent || '').includes('Network Error'));"
            );
            if (hasError) { outcome = "network_error"; break; }
        }

        // Drain captured fetch/XHR — logs the auth POST's real status/body
        // so we can tell WHY "Network Error" appeared (Akamai reject vs
        // proxy timeout vs missed-button vs late redirect).
        const authEvents = await drainAuthCapture(driver);
        logAuthEvents(authEvents, `attempt ${attempt}, outcome=${outcome}`);

        if (outcome === "redirected") { success = true; break; }
        if (outcome === "network_error" && attempt < MAX_RETRIES) {
            console.warn(`⚠️ 'Network Error' on attempt ${attempt}, backing off...`);
            await sleep(3000 * attempt);
            continue;
        }
        break;
    }

    if (!success) {
        // Distinguish a genuinely wrong password from every other way this
        // loop can end (Akamai "Network Error", missed OS-level click, flagged
        // proxy IP, late redirect). Only Myntra's own credential banner —
        // div.global_errorMessage__u64W2 "Incorrect email or password." — is
        // proof the credential itself is bad; that's the single case allowed
        // to reach markCredentialsUnverified and flip is_verified=false.
        const bannerText = await probeCredentialErrorBanner(driver);
        if (isCredentialErrorBanner(bannerText)) {
            throw invalidCredentialsError(bannerText);
        }
        throw new Error(
            "LOGIN_FAILED: unable to login (no credential-error banner detected) — " +
            "Myntra kept showing Network Error or never redirected."
        );
    }

    // Login is DONE here: Myntra accepted the credentials and redirected us off
    // the login form. Everything past this point — the relationship-type modal
    // and the dashboard readiness gate — is post-login setup, not login. It
    // lives in completePostLogin() so a failure there is never classified as a
    // login failure (no proxy rotation, no login retry, no unverifying the
    // credential over a modal that moved).
    console.log(`📍 Post-login URL: ${await driver.getCurrentUrl()}`);
    console.log(`📄 Page title after login: ${await driver.getTitle()}`);
    console.log("✅ Login successful");
    return true;
}

// ---------------------------
// 🧩 Post-login setup (NOT part of login)
// ---------------------------
// Runs after myntraLogin has already succeeded. Two steps, in this order:
//   1. Dismiss the first-login "Select Relationship Type" modal (sticky — it
//      blocks every nav item until a radio + Done are clicked).
//   2. Gate on the dashboard being rendered, because the downstream claim flow
//      expects the Services nav to be present; failing loud here beats letting
//      navigateToCreateClaim throw a less-clear "element not found".
// Errors are prefixed POST_LOGIN_FAILED so callers can tell them apart from
// LOGIN_FAILED / INVALID_CREDENTIALS.
//
// Options exist for the API/cookie-only callers (claimApiFlow.loginMyntraApi,
// apiReportFlow.loginMyntra). Those launch Chrome purely to harvest `erp.at` +
// `session` and tear it down immediately — they never touch the portal DOM, so
// UI readiness is not their problem:
//   dashboardGate:    false → skip the #Services poll entirely (UI-only concern)
//   modalBestEffort:  true  → click the modal if it's up, but log and continue
//                             on failure instead of failing the whole batch.
// The modal is kept (not skipped) for those callers because it's cheap and we
// can't fully rule out that Myntra scopes an account's first session by the
// relationship type; best-effort gets the click without the blast radius.
async function completePostLogin(driver, credentials, { dashboardGate = true, modalBestEffort = false } = {}) {
    // autoClaim credentials carry the type under `accountType`; masterData
    // callers (and credential-check) pass it as `partnerType`.
    const partnerType = credentials?.partnerType || credentials?.accountType;
    try {
        await handleRelationshipTypeModal(driver, partnerType);
    } catch (err) {
        if (!modalBestEffort) {
            throw new Error(`POST_LOGIN_FAILED: ${err.message}`);
        }
        // Transient DOM churn (stale element reference is the common one — the
        // modal re-renders between locate and click) must not fail a run that
        // only needed the session cookies.
        console.warn(
            `⚠️ Relationship-type modal handling failed (best-effort, continuing): ${err.message}`
        );
    }

    if (!dashboardGate) {
        console.log("⏭️ Skipping dashboard gate — caller does not use the portal UI");
        return true;
    }

    // Poll #Services up to 15s — dashboard bundle sometimes renders a few
    // seconds after the URL redirect settles, so a single check fails on
    // slow loads even though login itself succeeded.
    const DASHBOARD_WAIT_MS = 15000;
    const DASHBOARD_POLL_MS = 500;
    console.log(`⏳ Waiting up to ${DASHBOARD_WAIT_MS / 1000}s for dashboard (Services nav) to render...`);
    let dashboardReady = false;
    for (let waited = 0; waited < DASHBOARD_WAIT_MS; waited += DASHBOARD_POLL_MS) {
        if (await isOnDashboard(driver)) { dashboardReady = true; break; }
        await sleep(DASHBOARD_POLL_MS);
    }
    if (!dashboardReady) {
        throw new Error(
            `POST_LOGIN_FAILED: Dashboard not detected within ${DASHBOARD_WAIT_MS}ms (Services nav missing).`
        );
    }
    console.log("✅ Dashboard ready — proceeding with claim process");
    return true;
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
        // credentials don't declare a partnerType/accountType.
        console.warn(
            "⚠️ RELATIONSHIP_MODAL: partnerType/accountType missing on credentials — defaulting to PARTNER_SELLER (FBM/PPMP/MDirect)"
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

// Dashboard = the top nav with the Services dropdown is rendered. That's the
// exact element navigateToCreateClaim hovers, so if it's there, the next step
// will succeed. Used as a post-login readiness gate.
async function isOnDashboard(driver) {
    try {
        const elems = await driver.findElements(By.id("Services"));
        return elems.length > 0;
    } catch (_) {
        return false;
    }
}

// ---------------------------
// 🧭 Navigate: Services → Seller Protection Fund → Create New Claim
// ---------------------------
async function navigateToCreateClaim(driver) {
    // Step 1: Hover "Services" nav button to open the dropdown
    await hoverElement(driver, By.id("Services"), "'Services' nav button");
    await sleep(1500);

    // Step 2: Click "Seller Protection Fund" inside the open dropdown
    await clickWhenReady(
        driver,
        By.xpath("//*[normalize-space(text())='Seller Protection Fund']"),
        "'Seller Protection Fund' menu item"
    );

    // Move cursor away so the Services dropdown collapses — otherwise the
    // hover-open menu can stay visible and overlay subsequent clicks.
    console.log("🖱️  Moving cursor away to close the Services dropdown...");
    await driver.actions({ async: true })
        .move({ x: 0, y: 0, origin: "viewport" })
        .perform();
    await sleep(500);

    await sleep(4000);
    console.log(`📍 URL after opening SPF page: ${await driver.getCurrentUrl()}`);

    // Step 3: Click "Create New Claim" on the SPF landing page
    await clickWhenReady(
        driver,
        By.xpath("//button[normalize-space()='Create New Claim']"),
        "'Create New Claim' button"
    );
    await sleep(4000);
    console.log(`📍 URL after Create New Claim: ${await driver.getCurrentUrl()}`);
    return true;
}

// ---------------------------
// 🔎 SPF Modal — shared search portion
// ---------------------------
// Waits for the "Create New SPF Claim" modal, types the awbNumber into the
// search field, clicks Search, and waits for the result table to populate.
// Returns the MODAL_SCOPE XPath so callers can keep their lookups scoped to
// the modal (and not accidentally match identical text on the page behind).
async function searchInSPFModal(driver, awbNumber) {
    if (!awbNumber) throw new Error("Missing awbNumber for SPF claim search");

    console.log(`🪟 Waiting for 'Create New SPF Claim' modal...`);
    await driver.wait(
        until.elementLocated(By.xpath("//h1[normalize-space()='Create New SPF Claim']")),
        WAIT_TIMEOUT
    );
    console.log(`    ✅ Modal title detected`);
    // Wait for the modal open animation to complete (~300-600ms backdrop fade).
    await sleep(1200);

    const MODAL_SCOPE =
        "//div[contains(@class,'aui-modal-wrapper')]" +
        "[.//h1[normalize-space()='Create New SPF Claim']]";

    const ORDER_INPUT_XPATH =
        MODAL_SCOPE +
        "//div[contains(@class,'aui-field-container')]" +
        "[.//span[normalize-space()='Order ID/ Return ID/ Tracking ID']]" +
        "//input";

    await typeWhenReady(
        driver,
        By.xpath(ORDER_INPUT_XPATH),
        awbNumber,
        `awbNumber (${awbNumber})`
    );

    await clickWhenReady(
        driver,
        By.xpath(MODAL_SCOPE + "//button[normalize-space()='Search']"),
        "'Search' button"
    );

    console.log(`⏳ Waiting for results table to populate...`);
    await sleep(3500);

    return MODAL_SCOPE;
}

// ---------------------------
// 🔎 SPF Modal — probe an AWB without acting on it
// ---------------------------
// Used by the orphan-claim service to decide whether an AWB belongs to the
// currently logged-in Myntra account. Enters the AWB into the SPF search box,
// reads the result table, and returns the classification WITHOUT clicking any
// Apply/View link. Assumes the SPF modal is already open (caller navigates
// via navigateToCreateClaim first).
//
// Returns:
//   { belongs: true,  alreadyClaimed: false, ticketId: null }   — Apply/Resume link present
//   { belongs: true,  alreadyClaimed: true,  ticketId: string } — View Claim row present
//   { belongs: false, alreadyClaimed: false, ticketId: null }   — "Claim is not applicable"
async function probeAwbInSPFModal(driver, awbNumber) {
    const MODAL_SCOPE = await searchInSPFModal(driver, awbNumber);

    const viewLinks = await driver.findElements(
        By.xpath(MODAL_SCOPE + "//a[normalize-space()='View Claim']")
    );
    if (viewLinks.length > 0) {
        const ticketId = await readTicketIdFromViewClaimRow(driver);
        return { belongs: true, alreadyClaimed: true, ticketId: ticketId || null };
    }

    const applyLinks = await driver.findElements(
        By.xpath(MODAL_SCOPE + "//a[normalize-space()='Apply Claim' or normalize-space()='Resume Claim']")
    );
    if (applyLinks.length > 0) {
        return { belongs: true, alreadyClaimed: false, ticketId: null };
    }

    return { belongs: false, alreadyClaimed: false, ticketId: null };
}

// ---------------------------
// 🔎 SPF Modal — search awbNumber → Apply Claim on the first row
// ---------------------------
// Returns one of:
//   { status: "applied", resume: boolean }  — clicked Apply/Resume Claim, proceed to form
//   { status: "duplicate", ticketId }       — row already shows View Claim, skip filing
// Throws "Claim is not applicable" when neither link is present.
//
// The duplicate branch exists because some AWBs were getting filed twice when
// the script re-ran over a batch that already had claims submitted. Reading
// the existing ticket id here lets scriptNew.js update the BE and move on.
async function searchAndApplyClaim(driver, awbNumber) {
    const MODAL_SCOPE = await searchInSPFModal(driver, awbNumber);

    // Check for View Claim first — if the claim was already filed (by us in a
    // prior run, or manually), the row shows "View Claim" instead of "Apply
    // Claim" and we must NOT try to file again.
    const viewLinks = await driver.findElements(
        By.xpath(MODAL_SCOPE + "//a[normalize-space()='View Claim']")
    );
    if (viewLinks.length > 0) {
        console.log(`    ℹ️ Found ${viewLinks.length} 'View Claim' row(s) — claim already filed`);
        const ticketId = await readTicketIdFromViewClaimRow(driver);
        console.log(`    🎫 Existing Ticket ID: ${ticketId || "<none>"}`);
        return { status: "duplicate", ticketId };
    }

    // "Resume Claim" appears when a draft was started but never submitted —
    // clicking it drops the user back into the same claim form, so we treat
    // it as an alias for Apply Claim.
    const applyLinks = await driver.findElements(
        By.xpath(MODAL_SCOPE + "//a[normalize-space()='Apply Claim' or normalize-space()='Resume Claim']")
    );
    console.log(`    🔢 Apply/Resume Claim links found: ${applyLinks.length}`);

    if (applyLinks.length === 0) {
        throw new Error("Claim is not applicable");
    }

    const firstApply = applyLinks[0];
    const linkLabel = (await firstApply.getText()).trim() || "Apply Claim";
    await driver.executeScript("arguments[0].scrollIntoView({block:'center'});", firstApply);
    await sleep(300);
    try {
        await firstApply.click();
    } catch (_) {
        await driver.executeScript("arguments[0].click();", firstApply);
    }
    console.log(`    ✅ Clicked '${linkLabel}' on the first row`);
    await sleep(4000);
    console.log(`📍 URL after ${linkLabel}: ${await driver.getCurrentUrl()}`);
    return { status: "applied", resume: linkLabel === "Resume Claim" };
}

// Shared in-page DOM walk: from the SPF modal, locate the View Claim row, look
// up the column index of the "Ticket ID" header, return the cell text at that
// index. Used by both searchAndApplyClaim (duplicate detection) and
// getMyntraTicketId (post-submit capture).
async function readTicketIdFromViewClaimRow(driver) {
    return await driver.executeScript(`
        const modal = document.evaluate(
            "//div[contains(@class,'aui-modal-wrapper')][.//h1[normalize-space()='Create New SPF Claim']]",
            document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null
        ).singleNodeValue;
        if (!modal) return null;

        const viewLink = Array.from(modal.querySelectorAll('a'))
            .find(a => (a.textContent || '').trim() === 'View Claim');
        if (!viewLink) return null;

        const row = viewLink.closest('tr') || viewLink.closest('[role="row"]');
        if (!row) return null;

        const tableLike =
            row.closest('table') ||
            row.closest('[role="grid"]') ||
            (row.parentElement && row.parentElement.parentElement) ||
            modal;

        const headerCells = Array.from(
            tableLike.querySelectorAll('th, [role="columnheader"]')
        );
        const ticketIdx = headerCells.findIndex(
            h => (h.textContent || '').trim() === 'Ticket ID'
        );
        if (ticketIdx === -1) return null;

        const directCells = Array.from(row.children).filter(c =>
            c.tagName === 'TD' ||
            c.getAttribute('role') === 'cell' ||
            c.getAttribute('role') === 'gridcell'
        );
        let target = directCells[ticketIdx];
        if (!target) {
            const allCells = Array.from(
                row.querySelectorAll('td, [role="cell"], [role="gridcell"]')
            );
            target = allCells[ticketIdx];
        }
        if (!target) return null;

        return (target.textContent || '').trim();
    `);
}

// ---------------------------
// 🧾 Claim form: Issue Category dropdown
// ---------------------------
// AUI custom select: option <li> ids are timestamp-based, so we MUST select
// by visible text, scoped inside the right <ul role="listbox">.
async function selectIssueCategory(driver, categoryText) {
    if (!categoryText) throw new Error("Missing issueCategory");
    console.log(`📂 Selecting Issue Category: ${categoryText}`);

    const TRIGGER_XPATH =
        "//div[contains(@class,'aui-field-container')]" +
        "[.//*[contains(normalize-space(),'Issue Category')]]" +
        "//div[contains(@class,'aui-input-select') and not(contains(@class,'list')) and not(contains(@class,'selector'))][1]";

    await clickWhenReady(driver, By.xpath(TRIGGER_XPATH), "'Issue Category' dropdown trigger");

    // Use xpathLiteral so values containing apostrophes (e.g. "seller's
    // product") don't break the XPath parser.
    const OPTION_XPATH =
        "//ul[@role='listbox']" +
        `//li[@role='option' and normalize-space(.)=${xpathLiteral(categoryText)}]`;

    await clickWhenReady(driver, By.xpath(OPTION_XPATH), `'${categoryText}' option`);
    await sleep(500);
}

// ---------------------------
// 🔀 Claim form: Conditional inputs by issue category
// ---------------------------
// Two Myntra issue categories render an extra input right below the Issue
// Category dropdown:
//   - "Partial Return"                     → number input "Disputed Amount"
//   - "Wrong Returns-Received own product" → text input "Physical Received Sku"
// Both inputs use React-controlled state (native value setter is required so
// React sees the change and unlocks the Submit button). Values come from the
// BE (myntraClaimDetails.disputedAmount / .physicalReceivedSku) via the
// script config; we no-op when the value is empty so a mis-tagged claim can't
// fail here.
function normalizeCategory(value) {
    return String(value || "").trim().toLowerCase();
}

// Category matching accepts either the display name Myntra ships to us
// ("Partial Return") or the internal key ("partial_return") so this helper
// stays robust to which one the BE stored on cms.typeOfClaim.
function isPartialReturnCategory(category) {
    const norm = normalizeCategory(category);
    return norm === "partial return" || norm === "partial_return";
}

function isWrongReturnsOwnCategory(category) {
    const norm = normalizeCategory(category);
    return (
        norm === "wrong returns-received own product" ||
        norm === "wrong_returns_own_product"
    );
}

async function fillIssueCategoryConditionalInput(driver, placeholder, value) {
    console.log(`⌨️  Filling '${placeholder}' with value: ${value}`);

    // Locate via JS instead of XPath — the XPath variant occasionally
    // timed out because Myntra sometimes wraps this input inside an
    // additional div during React's async mount (the DOM node exists
    // but the XPath evaluator's cached tree misses it). A JS query on
    // every poll re-scans a fresh document, and we lowercase both
    // placeholder + trim whitespace so BE spelling differences ("SKU"
    // vs "Sku", trailing spaces) don't matter.
    const placeholderLc = String(placeholder).toLowerCase().trim();
    const findInput = () => driver.executeScript(
        `
        const target = arguments[0];
        const inputs = Array.from(document.querySelectorAll('input.aui-input-input, input[class*="aui-input-input"]'));
        for (const el of inputs) {
            const ph = (el.getAttribute('placeholder') || '').toLowerCase().trim();
            if (ph === target) {
                const rect = el.getBoundingClientRect();
                if (rect.width > 0 && rect.height > 0) return el;
            }
        }
        return null;
        `,
        placeholderLc
    );

    let input = null;
    try {
        input = await driver.wait(async () => {
            const el = await findInput();
            return el || false;
        }, WAIT_TIMEOUT);
    } catch (err) {
        throw new Error(
            `Failed at step: ${placeholder} input (element not found within ${WAIT_TIMEOUT}ms)`
        );
    }
    await driver.executeScript("arguments[0].scrollIntoView({block:'center'});", input);
    await sleep(200);

    // React-controlled input — mirror the fillAdditionalInfo pattern so the
    // controlled component's shim picks up the value instead of reverting it.
    await driver.executeScript(
        `
        const el = arguments[0];
        const value = arguments[1];
        el.focus();
        const proto = Object.getPrototypeOf(el);
        const setter = Object.getOwnPropertyDescriptor(proto, 'value') &&
                       Object.getOwnPropertyDescriptor(proto, 'value').set;
        if (setter) {
            setter.call(el, value);
        } else {
            el.value = value;
        }
        el.dispatchEvent(new Event('input',  { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el.blur();
        `,
        input,
        String(value)
    );

    console.log(`    ✅ Entered ${placeholder}`);
    await sleep(300);
}

async function fillIssueCategoryConditionalInputs(driver, formData) {
    const category = formData.issueCategory;
    if (isPartialReturnCategory(category)) {
        const amount = formData.disputedAmount;
        if (amount === undefined || amount === null || amount === "") {
            throw new Error(
                "Missing disputedAmount for 'Partial Return' claim — set it on the CMS row and retry"
            );
        }
        await fillIssueCategoryConditionalInput(driver, "Disputed Amount", amount);
        return;
    }
    if (isWrongReturnsOwnCategory(category)) {
        const sku = formData.physicalReceivedSku;
        if (!sku || !String(sku).trim()) {
            throw new Error(
                "Missing physicalReceivedSku for 'Wrong Returns-Received own product' claim — set it on the CMS row and retry"
            );
        }
        await fillIssueCategoryConditionalInput(driver, "Physical Received Sku", sku);
    }
}

// ---------------------------
// 📤 Claim form: Upload photo proof of shipping label
// ---------------------------
// File inputs are usually hidden behind a styled "Add Image" button. The
// reliable Selenium pattern is to sendKeys(absolutePath) directly to the
// <input type="file"> — works even when hidden.
async function uploadShippingLabelProof(driver, absolutePath) {
    if (!absolutePath) throw new Error("Missing shippingLabelImage path");
    console.log(`📤 Uploading shipping label proof: ${absolutePath}`);

    const CANDIDATE_XPATHS = [
        "//*[contains(normalize-space(.),'Upload photo proof of shipping label')]" +
        "/following::input[@type='file' and @accept='image/*'][1]",
        "(//*[contains(normalize-space(.),'Upload photo proof of shipping label')])[last()]" +
        "/following::input[@type='file' and @accept='image/*'][1]",
        "//input[@type='file' and @accept='image/*' and contains(@class,'p-imageVideoProofs-module-css-fileInput')]",
    ];

    const found = await findFirstByXpaths(driver, CANDIDATE_XPATHS);
    if (!found) {
        const imageInputs = await driver.findElements(
            By.xpath("//input[@type='file' and @accept='image/*']")
        );
        console.error(`    ❌ No matching shipping-label file input found.`);
        console.error(`       image/* file inputs currently in DOM: ${imageInputs.length}`);
        throw new Error("Failed at step: Upload photo proof of shipping label (no anchor matched)");
    }
    console.log(`    🎯 Matched via: ${found.xpath}`);

    await found.element.sendKeys(absolutePath);
    console.log(`    ✅ File path sent to shipping-label input`);
    await sleep(2500);
}

// ---------------------------
// 🗑️ Claim form: Remove the uploaded shipping-label image
// ---------------------------
// The remove button lives inside `.p-imageVideoProofs-module-css-imageBox`
// and carries `p-imageVideoProofs-module-css-hidden` until the user hovers
// the image area. We hover the image box to drop the hidden class, then JS
// click the button (more reliable than waiting for the visibility transition).
async function removeShippingLabelProof(driver) {
    console.log(`🗑️  Removing uploaded shipping-label image...`);

    const IMAGE_BOX_XPATH =
        `(//*[contains(normalize-space(.),'Upload photo proof of shipping label')])[last()]` +
        `/following::div[contains(@class,'p-imageVideoProofs-module-css-imageBox')][1]`;
    const REMOVE_BTN_XPATH =
        IMAGE_BOX_XPATH +
        `//button[contains(@class,'p-imageVideoProofs-module-css-removeButton')]`;

    const imageBox = await waitFor(
        driver,
        "Shipping label image box",
        until.elementLocated(By.xpath(IMAGE_BOX_XPATH))
    );
    await driver.executeScript("arguments[0].scrollIntoView({block:'center'});", imageBox);
    await sleep(300);

    try {
        await driver.actions({ async: true }).move({ origin: imageBox }).perform();
    } catch (_) { /* hover is best-effort; JS click below works regardless */ }
    await sleep(400);

    const removeBtn = await waitFor(
        driver,
        "Shipping label remove button",
        until.elementLocated(By.xpath(REMOVE_BTN_XPATH))
    );
    await driver.executeScript("arguments[0].click();", removeBtn);
    console.log(`    ✅ Clicked remove on shipping label`);

    // Wait for the image box to disappear so the next upload targets the
    // fresh empty file input instead of the stale, post-upload one.
    try {
        await driver.wait(async () => {
            const boxes = await driver.findElements(By.xpath(IMAGE_BOX_XPATH));
            return boxes.length === 0;
        }, WAIT_TIMEOUT);
    } catch (_) { /* fall through — re-upload will surface any real problem */ }
    await sleep(800);
}

// ---------------------------
// 📤 Claim form: Upload multiple images to a section
// ---------------------------
// Myntra renders 2 upload slots initially and adds a new empty slot each time
// one is filled. We loop through `filePaths`, find the FIRST empty file input
// inside the section's grid container, and sendKeys to it.
async function uploadMultipleImagesForSection(driver, headingText, filePaths) {
    if (!Array.isArray(filePaths) || filePaths.length === 0) return;
    console.log(`📤 Uploading ${filePaths.length} images for: ${headingText}`);

    const SECTION_CONTAINER_XPATH =
        `(//*[contains(normalize-space(.),'${headingText}')])[last()]` +
        `/following::div[contains(@class,'p-applyClaim-module-css-imageLayout')][1]`;

    await waitFor(
        driver,
        `${headingText} (section container)`,
        until.elementLocated(By.xpath(SECTION_CONTAINER_XPATH))
    );

    const INPUT_XPATH =
        SECTION_CONTAINER_XPATH + `//input[@type='file' and @accept='image/*']`;

    for (let i = 0; i < filePaths.length; i++) {
        const filePath = filePaths[i];
        const label = `image ${i + 1}/${filePaths.length} (${path.basename(filePath)})`;
        console.log(`   📎 ${label}`);

        // Re-query every iteration — DOM grows as slots are added.
        const inputs = await driver.findElements(By.xpath(INPUT_XPATH));
        let target = null;
        for (const inp of inputs) {
            const val = await inp.getAttribute("value");
            if (!val) { target = inp; break; }
        }
        if (!target) {
            // Myntra caps the number of upload slots for this section. Rather
            // than aborting the whole claim (which would fail the AWB and tear
            // the session down), we keep the images already uploaded and let
            // the form proceed to submit with whatever landed.
            console.warn(
                `   ⚠️ ${headingText} — no empty image slot available ` +
                `(uploaded ${i}/${filePaths.length}); skipping remaining and continuing to submit`
            );
            return;
        }

        await target.sendKeys(filePath);
        await sleep(1500);
    }
    console.log(`   ✅ All ${filePaths.length} images uploaded for ${headingText}`);
}

// ---------------------------
// 🎥 Claim form: Upload video proof
// ---------------------------
async function uploadVideoProof(driver, headingText, absolutePath) {
    if (!absolutePath) return; // Optional field
    console.log(`🎥 Uploading video proof: ${absolutePath}`);

    const CANDIDATE_XPATHS = [
        `//*[contains(normalize-space(.),"${headingText}")]` +
        `/following::input[@type='file' and @accept='video/*'][1]`,
        `(//*[contains(normalize-space(.),"${headingText}")])[last()]` +
        `/following::input[@type='file' and @accept='video/*'][1]`,
        "//input[@type='file' and @accept='video/*' and contains(@class,'p-imageVideoProofs-module-css-fileInput')]",
    ];

    const found = await findFirstByXpaths(driver, CANDIDATE_XPATHS);
    if (!found) {
        const videoInputs = await driver.findElements(
            By.xpath("//input[@type='file' and @accept='video/*']")
        );
        console.error(`    ❌ No matching video file input found.`);
        console.error(`       video/* file inputs currently in DOM: ${videoInputs.length}`);
        throw new Error(`Failed at step: ${headingText} (no anchor matched)`);
    }
    console.log(`    🎯 Matched via: ${found.xpath}`);

    await found.element.sendKeys(absolutePath);
    console.log(`    ✅ File path sent to video input`);
    // Video uploads take longer than image previews.
    await sleep(4000);
}

// ---------------------------
// 📝 Claim form: Additional Info textarea
// ---------------------------
// The Additional Info body is a multi-KB HTML email template. Sending it
// character-by-character via sendKeys took ~90s in practice and stressed
// Chrome enough that the renderer died mid-form (manifested as
// "no such window: target window already closed" on the next step).
//
// Instead, we set the textarea's value directly via JS and fire input/change
// events so AUI / React's internal state picks up the new value. Uses the
// React-friendly native value setter so controlled components don't revert
// the change.
async function fillAdditionalInfo(driver, text) {
    if (!text) return; // Optional
    console.log(`📝 Filling Additional Info textarea (JS injection)`);

    const TEXTAREA_XPATH =
        "(//*[contains(normalize-space(.),'Additional Info')])[last()]" +
        "/following::textarea[contains(@class,'aui-input-text-area-input')][1]";

    const textarea = await waitFor(
        driver,
        "Additional Info textarea",
        until.elementLocated(By.xpath(TEXTAREA_XPATH))
    );
    await driver.executeScript("arguments[0].scrollIntoView({block:'center'});", textarea);
    await sleep(200);

    await driver.executeScript(
        `
        const el = arguments[0];
        const value = arguments[1];
        el.focus();
        // Use the native setter so React's controlled-input shim sees the change.
        const proto = Object.getPrototypeOf(el);
        const setter = Object.getOwnPropertyDescriptor(proto, 'value') &&
                       Object.getOwnPropertyDescriptor(proto, 'value').set;
        if (setter) {
            setter.call(el, value);
        } else {
            el.value = value;
        }
        el.dispatchEvent(new Event('input',  { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el.blur();
        `,
        textarea,
        String(text)
    );

    console.log(`    ✅ Entered Additional Info (${String(text).length} chars)`);
    await sleep(400);
}

// ---------------------------
// ☑️ Claim form: Tick the confirmation checkbox
// ---------------------------
// The <label class="aui-input-checkbox-input"> wraps the (hidden) input and
// natively forwards clicks to it. A single JS click on the label is enough
// to flip the state — no visibility gate, no fallbacks needed.
async function tickConfirmationCheckbox(driver) {
    console.log(`☑️  Ticking confirmation checkbox`);

    const LABEL_XPATH = "//label[contains(@class,'aui-input-checkbox-input')]";

    const label = await waitFor(
        driver,
        "Confirmation checkbox (label)",
        until.elementLocated(By.xpath(LABEL_XPATH))
    );

    await driver.executeScript("arguments[0].scrollIntoView({block:'center'});", label);
    await sleep(200);
    await driver.executeScript("arguments[0].click();", label);
    console.log(`    ✅ Checkbox label clicked`);
    await sleep(300);
}

// ---------------------------
// 🚦 Claim form: Submit
// ---------------------------
// Anchored on the canonical AUI Submit button:
//   <button id="btn" data-test-id="target" class="aui-button-container ...">Submit</button>
//
// `isEnabled()` is unreliable here — when AUI disables the button it adds a
// class / sets aria-disabled rather than the HTML `disabled` attribute, so
// Selenium can mis-report it as enabled. We instead poll class + aria-disabled
// for the truthful state. Click via native first, fall back to JS click if
// the native click is intercepted by an overlay.
async function submitClaim(driver) {
    console.log(`🚦 Verifying Submit button state...`);

    const SUBMIT_XPATH =
        "//button[@id='btn' and @data-test-id='target' and normalize-space()='Submit']" +
        " | //button[@id='btn' and normalize-space()='Submit']";

    const submitBtn = await waitFor(
        driver,
        "Submit button (located)",
        until.elementLocated(By.xpath(SUBMIT_XPATH))
    );
    await driver.executeScript("arguments[0].scrollIntoView({block:'center'});", submitBtn);
    await sleep(300);

    const isActuallyEnabled = async () => {
        const cls = (await submitBtn.getAttribute("class")) || "";
        const ariaDisabled = await submitBtn.getAttribute("aria-disabled");
        const htmlDisabled = await submitBtn.getAttribute("disabled");
        const looksDisabled =
            /(^|\s)(aui-button-disabled|disabled)(\s|$)/.test(cls) ||
            ariaDisabled === "true" ||
            htmlDisabled !== null;
        return !looksDisabled;
    };

    const GRACE_MS = 5000;
    const POLL_MS = 250;
    let enabled = false;
    for (let waited = 0; waited <= GRACE_MS; waited += POLL_MS) {
        enabled = await isActuallyEnabled();
        if (enabled) break;
        await sleep(POLL_MS);
    }

    if (!enabled) {
        const cls = await submitBtn.getAttribute("class");
        const ariaDisabled = await submitBtn.getAttribute("aria-disabled");
        const htmlDisabled = await submitBtn.getAttribute("disabled");
        console.error(`    ❌ Submit not enabled — class=${cls} aria-disabled=${ariaDisabled} disabled=${htmlDisabled}`);
        throw new Error("Failed at step: Submit button is not enabled — required fields may be missing or invalid");
    }
    console.log(`    📊 Submit button is enabled`);

    let clicked = false;
    try {
        await submitBtn.click();
        clicked = true;
        console.log(`    ✅ Submit clicked (native)`);
    } catch (err) {
        console.log(`    ⚠️  Native click failed (${err.name || err.message}), falling back to JS click`);
    }
    if (!clicked) {
        await driver.executeScript("arguments[0].click();", submitBtn);
        console.log(`    ✅ Submit clicked (JS)`);
    }

    // Confirm Submission modal — appears after clicking the form Submit.
    // Anchor on the modal that contains the "Confirm Submission" heading,
    // then click the primary-blue Submit button inside it. We can't rely on
    // text alone because the same "Submit" label also exists on the form
    // behind the modal; the primary-blue class disambiguates Submit from
    // the secondary-blue Cancel inside the modal.
    console.log(`🪟 Waiting for 'Confirm Submission' modal...`);
    const CONFIRM_MODAL_SCOPE =
        "//div[contains(@class,'aui-modal-wrapper')]" +
        "[.//h1[normalize-space()='Confirm Submission']]";
    const CONFIRM_SUBMIT_XPATH =
        CONFIRM_MODAL_SCOPE +
        "//button[contains(@class,'aui-button-primary-blue') and normalize-space()='Submit']";

    await waitFor(
        driver,
        "Confirm Submission modal",
        until.elementLocated(By.xpath(CONFIRM_MODAL_SCOPE)),
        10000
    );
    // Brief settle for the modal's open animation before clicking through.
    await sleep(500);

    assertClaimSubmitEnabled("Myntra", "'Submit' + 'Confirm Submission' click");

    await clickWhenReady(
        driver,
        By.xpath(CONFIRM_SUBMIT_XPATH),
        "'Confirm Submission' → Submit button"
    );

    await sleep(4000);
    console.log(`📍 URL after Confirm Submit: ${await driver.getCurrentUrl()}`);
}

// ---------------------------
// 🎫 Ticket ID lookup (post-submit)
// ---------------------------
// After a successful submit, the claim shows up in the SPF modal as a
// "View Claim" row (instead of "Apply Claim") with a Ticket ID populated in
// its own column. To capture it we:
//   1. Re-open the SPF modal (Services → SPF → Create New Claim).
//   2. Search the same awbNumber (re-uses `searchInSPFModal`).
//   3. Locate the row containing the "View Claim" link.
//   4. Resolve the Ticket ID column index dynamically from the table headers
//      (so we don't depend on a hard-coded column position) and read the
//      cell value from the matching row.
// Returns null if the row / link / cell is missing — caller can mark the AWB
// as "Help Center Failed" so the user can verify manually.
async function getMyntraTicketId(driver, awbNumber) {
    if (!awbNumber) return null;

    console.log(`🎫 Looking up Ticket ID by re-opening SPF modal for awbNumber=${awbNumber}`);
    let MODAL_SCOPE;
    try {
        await navigateToCreateClaim(driver);
        MODAL_SCOPE = await searchInSPFModal(driver, awbNumber);
    } catch (err) {
        console.warn(`⚠️ Could not re-open SPF modal for ticket lookup: ${err.message}`);
        return null;
    }

    const viewLinks = await driver.findElements(
        By.xpath(MODAL_SCOPE + "//a[normalize-space()='View Claim']")
    );
    console.log(`    🔢 View Claim links found: ${viewLinks.length}`);
    if (viewLinks.length === 0) return null;

    const ticketId = await readTicketIdFromViewClaimRow(driver);

    console.log(`    🎫 Extracted Ticket ID: ${ticketId || "<none>"}`);
    return ticketId || null;
}

// ---------------------------
// 🧰 Orchestrator — full claim form fill
// ---------------------------
async function fillClaimForm(driver, formData, tempPath, { resume = false, saveCtx = {} } = {}) {
    // Resume Claim: the draft already has every file uploaded from the
    // previous session — re-uploading them either fails or duplicates the
    // attachment, so we skip the file steps entirely (no downloads either)
    // and go straight to the checkbox + submit.
    if (resume) {
        console.log("🔁 Resume Claim: skipping file uploads (already present in draft)");
        await selectIssueCategory(driver, formData.issueCategory);
        await fillIssueCategoryConditionalInputs(driver, formData);
        await fillAdditionalInfo(driver, formData.additionalInfo);
        await tickConfirmationCheckbox(driver);
        await submitClaim(driver);
        return;
    }

    // Download every remote URL into tempPath so Selenium's sendKeys gets a
    // real on-disk path. URLs that are already local pass through.
    const archive = (srcPath, label) =>
        srcPath
            ? saveClaimResource({
                  srcPath,
                  companyId: saveCtx.companyId,
                  companyName: saveCtx.companyName,
                  awbNumber: saveCtx.awbNumber,
                  filename: `${label}${path.extname(srcPath) || ""}`,
              })
            : Promise.resolve();

    const shippingLabelPath = await downloadFile(
        formData.shippingLabelImage,
        "shipping_label",
        tempPath
    );
    await archive(shippingLabelPath, "shipping_label");
    const packingPaths = [];
    if (Array.isArray(formData.productPackingImages)) {
        for (let i = 0; i < formData.productPackingImages.length; i++) {
            const url = formData.productPackingImages[i];
            if (!url) continue;
            const local = await downloadFile(url, `packing_${i + 1}`, tempPath);
            packingPaths.push(local);
            await archive(local, `packing_${i + 1}`);
        }
    }
    const damagedVideoPath = formData.damagedVideo
        ? await downloadFile(formData.damagedVideo, "damaged_video", tempPath)
        : "";
    await archive(damagedVideoPath, "damaged_video");

    if (!shippingLabelPath) {
        throw new Error("Missing shipping label image — cannot submit Myntra claim");
    }
    if (packingPaths.length === 0) {
        throw new Error("No product packing images — at least one is required");
    }

    await selectIssueCategory(driver, formData.issueCategory);
    // Conditional inputs (Disputed Amount / Physical Received Sku) render
    // right below the Issue Category dropdown for two specific categories —
    // fill them before touching the file inputs so we don't leave them empty
    // when Submit is enabled.
    await fillIssueCategoryConditionalInputs(driver, formData);
    // Add → remove → add: the Myntra form occasionally drops the first
    // upload's preview; re-submitting after a remove yields a stable
    // "loaded" state before we move on to the packing images.
    await uploadShippingLabelProof(driver, shippingLabelPath);
    await removeShippingLabelProof(driver);
    await uploadShippingLabelProof(driver, shippingLabelPath);
    await uploadMultipleImagesForSection(
        driver,
        "Upload photo proof of product & outer packing",
        packingPaths
    );
    if (damagedVideoPath) {
        await uploadVideoProof(
            driver,
            "Upload video proof of damaged product or outer packaging",
            damagedVideoPath
        );
    }
    await fillAdditionalInfo(driver, formData.additionalInfo);
    await tickConfirmationCheckbox(driver);
    await submitClaim(driver);
}

// ---------------------------
// 🗂️ Archive claim assets (kept across runs)
// ---------------------------
// Persist every remote asset for a configEntry (shipping label, packing
// images, damaged video) into `<baseDir>/files/<awbNumber>/` so the original
// inputs stay on disk even after the temp cleanup runs. Existing files for
// the same AWB are overwritten; failures on individual assets are logged but
// don't abort the rest of the iteration.
async function archiveClaimFiles(configEntry, baseDir) {
    const awbNumber = configEntry.awbNumber || configEntry.orderId || "unknown";
    const targetDir = path.join(baseDir, "files", String(awbNumber));
    await fs.ensureDir(targetDir);

    const assets = [];
    if (configEntry.shippingLabelImage) {
        assets.push({ url: configEntry.shippingLabelImage, name: "shipping_label" });
    }
    if (Array.isArray(configEntry.productPackingImages)) {
        configEntry.productPackingImages.forEach((url, i) => {
            if (url) assets.push({ url, name: `packing_${i + 1}` });
        });
    }
    if (configEntry.damagedVideo) {
        assets.push({ url: configEntry.damagedVideo, name: "damaged_video" });
    }

    const savedPaths = [];
    for (const { url, name } of assets) {
        if (!url || !url.startsWith("http")) continue;
        try {
            const response = await axios.get(url, { responseType: "arraybuffer", timeout: 30000 });
            const ext = path.extname(new URL(url).pathname) || ".tmp";
            const filePath = path.join(targetDir, `${name}${ext}`);
            await fs.writeFile(filePath, response.data);
            savedPaths.push(filePath);
            console.log(`    📦 Archived: ${name} -> ${filePath}`);
        } catch (err) {
            console.error(`    ❌ Failed to archive ${name}: ${err.message}`);
        }
    }
    return { dir: targetDir, savedPaths };
}

// ---------------------------
// 🔐 One-shot credential check (HTTP route entry point)
// ---------------------------
// Spawns its own driver, runs the standard `myntraLogin`, quits the driver.
// Never throws — the HTTP route maps the return value straight to the body.
//
// VERDICT RULE — a credential is called invalid ONLY when Myntra itself
// renders <div class="global_errorMessage__u64W2">Incorrect email or
// password.</div> on the login form. Every other failure (Akamai "Network
// Error", missed OS-level login click, flagged proxy IP, dashboard bundle
// rendering late, chromedriver refusing to start) proves nothing about the
// password, so the credential stays VERIFIED rather than being punished for
// our own infrastructure.
//
// Returns:
//   { success, badCredentials, confirmed, error?, warning? }
//     success       — the verdict. false ONLY on the credential banner.
//     badCredentials— true ONLY on the credential banner. Key on THIS field
//                     for any is_verified / "password changed" decision.
//     confirmed     — whether the run actually proved its verdict:
//                       true  + success:true  → reached the dashboard
//                       true  + success:false → saw the banner
//                       false + success:true  → login failed for an unrelated
//                                               reason; verified by default,
//                                               nothing was proven. `warning`
//                                               carries the real error.
//
// `driver` is declared before the try/finally so a build-time failure
// (chromedriver missing, port binding, partial init) still routes through
// the guarded `quit()` and doesn't leak a zombie Chrome.
async function checkMyntraCredentials({ username, password, loginUrl } = {}) {
    if (!username || !password) {
        // Nothing to check — not a verdict about a credential, so
        // badCredentials stays false and callers must not unverify on it.
        return {
            success: false,
            badCredentials: false,
            confirmed: false,
            error: "Missing username or password",
        };
    }
    let driver = null;
    try {
        // Use the same proxy-aware path as the main worker so the credential
        // check sees the same network conditions Myntra logins actually face.
        // postLogin:false — this route only answers "do these credentials
        // work?". The relationship-type modal and dashboard render are
        // irrelevant to that verdict and only add latency + false negatives.
        ({ driver } = await buildDriverAndLogin(
            { username, password, loginUrl },
            { accountEmail: username, postLogin: false }
        ));
        return { success: true, badCredentials: false, confirmed: true };
    } catch (err) {
        const msg = (err && err.message ? err.message : "Login failed.")
            .replace(/^(?:LOGIN_FAILED|INVALID_CREDENTIALS):\s*/, "");

        // Myntra explicitly rejected the email/password pair — the only
        // evidence that justifies failing the credential.
        if (isInvalidCredentialsError(err)) {
            console.log(`🔒 [checkMyntraCredentials] ${username} → INVALID (banner: ${msg})`);
            return { success: false, badCredentials: true, confirmed: true, error: msg };
        }

        // Everything else: our side broke, not theirs. Report verified and
        // surface the real cause under `warning` so the run is still
        // debuggable and monitoring can spot a check that proved nothing.
        console.warn(
            `⚠️ [checkMyntraCredentials] ${username} → login failed without a credential banner ` +
            `(${msg}) — reporting VERIFIED (unconfirmed).`
        );
        return { success: true, badCredentials: false, confirmed: false, warning: msg };
    } finally {
        await destroyDriver(driver);
    }
}

module.exports = {
    buildDriver,
    buildDriverAndLogin,
    destroyDriver,
    getCurrentIp,
    downloadFile,
    myntraLogin,
    completePostLogin,
    handleRelationshipTypeModal,
    checkMyntraCredentials,
    navigateToCreateClaim,
    searchAndApplyClaim,
    probeAwbInSPFModal,
    selectIssueCategory,
    fillIssueCategoryConditionalInput,
    fillIssueCategoryConditionalInputs,
    uploadShippingLabelProof,
    removeShippingLabelProof,
    uploadMultipleImagesForSection,
    uploadVideoProof,
    fillAdditionalInfo,
    tickConfirmationCheckbox,
    submitClaim,
    fillClaimForm,
    getMyntraTicketId,
    archiveClaimFiles,
};
