const assert = require("node:assert/strict");
const path = require("node:path");
const { test } = require("node:test");

/**
 * Finding one AJIO return order by its number.
 *
 * AJIO's return report answers at most 31 days at a time, so the lookup walks
 * back through five such windows. These pin the windows themselves (no gaps, no
 * overlaps, none wider than AJIO allows), that the filter reaches AJIO as a
 * query parameter, and that the search stops at the first window that answers.
 */

const ROOT = path.resolve(__dirname, "..");

const { returnSearchWindows, findReturnOrder, fetchDropshipReport } = require(
    path.join(ROOT, "platforms/ajio/master-import/api-based-flow/reportView.js")
);

const DAY = 24 * 60 * 60 * 1000;
const days = (from, to) => (Date.parse(to) - Date.parse(from)) / DAY + 1;

/** A page whose `evaluate` answers from a script, recording every URL asked. */
const fakePage = (answer) => {
    const urls = [];

    return {
        urls,
        evaluate: async (_fn, url) => {
            urls.push(url);

            return { status: 200, text: JSON.stringify({ result: { rtvList: answer(url, urls.length) } }) };
        },
    };
};

test("five back-to-back windows of 31 days, newest first, ending today in IST", () => {
    // 2026-09-24 20:00 UTC is already the 25th in IST.
    const windows = returnSearchWindows({ months: 5, now: Date.parse("2026-09-24T20:00:00Z") });

    assert.equal(windows.length, 5);
    assert.equal(windows[0].to, "2026-09-25");

    for (const [i, window] of windows.entries()) {
        assert.equal(days(window.from, window.to), 31, `window ${i} is 31 days`);

        if (i > 0) {
            assert.equal(days(window.to, windows[i - 1].from), 2, `window ${i} ends the day before ${i - 1}`);
        }
    }
});

test("returnOrderNo goes on the query string; without it the URL is unchanged", async () => {
    const page = fakePage(() => []);

    await fetchDropshipReport(page, { reportType: "return", pobIds: ["P1"], from: "2026-09-01", to: "2026-09-24" });
    await fetchDropshipReport(page, {
        reportType: "return",
        pobIds: ["P1"],
        from: "2026-09-01",
        to: "2026-09-24",
        returnOrderNo: " RT229843479 ",
    });

    assert.ok(!page.urls[0].includes("returnOrderNo"));
    assert.ok(page.urls[1].endsWith("&returnOrderNo=RT229843479"));
});

test("stops at the first window that has the order, and drops rows for other orders", async () => {
    const page = fakePage((_url, call) =>
        call === 3
            ? [
                  { returnOrderNo: "RT1", pobId: "P1", ean: "A" },
                  { returnOrderNo: "RT1", pobId: "P1", ean: "B" },
                  { returnOrderNo: "RT2", pobId: "P1", ean: "C" },
              ]
            : []
    );

    const found = await findReturnOrder(page, { returnOrderNo: "RT1", pobIds: ["P1"] });

    assert.equal(found.searched, 3);
    assert.equal(page.urls.length, 3);
    assert.deepEqual(found.rows.map((r) => r.ean), ["A", "B"]);
    assert.ok(found.window);
});

test("asks all five windows and answers empty when the order is nowhere", async () => {
    const page = fakePage(() => []);

    const found = await findReturnOrder(page, { returnOrderNo: "RT404", pobIds: ["P1"] });

    assert.equal(page.urls.length, 5);
    assert.deepEqual(found, { rows: [], window: null, searched: 5 });
});
