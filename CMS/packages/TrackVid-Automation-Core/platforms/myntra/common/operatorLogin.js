/**
 * Myntra sign-in typed by the OPERATOR, in the same real Chrome the automated
 * sign-in drives.
 *
 * WHY NOT A DESKTOP-APP WINDOW. Myntra's partner portal sits behind Akamai Bot
 * Manager, and its login POST is refused — shown on the form as "Network Error"
 * — unless the browser looks exactly like Chrome. The desktop app's Electron
 * window cannot: its user-agent can be edited, but its client hints
 * (`sec-ch-ua`), `navigator.userAgentData` and the rest of its fingerprint still
 * say Chromium-not-Chrome, and a UA that disagrees with them is precisely what
 * Akamai looks for. The automated sign-in never had the problem because it runs
 * the installed Google Chrome (`buildDriver`). This runs that same browser, so
 * a manual and an automatic sign-in now send the same headers from the same
 * binary — the operator's own clicks are real clicks, which is the other half
 * of what Akamai wants.
 *
 * Nothing is typed for the operator. Chrome opens on the login page, the
 * operator signs in, and once the dashboard renders the session is harvested
 * exactly as `loginMyntraApi` harvests it — including the hop that makes the
 * `partnersapi` host-scoped cookies (`erp.at`, `session`) visible.
 *
 * Closing Chrome cancels. The wait is bounded so a forgotten window does not
 * hold the capture open for ever.
 */

// Loaded on first use, not at require time: the Selenium helpers pull in
// selenium-webdriver and the proxy config, and a consumer that only walks this
// folder's barrel must not need either installed.
const seleniumHelpers = () => require("../claim-management/common/utils");

const API_BASE = "https://partnersapi.myntrainfo.com";
const DEFAULT_LOGIN_URL = "https://partners.myntrainfo.com/";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** The signed-in dashboard's nav — the same signal the automated sign-in waits on. */
async function onDashboard(driver) {
    const { By } = require("selenium-webdriver");

    try {
        return (await driver.findElements(By.id("Services"))).length > 0;
    } catch (_) {
        return false;
    }
}

/** WebDriver throws these once the operator has closed the browser. */
const isWindowGone = (error) =>
    /no such window|target window already closed|web view not found|session deleted|invalid session id|chrome not reachable|disconnected/i.test(
        String(error && error.message)
    );

async function readJar(driver) {
    const jar = {};

    for (const cookie of await driver.manage().getCookies()) {
        if (cookie && cookie.name) jar[cookie.name] = cookie.value;
    }

    return jar;
}

/**
 * @param {{ username: string, accountType?: string, loginUrl?: string }} credentials — no password:
 *        the operator types it. `accountType` picks the relationship-type modal's answer
 *        (Vendor vs Partner Seller), exactly as in the automated sign-in.
 * @param {object} [options]
 * @param {number} [options.timeoutMs=600000] how long to wait for the operator to finish
 * @param {number} [options.pollMs=2000] how often to look for the dashboard
 * @param {(message: string) => void} [options.onProgress]
 * @returns {Promise<Record<string, string>>} the cookie map, the same shape `loginMyntraApi` returns
 */
async function operatorLoginMyntra(credentials, { timeoutMs = 10 * 60 * 1000, pollMs = 2000, onProgress } = {}) {
    const username = credentials && credentials.username;

    if (!username) throw new Error("operatorLoginMyntra: credentials.username is required");

    const loginUrl = (credentials && credentials.loginUrl) || process.env.MYNTRA_LOGIN_URL || DEFAULT_LOGIN_URL;

    // No proxy session: this is the operator's own machine and connection, as
    // with every desktop sign-in.
    const { buildDriver, destroyDriver, completePostLogin } = seleniumHelpers();
    const driver = await buildDriver({ accountEmail: username });

    try {
        await driver.get(loginUrl);
        onProgress?.(`Sign in to Myntra as ${username} in the Chrome window — it closes by itself once you are in.`);

        const deadline = Date.now() + timeoutMs;
        let signedIn = false;

        while (Date.now() < deadline) {
            try {
                if (await onDashboard(driver)) {
                    signedIn = true;
                    break;
                }
            } catch (error) {
                if (isWindowGone(error)) break;
            }

            try {
                // Throws once the window is gone — the cancel signal.
                await driver.getCurrentUrl();
            } catch (error) {
                if (isWindowGone(error)) {
                    const err = new Error("The Chrome window was closed before signing in to Myntra finished");
                    err.code = "OPERATOR_CANCELLED";
                    throw err;
                }
            }

            await sleep(pollMs);
        }

        if (!signedIn) {
            const err = new Error(`Myntra sign-in was not completed within ${Math.round(timeoutMs / 60000)} minutes`);
            err.code = "OPERATOR_TIMEOUT";
            throw err;
        }

        // Post-login, exactly as the API sign-in runs it: dismiss the
        // relationship-type modal if it is up, never fail over it, and do not
        // wait for UI the session does not need.
        await completePostLogin(driver, credentials, { dashboardGate: false, modalBestEffort: true });

        let jar = await readJar(driver);

        if (!jar["erp.at"] || !jar["session"]) {
            // Host-scoped to partnersapi: one request there makes them visible.
            await driver.get(`${API_BASE}/api/boot/partners`);
            await sleep(1500);
            jar = { ...jar, ...(await readJar(driver)) };
        }

        if (!jar["erp.at"] || !jar["session"]) {
            const err = new Error(
                `Signed in, but Myntra did not issue its session cookies. Got: ${Object.keys(jar).join(", ") || "(none)"}`
            );
            err.code = "LOGIN_NO_COOKIES";
            throw err;
        }

        return jar;
    } finally {
        await destroyDriver(driver).catch(() => undefined);
    }
}

module.exports = { operatorLoginMyntra };
