// -----------------------------------------------------------------------------
// The browsers this process has open, so somebody can end them
// -----------------------------------------------------------------------------
// Every login here opens a real browser and closes it in a `finally`. That is
// correct and it is not enough: the close happens when the STEP finishes, and
// some steps are a minute long. An operator who signs out of the desktop app
// mid-run watches a marketplace sign-in carry on without them — observed, and
// the reason this exists:
//
//   06:01:16  [session-update] 5/7 — flipkart · …     (a sign-in starts)
//   06:01:21  User signed out                          (stores cleared, token gone)
//   06:01:50  Local flipkart sign-in failed            (34s later, unsaveable)
//
// Nothing between those lines could have been saved — the access token the
// result is written with was cleared at 06:01:21 — so the browser spent half a
// minute driving a seller account for a company the app was no longer signed in
// to, in front of the next person to use the machine.
//
// A SIGN-IN IS SAFE TO ABANDON, which is what makes this different from a claim.
// Nothing is half-written at the marketplace and the stored session is
// untouched: the worst case is a login that has to be done again. So the
// desktop app ends them on sign-out rather than waiting for a step boundary.
//
// Registration is the owner's job and must be paired. `track` returns the
// handle it was given, so a caller can wrap a launch in one line, and `forget`
// is called by the same `destroyDriver`/close that was already there.
// -----------------------------------------------------------------------------

/** @type {Set<{ quit?: () => Promise<void>, close?: () => Promise<void> }>} */
const open = new Set();

/**
 * Remember a browser for as long as it is open.
 *
 * @template T
 * @param {T} browser a selenium driver (`quit`) or a puppeteer browser (`close`)
 * @returns {T} the same handle, so this can wrap a launch inline
 */
function track(browser) {
    if (browser) open.add(browser);

    return browser;
}

/** Stop remembering one — its owner has closed it the ordinary way. */
function forget(browser) {
    open.delete(browser);
}

/** How many are open right now. For a log line, and for the test. */
const openBrowserCount = () => open.size;

/**
 * End every browser this process has open.
 *
 * Best effort and never throws: this is called from a path that is tearing
 * things down, and one browser that will not die must not stop the next one.
 *
 * @param {string} [reason] what to say in the log
 * @returns {Promise<number>} how many were asked to close
 */
async function closeAllBrowsers(reason = "") {
    const browsers = [...open];

    open.clear();

    if (browsers.length === 0) return 0;

    console.log(
        `🧹 [browsers] closing ${browsers.length} open browser(s)${reason ? ` — ${reason}` : ""}`
    );

    await Promise.all(
        browsers.map(async (browser) => {
            try {
                if (typeof browser.quit === "function") await browser.quit();
                else if (typeof browser.close === "function") await browser.close();
            } catch (err) {
                // Already gone, or wedged. Either way there is nothing else to
                // do about it and nothing that should stop the sign-out.
                console.warn(`⚠️ [browsers] one would not close: ${err.message}`);
            }
        })
    );

    return browsers.length;
}

module.exports = { track, forget, openBrowserCount, closeAllBrowsers };
