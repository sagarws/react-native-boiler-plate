// -----------------------------------------------------------------------------
// OS-level click ON AN ELEMENT — wherever this screen happens to paint it
// -----------------------------------------------------------------------------
// Myntra's LOG IN must be clicked through the OS input pipeline (see
// ../../../common/osInput.js), which means turning the
// button's place in the PAGE into a place on the SCREEN. The old arithmetic
// did that for one layout and missed on others:
//
//   • DISPLAY SCALING. Page and window geometry are in CSS / DIP pixels. On a
//     Windows display at 125 % or 150 %, a DPI-aware robotjs moves in PHYSICAL
//     pixels, so the click landed up-and-left of the button by the scale factor.
//   • THE WINDOW BORDER. `outerWidth - innerWidth` is BOTH side borders, not
//     the left one — and the bottom border was being counted as top chrome.
//   • A MAXIMISED WINDOW reports screenX/Y = -8 on Windows; correct, as long as
//     the borders are accounted for as above.
//
// So the scale is CALIBRATED rather than assumed — robotjs's own screen size
// against the page's `screen.width` gives exactly the factor between the two
// coordinate spaces, whichever robotjs build this is and whatever the scaling —
// and every position is VERIFIED before clicking: the mouse is moved, and the
// page is asked whether the button is now under it (`:hover`). The first
// candidate the page confirms is clicked. Works for any resolution, scaling,
// window size or position, on Windows, macOS and Linux (Xvfb: scale 1).
//
// MYNTRA_LOGIN_CLICK_X / _Y still override everything, as before.
// -----------------------------------------------------------------------------

const { loadOsInput, osInputUnavailableError } = require("../../../common/osInput.js");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Time for the browser to see the OS mouse move and update `:hover`. */
const HOVER_SETTLE_MS = 250;

/** Where the element and the window are, in the page's own (CSS/DIP) units. */
async function readGeometry(driver, element) {
    return driver.executeScript(function (el) {
        const rect = el.getBoundingClientRect();

        return {
            rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
            screenPos: { x: window.screenX, y: window.screenY },
            outer: { width: window.outerWidth, height: window.outerHeight },
            inner: { width: window.innerWidth, height: window.innerHeight },
            screen: { width: window.screen.width, height: window.screen.height },
            dpr: window.devicePixelRatio,
        };
    }, element);
}

/**
 * The element's centre on screen, in DIPs, and the candidate positions to try
 * in robotjs's space — most likely first.
 *
 * Exported for tests: pure arithmetic over `readGeometry`'s answer.
 */
function screenCandidates(geometry, robotScreen) {
    const { rect, screenPos, outer, inner, screen, dpr } = geometry;
    // One side border; the bottom border is the same width, so the top chrome
    // (title bar + tabs + address bar) is what is left of the height after it.
    const border = Math.max(0, (outer.width - inner.width) / 2);
    const top = Math.max(0, outer.height - inner.height - border);
    const x = screenPos.x + border + rect.left + rect.width / 2;
    const y = screenPos.y + top + rect.top + rect.height / 2;

    const scale =
        robotScreen && robotScreen.width > 0 && screen.width > 0 ? robotScreen.width / screen.width : 1;
    const factors = [scale, 1, dpr].filter(
        (factor, index, all) =>
            Number.isFinite(factor) && factor > 0 && all.findIndex((other) => Math.abs(other - factor) < 0.01) === index
    );

    return {
        centre: { x, y },
        scale,
        candidates: factors.map((factor) => ({
            x: Math.round(x * factor),
            y: Math.round(y * factor),
            how: factor === scale ? `calibrated×${factor.toFixed(2)}` : `×${factor.toFixed(2)}`,
        })),
    };
}

/** Is the OS mouse over the element, as far as the page can tell? */
async function isHovered(driver, element) {
    try {
        return await driver.executeScript("return arguments[0].matches(':hover');", element);
    } catch (_) {
        return false;
    }
}

/**
 * Clicks `element` with the OS mouse, `times` times, `gapMs` apart.
 *
 * @returns {Promise<{ x: number, y: number, source: string, verified: boolean }>}
 *          where it clicked, how that position was arrived at, and whether the
 *          page confirmed the mouse was on the element before clicking.
 */
async function osClickElement(driver, element, { times = 3, gapMs = 500, log = console.log } = {}) {
    const robot = loadOsInput();
    if (!robot) throw osInputUnavailableError();

    const click = async (x, y) => {
        robot.moveMouseSmooth(x, y);
        for (let i = 0; i < times; i++) {
            robot.mouseClick("left");
            if (i < times - 1) await sleep(gapMs);
        }
    };

    const envX = process.env.MYNTRA_LOGIN_CLICK_X ? parseInt(process.env.MYNTRA_LOGIN_CLICK_X, 10) : null;
    const envY = process.env.MYNTRA_LOGIN_CLICK_Y ? parseInt(process.env.MYNTRA_LOGIN_CLICK_Y, 10) : null;

    if (envX != null && envY != null) {
        log(`🖱️  OS click at (${envX}, ${envY}) [source=env] × ${times}`);
        await click(envX, envY);
        return { x: envX, y: envY, source: "env", verified: false };
    }

    const geometry = await readGeometry(driver, element);
    const robotScreen = typeof robot.getScreenSize === "function" ? robot.getScreenSize() : null;
    const { centre, scale, candidates } = screenCandidates(geometry, robotScreen);

    log(
        `📐 element centre (${Math.round(centre.x)}, ${Math.round(centre.y)}) DIP ` +
        `| scale=${scale.toFixed(2)} (robot ${robotScreen ? `${robotScreen.width}×${robotScreen.height}` : "?"} ` +
        `/ page ${geometry.screen.width}×${geometry.screen.height}) | dpr=${geometry.dpr} ` +
        `| window=${JSON.stringify(geometry.screenPos)} outer=${JSON.stringify(geometry.outer)} ` +
        `inner=${JSON.stringify(geometry.inner)}`
    );

    for (const candidate of candidates) {
        robot.moveMouseSmooth(candidate.x, candidate.y);
        await sleep(HOVER_SETTLE_MS);

        if (await isHovered(driver, element)) {
            log(`🖱️  OS click at (${candidate.x}, ${candidate.y}) [${candidate.how}, hover confirmed] × ${times}`);
            await click(candidate.x, candidate.y);
            return { x: candidate.x, y: candidate.y, source: candidate.how, verified: true };
        }
    }

    // Nothing confirmed — an overlay can swallow :hover, for one. The
    // calibrated position is still the best estimate, so it is clicked rather
    // than giving up a sign-in that is otherwise ready.
    const best = candidates[0];
    log(
        `⚠️ hover never confirmed on the element — clicking the calibrated position ` +
        `(${best.x}, ${best.y}) anyway × ${times}`
    );
    await click(best.x, best.y);
    return { x: best.x, y: best.y, source: `${best.how} (unconfirmed)`, verified: false };
}

module.exports = { osClickElement, screenCandidates };
