const assert = require("node:assert/strict");
const { beforeEach, test } = require("node:test");

const { track, forget, openBrowserCount, closeAllBrowsers } = require("../common/openBrowsers.js");

/**
 * Ending the browsers this process has open, from outside the thing that opened
 * them.
 *
 * WHY IT HAS TO BE POSSIBLE. Every login closes its browser in a `finally`,
 * which happens when the STEP finishes — and a step is up to a minute. An
 * operator who signs out of the desktop app mid-run watched a marketplace
 * sign-in carry on for another 34 seconds, writing a result that could not be
 * saved because the token had just been cleared:
 *
 *   06:01:16  [session-update] 5/7 — flipkart · …
 *   06:01:21  User signed out
 *   06:01:50  Local flipkart sign-in failed
 *
 * A sign-in is safe to abandon — nothing is half-written at the marketplace and
 * the stored session is untouched — so the app ends it rather than waiting.
 */

const fakeDriver = () => {
    const calls = { quit: 0 };

    return { calls, quit: async () => { calls.quit += 1 } };
};

const fakeBrowser = () => {
    const calls = { close: 0 };

    return { calls, close: async () => { calls.close += 1 } };
};

beforeEach(async () => {
    await closeAllBrowsers();
});

test("ends a selenium driver and a puppeteer browser alike", async () => {
    // Two libraries, two method names, one registry — the caller should not
    // have to say which kind it handed over.
    const driver = track(fakeDriver());
    const browser = track(fakeBrowser());

    assert.equal(openBrowserCount(), 2);
    assert.equal(await closeAllBrowsers("the operator signed out"), 2);
    assert.equal(driver.calls.quit, 1);
    assert.equal(browser.calls.close, 1);
    assert.equal(openBrowserCount(), 0);
});

test("hands the handle straight back, so a launch can be wrapped inline", () => {
    const driver = fakeDriver();

    assert.equal(track(driver), driver);
});

test("forgets one that closed the ordinary way", async () => {
    // The owner's own `destroyDriver` already quit it. Quitting it again from
    // here is at best a wasted call and at worst an error on a dead session.
    const driver = track(fakeDriver());

    forget(driver);

    assert.equal(await closeAllBrowsers(), 0);
    assert.equal(driver.calls.quit, 0);
});

test("one that will not die does not stop the next one", async () => {
    // This runs while the app is tearing down. A browser that throws on quit
    // must not leave the one after it open — or stop the sign-out.
    const stubborn = track({ quit: async () => { throw new Error("wedged") } });
    const ordinary = track(fakeDriver());

    assert.equal(await closeAllBrowsers("test"), 2);
    assert.equal(ordinary.calls.quit, 1);
    assert.ok(stubborn);
});

test("closing twice is not an error", async () => {
    track(fakeDriver());

    await closeAllBrowsers();

    assert.equal(await closeAllBrowsers(), 0);
});
