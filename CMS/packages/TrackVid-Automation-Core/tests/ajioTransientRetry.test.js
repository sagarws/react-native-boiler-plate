const assert = require("node:assert/strict");
const path = require("node:path");
const { test } = require("node:test");

/**
 * AJIO answering 503 — asked again, for reads only.
 *
 * 2026-11-04: a bulk NDR run of 400+ claims failed most rows on
 * "work-places failed: …Service Unavailable… (HTTP 503)" and "return-order
 * detail failed: Seller data could not be retrieved! Response status code -
 * 503", and nearly all of them filed on a manual Retry. Each request was tried
 * once. These pin the three rules: busy is retried, an answer is not, and a
 * request that changes something (POST/PUT) is never repeated.
 */

const ROOT = path.resolve(__dirname, "..");
const { withTransientRetry, isTransientFailure } = require(
    path.join(ROOT, "platforms/ajio/claim-management/api-based-flow/common/transientRetry.js")
);
const { getPobRecord } = require(
    path.join(ROOT, "platforms/ajio/claim-management/api-based-flow/returnDeliveredClaimApiFlow.js")
);

const NO_WAIT = [0, 0, 0];
const quiet = { warn() {}, error() {} };
const GATEWAY_503 = { status: 503, text: "<html><body><b>Http/1.1 Service Unavailable</b></body></html>" };
const ok = (json = {}) => ({ status: 200, json, text: JSON.stringify(json) });

/** A `send` that answers each call with the next response in `script`. */
const scripted = (script) => {
    const send = async () => send.calls.push(1) && script[Math.min(send.calls.length - 1, script.length - 1)];
    send.calls = [];
    return send;
};

test("what counts as AJIO being busy", () => {
    assert.equal(isTransientFailure(GATEWAY_503), true);
    assert.equal(isTransientFailure({ status: 502, text: "" }), true);
    assert.equal(isTransientFailure({ status: 504, text: "" }), true);
    assert.equal(isTransientFailure({ status: -1, text: "TypeError: Failed to fetch" }), true);
    // AJIO's own 5xx wrapping the seller service's 503 — the return-order case.
    assert.equal(
        isTransientFailure({
            status: 500,
            text: '{"errorMessage":"Seller data could not be retrieved! Response status code - 503, response - <html>…"}',
        }),
        true
    );
});

test("an answer is not busy — a 4xx, or a 500 that names a real reason", () => {
    assert.equal(isTransientFailure({ status: 404, text: "No records found" }), false);
    assert.equal(isTransientFailure({ status: 400, text: "Service Unavailable" }), false);
    assert.equal(isTransientFailure({ status: 500, text: '{"errorMessage":"Invalid POB"}' }), false);
    assert.equal(isTransientFailure(ok()), false);
});

test("a busy GET is asked again until it answers", async () => {
    const send = scripted([GATEWAY_503, GATEWAY_503, ok({ fine: true })]);
    const res = await withTransientRetry(send, { method: "GET", delays: NO_WAIT, userLogger: quiet });

    assert.equal(send.calls.length, 3);
    assert.equal(res.status, 200);
});

test("gives up after the last delay and returns the busy answer as it was", async () => {
    const send = scripted([GATEWAY_503]);
    const res = await withTransientRetry(send, { method: "GET", delays: NO_WAIT, userLogger: quiet });

    assert.equal(send.calls.length, 4, "one try plus three retries");
    assert.equal(res.status, 503);
});

test("a POST or PUT is never repeated — it may already have raised the claim", async () => {
    for (const method of ["POST", "PUT"]) {
        const send = scripted([GATEWAY_503, ok()]);
        const res = await withTransientRetry(send, { method, delays: NO_WAIT, userLogger: quiet });

        assert.equal(send.calls.length, 1, `${method} sent once`);
        assert.equal(res.status, 503);
    }
});

test("an answer is returned at once, never retried", async () => {
    const send = scripted([{ status: 404, text: "No records found" }, ok()]);

    await withTransientRetry(send, { method: "GET", delays: NO_WAIT, userLogger: quiet });

    assert.equal(send.calls.length, 1);
});

test("the work-places read survives a 503 instead of failing the claim", async () => {
    // Through the real apiJson, with its real first delay (2 s).
    const list = { content: [{ id: "DV1", storeName: "S", address: { pinCode: "1" } }] };
    let calls = 0;
    const page = {
        evaluate: async () => (++calls === 1 ? GATEWAY_503 : ok(list)),
    };

    const record = await getPobRecord(page, "SELLER1", "DV1", { userLogger: quiet });

    assert.equal(calls, 2);
    assert.equal(record.id, "DV1");
});
