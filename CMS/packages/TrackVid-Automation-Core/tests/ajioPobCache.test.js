const assert = require("node:assert/strict");
const path = require("node:path");
const { test } = require("node:test");

/**
 * How many times a bulk run asks AJIO for the same work-places list.
 *
 * `getPobRecord` reads the seller's WHOLE list (size=100) and picks one entry
 * out of it in memory. Claims arrive in batches from the same warehouse, so a
 * run of N rows under one POB asked for the same list N times — 10 identical
 * responses for ten claims, 500 for five hundred.
 *
 * The cache is OPT-IN, so these pin both halves: passing nothing must behave
 * exactly as it did, and passing a Map must collapse the repeats without
 * changing a single record the caller receives.
 */

const ROOT = path.resolve(__dirname, "..");

const { getPobRecord } = require(
    path.join(ROOT, "platforms/ajio/claim-management/api-based-flow/returnDeliveredClaimApiFlow.js")
);

const POB = "DV00352054";
const OTHER_POB = "DV00337096";

const workPlaces = (ids) => ({
    content: ids.map((id) => ({
        id,
        storeName: `Store ${id}`,
        address: { pinCode: "400001" },
        integrationType: "VMS_OMSGURU",
        businessModel: "B2C",
        mobileNumber: "9999999999",
        emailId: `${id}@example.com`,
        fulfilmentType: "DROPSHIP",
    })),
});

/** Records every URL asked for, and answers with the work-places list. */
const fakePage = (calls, ids = [POB, OTHER_POB]) => ({
    evaluate: async (fn, url) => {
        calls.push(String(url));

        const text = JSON.stringify(workPlaces(ids));

        return { status: 200, json: JSON.parse(text), text };
    },
});

test("without a cache, every claim asks for the work-places list again", async () => {
    const calls = [];
    const page = fakePage(calls);

    for (let i = 0; i < 10; i++) {
        await getPobRecord(page, "SELLER1", POB);
    }

    assert.equal(calls.length, 10, "the default must stay exactly as it was");
});

test("with a cache, ten claims under one POB ask once", async () => {
    const calls = [];
    const page = fakePage(calls);
    const pobCache = new Map();

    const records = [];

    for (let i = 0; i < 10; i++) {
        records.push(await getPobRecord(page, "SELLER1", POB, { pobCache }));
    }

    assert.equal(calls.length, 1, "ten claims, one work-places request");
    // The saving must not change the answer: every caller gets the same record
    // it would have got from its own request.
    for (const record of records) {
        assert.deepEqual(record, records[0]);
        assert.equal(record.id, POB);
        assert.equal(record.storeName, `Store ${POB}`);
        assert.equal(record.integrationType, "VMS_OMSGURU");
    }
});

test("a second POB is its own entry, not a hit on the first", async () => {
    const calls = [];
    const page = fakePage(calls);
    const pobCache = new Map();

    const first = await getPobRecord(page, "SELLER1", POB, { pobCache });
    const second = await getPobRecord(page, "SELLER1", OTHER_POB, { pobCache });
    await getPobRecord(page, "SELLER1", POB, { pobCache });

    assert.equal(calls.length, 2, "one request per distinct POB, then cached");
    assert.equal(first.id, POB);
    assert.equal(second.id, OTHER_POB);
});

/**
 * `runAccountGroup` re-reads sellerId after a re-authentication, and a record
 * fetched under one seller is not an answer about another.
 */
test("the seller is part of the key", async () => {
    const calls = [];
    const page = fakePage(calls);
    const pobCache = new Map();

    await getPobRecord(page, "SELLER1", POB, { pobCache });
    await getPobRecord(page, "SELLER2", POB, { pobCache });

    assert.equal(calls.length, 2, "same POB, different seller, must re-read");
    assert.match(calls[0], /sellers\/SELLER1\//);
    assert.match(calls[1], /sellers\/SELLER2\//);
});

/**
 * A miss is a statement about one request, not about the POB. Caching it would
 * fail every remaining row for that POB with no way back inside the run.
 */
test("a POB missing from the list is not cached, so the next row retries", async () => {
    const calls = [];
    const pobCache = new Map();
    let ids = [OTHER_POB]; // the wanted POB is absent from this response
    const page = {
        evaluate: async (fn, url) => {
            calls.push(String(url));

            const text = JSON.stringify(workPlaces(ids));

            return { status: 200, json: JSON.parse(text), text };
        },
    };

    await assert.rejects(() => getPobRecord(page, "SELLER1", POB, { pobCache }), /not found in work-places/);

    ids = [POB, OTHER_POB]; // the list comes back complete

    const record = await getPobRecord(page, "SELLER1", POB, { pobCache });

    assert.equal(calls.length, 2, "the failed lookup must not be remembered");
    assert.equal(record.id, POB);
});
