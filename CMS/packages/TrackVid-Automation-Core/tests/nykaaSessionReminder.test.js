const assert = require("node:assert/strict");
const path = require("node:path");
const { test } = require("node:test");

const {
    skipConcurrentSessionReminder,
    dismissTerminateSessionsPopup,
} = require(path.resolve(__dirname, "..", "platforms/nykaa/claim-management/common/utils.js"));

/**
 * Nykaa's "You're nearing your concurrent session limit" page.
 *
 * It offers two ways out and only one of them is ours to take:
 *
 *   Terminate all other sessions — ends every session the account holds. The
 *     observed page said forty-five, belonging to other machines and other
 *     people, including any run in flight elsewhere.
 *   Skip for now — `<a class="remind_me_later">`, costs nothing.
 *
 * The cap is fifty and the page is a WARNING: nothing is blocked yet, so the
 * automation has no business terminating anyone. That is the rule these pin.
 *
 * They also pin the bug that led here: the login handled only the DAILY
 * sign-in interstitial, whose `#continue_button` does not move this page on,
 * so the poll dismissed the same screen five times and gave up.
 */

/** A frame that owns some selectors and records what was clicked. */
const frame = (selectors, clicks) => ({
    $: async (selector) =>
        selectors.includes(selector)
            ? { click: async () => clicks.push(selector) }
            : null,
    $eval: async () => {
        throw new Error("no summary node");
    },
});

const fakePage = (frames, clicks) => ({
    frames: () => frames,
    waitForNavigation: async () => {
        clicks.push("navigated");
    },
});

test("clicks 'Skip for now' on the concurrent-session reminder", async () => {
    const clicks = [];
    const page = fakePage([frame(["a.remind_me_later"], clicks)], clicks);

    assert.equal(await skipConcurrentSessionReminder(page), true);
    assert.ok(clicks.includes("a.remind_me_later"), `expected the skip link, got ${clicks}`);
});

test("NEVER clicks 'Terminate all other sessions' on that page", async () => {
    const clicks = [];
    // Both controls are on the page, as they are in the portal.
    const page = fakePage(
        [frame(["a.remind_me_later", "button.terminate-sessions", "#continue_button"], clicks)],
        clicks
    );

    await skipConcurrentSessionReminder(page);

    assert.ok(
        !clicks.some((selector) => /terminate/i.test(selector)),
        "terminating forty-five sessions belonging to other machines is never this run's call"
    );
});

test("finds the link inside the login iframe, not only the parent document", async () => {
    const clicks = [];
    // Where sign-in finishes decides which document the page renders in.
    const page = fakePage([frame([], clicks), frame(["a.remind_me_later"], clicks)], clicks);

    assert.equal(await skipConcurrentSessionReminder(page), true);
});

test("is a no-op when the reminder is not showing", async () => {
    const clicks = [];
    const page = fakePage([frame(["#continue_button"], clicks)], clicks);

    // False, so the caller falls through to the daily-limit handler rather
    // than restarting its poll for nothing.
    assert.equal(await skipConcurrentSessionReminder(page), false);
    assert.deepEqual(clicks, []);
});


/**
 * The CONFIRM popup — "You will be signed out of all other 47 existing
 * sessions" — and why its Terminate button would not take.
 *
 * `elementHandle.click()` clicks the middle of where Puppeteer thinks the
 * element is, which lands on whatever is on top. This popup is drawn over a
 * dimmed backdrop, so the click went to the overlay: the button was found, the
 * click reported success, and the popup stayed open until the poll expired.
 *
 * `el.click()` inside the page dispatches on the element itself, so nothing
 * can be in front of it.
 */

/** A popup whose backdrop swallows coordinate clicks, as the real one does. */
const popupFrame = (options = {}) => {
    const { swallowHandleClick = true, closesOnDomClick = true } = options;
    const state = { open: true, domClicks: 0, handleClicks: 0 };
    const button = {
        click: async () => {
            state.handleClicks += 1;
            // The overlay ate it: the popup is still there afterwards.
            if (!swallowHandleClick) state.open = false;
        },
    };

    return {
        state,
        frame: {
            $: async (selector) => {
                if (!selector.includes("confirm-delete_btn")) return null;

                return state.open ? button : null;
            },
            $eval: async () => "You will be signed out of all other 47 existing sessions.",
            evaluate: async (fn, el) => {
                // `el.click()` — dispatched on the element, not at a point.
                if (el === button) {
                    state.domClicks += 1;
                    if (closesOnDomClick) state.open = false;
                }

                return undefined;
            },
        },
    };
};

const pageOf = (frame) => ({ frames: () => [frame], waitForNavigation: async () => {} });

test("closes the Terminate popup with an in-page click, not a coordinate one", async () => {
    const { state, frame } = popupFrame();

    assert.equal(await dismissTerminateSessionsPopup(pageOf(frame)), true);
    // The DOM click is what did it — and the handle click was never needed.
    assert.equal(state.domClicks, 1);
    assert.equal(state.handleClicks, 0);
    assert.equal(state.open, false);
});

test("falls back to a real click when the DOM click does not close it", async () => {
    // Some listeners want genuine pointer events; the fallback covers that.
    const { state, frame } = popupFrame({ closesOnDomClick: false, swallowHandleClick: false });

    assert.equal(await dismissTerminateSessionsPopup(pageOf(frame)), true);
    assert.equal(state.domClicks, 1);
    assert.equal(state.handleClicks, 1);
});

test("reports FALSE when the popup will not close, rather than claiming success", async () => {
    // The bug's own shape. Returning true here sends the caller off to poll for
    // a dashboard that is still behind the popup, and it spends its whole
    // budget doing so — which is exactly what the run did.
    const { frame } = popupFrame({ closesOnDomClick: false, swallowHandleClick: true });

    assert.equal(await dismissTerminateSessionsPopup(pageOf(frame)), false);
});
