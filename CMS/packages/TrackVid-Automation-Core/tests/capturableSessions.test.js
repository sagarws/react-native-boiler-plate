const assert = require("node:assert/strict");
const { test } = require("node:test");

const { IDENTITY_PLATFORMS } = require("../common/sessionIdentity.js");
const { probablePlatforms } = require("../common/probeSession.js");
const { hasPageProbe, pageProbeScript, readPageProbe } = require("../common/sessionPageProbe.js");
const { getSessionExtras, platformsNeedingTokenCapture } = require("../common/sessionExtras.js");

/**
 * Can a captured session be CHECKED before it is stored — and, on the desktop,
 * can the sign-in window close itself when it is done?
 *
 * Those are the same question. The window closes on the first "yes" to "does
 * this jar name a seller", so a platform nobody can ask about is a platform
 * where the operator must close the window by hand AND whatever they leave
 * behind is saved unexamined. Flipkart showed what the other failure looks
 * like: asked the WRONG way — without the csrf token its probe signs with — a
 * real sign-in came back "that is not a signed-in Flipkart login".
 *
 * So this pins which platform is answerable by which route. A new platform
 * whose capture nobody can verify should have to change this file and say so.
 */

/** Every platform a window sign-in can produce a cookie jar for. */
const WINDOW_CAPTURABLE = ["ajio", "flipkart", "meesho", "myntra", "nykaa", "snapdeal", "tatacliq"];

const answerable = (platform) =>
    IDENTITY_PLATFORMS.includes(platform) ||
    probablePlatforms().includes(platform) ||
    hasPageProbe(platform);

test("every window-capturable platform can be checked somehow", () => {
    const unanswerable = WINDOW_CAPTURABLE.filter((platform) => !answerable(platform));

    assert.deepEqual(
        unanswerable,
        [],
        `no way to verify a captured session for: ${unanswerable.join(", ")}`
    );
});

test("the two that need a browser have an in-page check, and only those two", () => {
    // Both are absent from the jar-based registries on purpose — AJIO needs the
    // browser's TLS fingerprint past Akamai, Tata CliQ's search is scoped to a
    // slave held server-side. The window IS a browser, so they are asked there.
    assert.equal(hasPageProbe("tatacliq"), true);
    assert.equal(hasPageProbe("ajio"), true);

    for (const platform of ["flipkart", "meesho", "snapdeal", "nykaa", "myntra"]) {
        assert.equal(
            hasPageProbe(platform),
            false,
            `${platform} answers from a jar — an in-page check would be a second definition of signed-in`
        );
    }
});

test("Nykaa's probe gets the portal id it refuses to run without", () => {
    /*
     * IT ANSWERS `false` WITHOUT MAKING A REQUEST when `portalId` is missing —
     * "Probe skipped — no portalId cached (treat as dead)". The login path
     * never hit that, because Nykaa's own response carries the id; a window
     * capture has no response to read, so a real sign-in was rejected. Zoho's
     * portalId is a per-tenant constant, so the capture can simply supply it.
     */
    const descriptor = getSessionExtras("nykaa");

    assert.ok(descriptor, "nykaa has no session-extras descriptor");
    assert.deepEqual(descriptor.required, ["portalId"]);
    assert.match(descriptor.fromJar([]).portalId, /^edbsn/);
});

test("the token platforms are not window-capturable at all", () => {
    // Delhivery and Xbees sign in with OAuth tokens that never appear as
    // cookies. There is nothing for a window to harvest, so there is nothing to
    // auto-close — the app refuses the window rather than opening one that
    // cannot work.
    assert.deepEqual(platformsNeedingTokenCapture(), ["delhivery", "xbees"]);

    for (const platform of platformsNeedingTokenCapture()) {
        assert.equal(WINDOW_CAPTURABLE.includes(platform), false);
    }
});

test("an in-page check reads a refusal as unknown, not as signed out", () => {
    // A page mid-navigation, or Cloudflare interposing, says nothing about the
    // session — and closing the window on it would throw away a live sign-in.
    assert.equal(readPageProbe("tatacliq", { status: 403 }), null);
    assert.equal(readPageProbe("tatacliq", { error: "Failed to fetch" }), null);
    assert.equal(readPageProbe("tatacliq", { html: "<html>please log in</html>" }), false);
    assert.equal(
        readPageProbe("tatacliq", { html: '<ul class="slaveList"><li id="58020">wms-blr (1296)</li></ul>' }),
        true
    );
});

test("AJIO waits for the id its request is addressed by", () => {
    // Until the extras read lands there is nothing to ask about, which is "come
    // back later" rather than a verdict.
    assert.equal(pageProbeScript("ajio", {}), null);
    assert.match(String(pageProbeScript("ajio", { userId: "42" })), /work-places/);
});
