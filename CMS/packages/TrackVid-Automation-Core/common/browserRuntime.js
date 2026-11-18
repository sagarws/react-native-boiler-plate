// -----------------------------------------------------------------------------
// Which browser the logins drive, and where its binary lives
// -----------------------------------------------------------------------------
// The eight platform logins need a real browser. On the automation server that
// is `puppeteer`, which ships its own Chromium and finds it without help.
//
// Trackvid-CMS cannot use that. Bundling a second Chromium inside an Electron
// installer that already carries one is wasteful, and pointing at whatever
// Chrome the operator happens to have installed is worse: Chrome auto-updates,
// chromedriver must match its major version, and Selenium logins (Myntra,
// Flipkart) would break on random machines at random times — the hardest
// failure to support remotely.
//
// So the desktop app installs a PINNED Chrome-for-Testing on first run and
// tells this module where it is. Same logins, same code, explicit binary.
//
// Two things are resolved here:
//
//   loadPuppeteer()          `puppeteer` if present (server), else
//                            `puppeteer-core` (desktop). API-identical for
//                            everything the logins use; only the browser
//                            discovery differs, which is the other half.
//
//   chromeExecutablePath()   the binary to launch, or null to let puppeteer
//                            find its own. Set once at startup, like
//                            common/sessionPersistence.js.
//
// Deliberately not an environment variable on the desktop side: the app knows
// where it put the browser, and a path the operator cannot see is not a control.
// The server's existing NODE_ENV / production paths are untouched, so nothing
// about its behaviour changes.
// -----------------------------------------------------------------------------

const CANDIDATES = ["puppeteer", "puppeteer-core"];

let resolved;
let executablePath = null;
let driverPath = null;
let driverProvider = null;
let pinnedFallbackAllowed = true;

/** The puppeteer implementation available here, or null. */
function loadPuppeteer() {
    if (resolved !== undefined) return resolved;

    const tried = [];
    for (const name of CANDIDATES) {
        try {
            resolved = require(name);
            return resolved;
        } catch (err) {
            tried.push(`${name} (${(err.message || "").split("\n")[0]})`);
        }
    }

    resolved = null;
    console.warn(`⚠️ No puppeteer build available — tried ${tried.join("; ")}`);
    return resolved;
}

/**
 * Point the logins at a specific Chrome binary.
 *
 * Required when only `puppeteer-core` is installed, because it ships no
 * browser and cannot guess. Passing null restores "let puppeteer decide".
 */
function setChromeExecutablePath(binaryPath) {
    executablePath = binaryPath || null;
}

/** The configured binary, or null. */
function chromeExecutablePath() {
    return executablePath;
}

/**
 * The `executablePath` a launch should use.
 *
 * Order: an explicitly configured binary wins; otherwise the caller's own
 * fallback (the server's `/usr/bin/google-chrome` in production); otherwise
 * undefined, letting a full puppeteer find its bundled Chromium.
 *
 * Returns undefined rather than null because that is what puppeteer.launch
 * treats as "not specified".
 */
function resolveExecutablePath(fallback) {
    return executablePath || fallback || undefined;
}

/**
 * The binary to launch when the PLATFORM has its own opinion.
 *
 * The mirror of resolveExecutablePath: there, a process-wide setting wins over
 * a generic fallback; here, a platform's deliberate choice wins over the
 * process-wide setting.
 *
 * Myntra is why. Its login resolves the real, installed Google Chrome on
 * purpose — Chrome for Testing announces itself with a banner ("only for
 * automated testing") and fingerprints differently, and Myntra's sign-in is
 * behind Akamai. Overriding that with this app's pinned build is how a login
 * that used to work starts failing.
 *
 * @param {string|null|undefined} platformChoice what the platform resolved
 */
function preferExecutablePath(platformChoice) {
    return platformChoice || executablePath || undefined;
}

/**
 * Point the Selenium logins (Myntra, Flipkart) at a chromedriver.
 *
 * Selenium needs the driver binary as well as the browser, and the two must
 * match on major version — which is exactly why the desktop app pins both
 * rather than using whatever Chrome the operator has. On the server, Selenium
 * finds chromedriver on PATH and this stays null.
 */
function setChromedriverPath(binaryPath) {
    driverPath = binaryPath || null;
}

/** The configured chromedriver, or null to let Selenium find its own. */
function chromedriverPath() {
    return driverPath;
}

/**
 * How a consumer obtains a chromedriver for a browser it did NOT pin.
 *
 * WHY THIS HAD TO EXIST. A pinned browser and a pinned driver are a matched
 * pair, and `chromedriverPath` only ever describes that pair. Myntra launches a
 * different browser on purpose — the operator's real Chrome — and chromedriver
 * matches on MAJOR VERSION, so the pinned 131 driver cannot drive a Chrome 152.
 *
 * Selenium Manager is supposed to cover this: handed no service, selenium
 * downloads the matching driver itself. In a packaged desktop app it does not.
 * The first build to reach a real Chrome answered every re-capture with
 * "Unable to obtain browser driver" — Selenium Manager's own words — because
 * fetching one needs network the operator's machine may filter and a cache
 * directory it may not be able to write.
 *
 * So the consumer, which already downloads and caches browsers, is asked
 * instead. Registered, not imported: this package must not learn how the
 * desktop app stores anything.
 *
 * @param {(binaryPath: string) => Promise<string|null>|string|null} fn
 */
function setDriverProvider(fn) {
    driverProvider = typeof fn === "function" ? fn : null;
}

/**
 * The chromedriver for this browser, or null when there is none to be had.
 *
 * Null is not an error: the caller can still let Selenium Manager try, and
 * should still have somewhere to fall back to when that fails too.
 *
 * @param {string|null|undefined} binaryPath the browser about to be launched
 * @returns {Promise<string|null>}
 */
async function driverPathFor(binaryPath) {
    // The pinned pair, or no opinion at all — either way `driverPath` is the
    // answer, and it may itself be null.
    if (!binaryPath || binaryPath === executablePath) return driverPath;

    if (!driverProvider) return null;

    try {
        return (await driverProvider(binaryPath)) || null;
    } catch (err) {
        // A provider that could not fetch a driver has not broken anything: the
        // caller has a fallback, and it needs to know why it is taking it.
        console.warn(`⚠️ Could not obtain a chromedriver for ${binaryPath}: ${err.message}`);

        return null;
    }
}

/**
 * Whether a platform that names its own browser may substitute the pinned one.
 *
 * Myntra names the installed Google Chrome. When it cannot have it — no Chrome
 * on the machine, or no chromedriver to drive it — the default is to launch the
 * pinned Chrome for Testing instead: a sign-in that might be refused beats one
 * that never starts, and the server has always behaved that way.
 *
 * On the desktop that substitute is never accepted. Akamai answers it with
 * "Network Error" every time, under a "Chrome for Testing … only for automated
 * testing" banner, so the operator sees a broken login and a misleading cause.
 * The desktop turns this off and gets a plain "install Google Chrome" error
 * instead. Default true: a consumer that never calls this behaves as before.
 *
 * @param {boolean} allowed
 */
function setPinnedFallbackAllowed(allowed) {
    pinnedFallbackAllowed = allowed !== false;
}

/** See setPinnedFallbackAllowed. */
function pinnedFallbackIsAllowed() {
    return pinnedFallbackAllowed;
}

/** A Selenium ServiceBuilder for one explicit chromedriver, or null. */
function chromeServiceFor(binaryPath) {
    if (!binaryPath) return null;

    try {
        const chrome = require("selenium-webdriver/chrome");

        return new chrome.ServiceBuilder(binaryPath);
    } catch (err) {
        console.warn(`⚠️ chromedriver resolved but selenium-webdriver is unavailable: ${err.message}`);

        return null;
    }
}

/**
 * A Selenium ServiceBuilder for the configured chromedriver, or null.
 *
 * Returned rather than applied so the caller keeps ownership of its Builder
 * chain, and so a consumer without selenium-webdriver never loads it.
 */
function chromeServiceBuilder(options = {}) {
    if (!driverPath) return null;

    // The pinned driver belongs to the pinned browser and nothing else.
    // chromedriver must match Chrome's MAJOR version, so handing a 131 driver
    // to a system Chrome on 152 fails immediately. When a platform launches its
    // own binary, return null and let Selenium Manager (4.6+) fetch the driver
    // that actually matches it.
    if (options.binaryPath && options.binaryPath !== executablePath) {
        console.log(
            "🔧 Launching a platform-chosen Chrome, so Selenium will resolve its own matching chromedriver."
        );
        return null;
    }

    try {
        const chrome = require("selenium-webdriver/chrome");
        return new chrome.ServiceBuilder(driverPath);
    } catch (err) {
        console.warn(`⚠️ chromedriver configured but selenium-webdriver is unavailable: ${err.message}`);
        return null;
    }
}

/** The error to throw when a login needs a browser and none can be launched. */
function browserUnavailableError() {
    const err = new Error(
        "This sign-in needs a browser, and none is available: install `puppeteer`, " +
        "or install `puppeteer-core` and call setChromeExecutablePath() with a Chrome binary."
    );
    err.code = "BROWSER_UNAVAILABLE";
    return err;
}

module.exports = {
    loadPuppeteer,
    setChromeExecutablePath,
    chromeExecutablePath,
    resolveExecutablePath,
    preferExecutablePath,
    setChromedriverPath,
    chromedriverPath,
    setDriverProvider,
    driverPathFor,
    setPinnedFallbackAllowed,
    pinnedFallbackIsAllowed,
    chromeServiceFor,
    chromeServiceBuilder,
    browserUnavailableError,
    CANDIDATES,
};
