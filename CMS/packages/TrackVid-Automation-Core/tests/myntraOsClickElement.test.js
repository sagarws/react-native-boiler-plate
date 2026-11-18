const test = require("node:test");
const assert = require("node:assert");
const { screenCandidates } = require("../platforms/myntra/common/osClickElement.js");

// The LOG IN button's screen position, from the page's own geometry. Numbers
// are a Chrome window on Windows; rect is the button in CSS pixels.
const button = { left: 740, top: 445, width: 440, height: 48 };

test("100 % scaling, maximised (screenX = -8): the button's centre, once", () => {
    const { candidates } = screenCandidates(
        {
            rect: button,
            screenPos: { x: -8, y: -8 },
            outer: { width: 1936, height: 1048 },
            inner: { width: 1920, height: 921 },
            screen: { width: 1920, height: 1080 },
            dpr: 1,
        },
        { width: 1920, height: 1080 }
    );

    // border 8; top chrome 1048 - 921 - 8 = 119
    assert.deepStrictEqual(candidates, [{ x: 960, y: 580, how: "calibrated×1.00" }]);
});

test("150 % display scaling: calibrated to physical pixels first, logical second", () => {
    const { candidates, scale } = screenCandidates(
        {
            rect: button,
            screenPos: { x: 0, y: 0 },
            outer: { width: 1280, height: 700 },
            inner: { width: 1264, height: 580 },
            screen: { width: 1280, height: 720 },
            dpr: 1.5,
        },
        { width: 1920, height: 1080 }
    );

    assert.strictEqual(scale, 1.5);
    // DIP centre: x = 0 + 8 + 740 + 220 = 968, y = 0 + 112 + 445 + 24 = 581
    assert.deepStrictEqual(candidates[0], { x: 1452, y: 872, how: "calibrated×1.50" });
    assert.deepStrictEqual(candidates[1], { x: 968, y: 581, how: "×1.00" });
    // dpr equals the calibrated scale, so it is not tried twice.
    assert.strictEqual(candidates.length, 2);
});

test("a robotjs that works in logical pixels on a scaled display: no scaling applied", () => {
    const { candidates } = screenCandidates(
        {
            rect: button,
            screenPos: { x: 100, y: 50 },
            outer: { width: 1200, height: 700 },
            inner: { width: 1184, height: 580 },
            screen: { width: 1280, height: 720 },
            dpr: 1.5,
        },
        { width: 1280, height: 720 }
    );

    assert.deepStrictEqual(candidates[0], { x: 1068, y: 631, how: "calibrated×1.00" });
    // dpr is still offered as a later guess.
    assert.deepStrictEqual(candidates[1], { x: 1602, y: 947, how: "×1.50" });
});

test("no screen size from robotjs: falls back to unscaled", () => {
    const { scale } = screenCandidates(
        {
            rect: button,
            screenPos: { x: 0, y: 0 },
            outer: { width: 1000, height: 700 },
            inner: { width: 1000, height: 600 },
            screen: { width: 1920, height: 1080 },
            dpr: 1,
        },
        null
    );

    assert.strictEqual(scale, 1);
});
