const assert = require("node:assert/strict");
const { beforeEach, test } = require("node:test");

const runtime = require("../common/browserRuntime.js");

/**
 * Which chromedriver drives which browser.
 *
 * A pinned browser and a pinned driver are a MATCHED PAIR — chromedriver
 * enforces the major version — and Myntra deliberately launches a browser from
 * outside that pair: the operator's own Chrome, because the pinned one is a
 * testing build that Akamai refuses. Something has to supply a driver for it.
 *
 * Selenium Manager is the usual answer and was the previous one here. Inside a
 * packaged desktop app it answered "Unable to obtain browser driver" on every
 * re-capture, so the consumer — which already downloads and caches browsers —
 * is asked instead. What these pin is the part that is easy to get wrong: when
 * NOT to ask, and that a provider which cannot deliver is not a failure.
 */

const PINNED_CHROME = "/pinned/chrome";
const PINNED_DRIVER = "/pinned/chromedriver";

beforeEach(() => {
    runtime.setChromeExecutablePath(PINNED_CHROME);
    runtime.setChromedriverPath(PINNED_DRIVER);
    runtime.setDriverProvider(null);
});

test("the pinned browser is driven by the pinned driver, without asking anyone", async () => {
    let asked = false;

    runtime.setDriverProvider(() => {
        asked = true;

        return "/downloaded/chromedriver";
    });

    assert.equal(await runtime.driverPathFor(PINNED_CHROME), PINNED_DRIVER);
    assert.equal(asked, false, "the pair is already matched — a download would be waste");
});

test("no binary at all means the pinned driver too", async () => {
    // "Let puppeteer decide" is the pinned browser by definition.
    assert.equal(await runtime.driverPathFor(null), PINNED_DRIVER);
});

test("another browser gets the driver the consumer supplies for it", async () => {
    const asked = [];

    runtime.setDriverProvider((binary) => {
        asked.push(binary);

        return "/downloaded/chromedriver-152";
    });

    assert.equal(
        await runtime.driverPathFor("C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"),
        "/downloaded/chromedriver-152"
    );
    assert.deepEqual(asked, ["C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"]);
});

test("no provider registered is null, not the pinned driver", async () => {
    // Handing back a 131 driver for a Chrome 152 would fail at launch with a
    // version-mismatch message that names neither of them.
    assert.equal(await runtime.driverPathFor("/usr/bin/google-chrome"), null);
});

test("a provider that cannot deliver is answered null, never a throw", async () => {
    // The machine may have no route to the download. That is a reason to fall
    // back to the pinned browser, not to fail the sign-in before it starts.
    runtime.setDriverProvider(() => {
        throw new Error("network unreachable");
    });

    assert.equal(await runtime.driverPathFor("/usr/bin/google-chrome"), null);

    runtime.setDriverProvider(async () => null);

    assert.equal(await runtime.driverPathFor("/usr/bin/google-chrome"), null);
});
