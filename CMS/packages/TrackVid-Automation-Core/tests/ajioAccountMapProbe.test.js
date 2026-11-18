const assert = require("node:assert/strict");
const path = require("node:path");
const { test } = require("node:test");

/**
 * Which AJIO endpoint a mapping run asks FIRST, and how many calls that costs.
 *
 * A return is visible only under the POB that owns it, so a mapping probe has
 * to sweep the account's POBs — that much is unavoidable and is why 10 AWBs
 * across 5 POBs is 50 calls rather than 10.
 *
 * What WAS avoidable: two endpoints are swept, and the gamora/VMS one used to
 * go first. Every AWB therefore paid a full VMS sweep of every POB before the
 * pob-scoped vision list — the one the seller portal itself uses for this
 * question — was tried at all. On a five-POB account that is five wasted calls
 * per AWB, paid on all 148 rows of a run.
 *
 * These pin the order, and that a hit stops the sweep where it stands.
 */

const ROOT = path.resolve(__dirname, "..");
const calls = [];

/**
 * A page whose in-page fetch records the URL and answers from `reply`.
 *
 * `apiJson` reads `{ status, json, text }` — the PARSED body, not just the
 * text — so the harness has to return json or every response reads as empty.
 */
const fakePage = (reply) => ({
    evaluate: async (fn, url, ...rest) => {
        calls.push(String(url));

        const answer = reply(String(url), ...rest);

        return { status: answer.status, json: JSON.parse(answer.text), text: answer.text };
    },
});

const { probeAjioAwb } = require(
    path.join(ROOT, "platforms/ajio/account-mapping/api-based-flow/probeAwb.js")
);

const POBS = ["DV00332654", "DV00337096", "DV00332648", "DV00337098", "DV00354035"];
const AWB = "195042641534043";

/** The vision list's own shape, as the portal returns it. */
const visionHit = JSON.stringify({
    success: true,
    statusCode: 200,
    result: {
        dropshipReturnList: [{ returnOrderNo: "RT226346371", returnAwbNo: AWB }],
        pageNumber: 0,
        totalPages: 1,
    },
});
const visionEmpty = JSON.stringify({
    success: true,
    statusCode: 200,
    result: { dropshipReturnList: [], pageNumber: 0, totalPages: 0 },
});
const vmsEmpty = JSON.stringify({ result: [] });

const isVision = (url) => url.includes("/dashboard/dropship/return/pob/");
const isVms = (url) => url.includes("/gamora/vms/v1/return-orders");

const reset = () => {
    calls.length = 0;
};

test("the POB-scoped vision list is asked FIRST, not the VMS sweep", async () => {
    reset();
    // The AWB is on the third POB, as it would be in the portal.
    const page = fakePage((url) => ({
        status: 200,
        text: isVision(url) && url.includes(POBS[2]) ? visionHit : isVision(url) ? visionEmpty : vmsEmpty,
    }));

    const answer = await probeAjioAwb(page, AWB, { pobIds: POBS });

    assert.equal(answer.found, true);
    assert.equal(answer.scope.pobId, POBS[2]);
    // Every call made was the vision list — VMS was never reached, because
    // vision answered. Before the reorder, the first five were all VMS.
    assert.ok(calls.every(isVision), `expected only vision calls, got:\n${calls.join("\n")}`);
    // And it stopped at the POB that held it rather than finishing the sweep.
    assert.equal(calls.length, 3);
});

test("the sweep stops on the first POB that holds the return", async () => {
    reset();
    const page = fakePage((url) => ({
        status: 200,
        text: isVision(url) && url.includes(POBS[0]) ? visionHit : visionEmpty,
    }));

    await probeAjioAwb(page, AWB, { pobIds: POBS });

    // One call, not five: the cost of a mapped row is the POB it is found on,
    // not the number the account has.
    assert.equal(calls.length, 1);
});

test("VMS is still the fallback when vision misses on every POB", async () => {
    reset();
    const page = fakePage((url) => ({
        status: 200,
        text: isVision(url)
            ? visionEmpty
            : JSON.stringify({ result: [{ trackingNumber: AWB, returnOrderId: "RO-9" }] }),
    }));

    const answer = await probeAjioAwb(page, AWB, { pobIds: POBS });

    assert.equal(answer.found, true);
    // Vision first across all five, THEN VMS — the fallback is intact, it just
    // no longer runs before the endpoint that usually answers.
    assert.ok(calls.slice(0, POBS.length).every(isVision));
    assert.ok(isVms(calls[POBS.length]));
});

test("a return on none of the POBs is a clean miss, not an error", async () => {
    reset();
    const page = fakePage((url) => ({
        status: 200,
        text: isVision(url) ? visionEmpty : vmsEmpty,
    }));

    const answer = await probeAjioAwb(page, AWB, { pobIds: POBS });

    assert.equal(answer.found, false);
    // Both endpoints, every POB: 5 + 5. This is the worst case a mapping run
    // pays, and it is why an UNMAPPABLE row is the expensive one.
    assert.equal(calls.length, POBS.length * 2);
});
