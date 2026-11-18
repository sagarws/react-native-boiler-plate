const logger = require("../../../common/redactingLogger");

/**
 * Browser tweaks every Meesho automation needs before it drives a page.
 *
 * These sat in `master-import/script-based-flow/puppeteerHelpers.js` while the
 * CLAIM login also needed them, and it required them from
 * `claim-management/common/utils.js` — which does not export them. Destructuring
 * an absent export is silent in JavaScript, so `enableStealthMode` was undefined
 * and every Meesho Re-capture died on "enableStealthMode is not a function"
 * the moment it tried to sign in. Nothing failed at require time to point at it.
 *
 * They live here because two automation types use them, which is the rule: a
 * helper is pushed as far down as it is true and lifted only when a second
 * caller appears. `puppeteerHelpers` re-exports them so the master-import flow
 * and the package barrels are unchanged.
 *
 * `handleAdvertisementPopup` is still NOT here: the two trees keep their own
 * exact selectors, which are tested against the live portal and which a rewrite
 * would risk. What they now SHARE is the fallback — `common/dismissPopup.js`,
 * which matches a close control by what it is rather than what Meesho called it
 * this quarter. Both handlers try their own selectors first and fall through to
 * it, so a promo in markup neither knows is closed once rather than missed
 * twice.
 */

/**
 * Stealth tweaks to reduce bot detection on Meesho's portal.
 */
async function enableStealthMode(page) {
    await page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, "webdriver", { get: () => false });
    });

    await page.setUserAgent(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36"
    );

    await page.evaluateOnNewDocument(() => {
        delete window.__webdriver_evaluate;
        delete window.__selenium_evaluate;
        delete window.__webdriver_script_function;
        delete window.__webdriver_script_func;
        delete window.__webdriver_script_name;

        window.chrome = { runtime: {} };

        const originalQuery = window.navigator.permissions.query;
        window.navigator.permissions.query = (parameters) =>
            parameters.name === "notifications"
                ? Promise.resolve({ state: Notification.permission })
                : originalQuery(parameters);
    });
}

/**
 * Auto-accept Chrome's "password breach" / security dialogs that interrupt navigation.
 */
async function handleDialog(page) {
    page.on("dialog", async (dialog) => {
        try {
            const dialogMessage = dialog.message() || "";
            logger.info(`⚠️ Dialog detected: ${dialogMessage}`);
            await dialog.accept();
        } catch (err) {
            logger.warn(`⚠️ Dialog handler failed (ignored): ${err.message}`);
        }
    });
}

module.exports = { enableStealthMode, handleDialog };
