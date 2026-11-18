const assert = require("node:assert/strict");
const path = require("node:path");
const { test } = require("node:test");

/**
 * The Delhivery "Domestic" list — `list_client_mappings`, read per credential
 * and offered on the claim form. axios is stubbed through the require cache, as
 * in delhiveryClaimApi.test.js, so the request it would send lands in `calls`.
 */

const ROOT = path.resolve(__dirname, "..", "..", "..");
const axiosPath = require.resolve("axios", { paths: [ROOT] });

const calls = [];
let replies = [];

const fakeAxios = (config) => {
    calls.push(config);
    const next = replies.shift();
    return Promise.resolve(typeof next === "function" ? next(config) : next);
};
fakeAxios.post = (url, data, config) => fakeAxios({ ...config, method: "post", url, data });

require.cache[axiosPath] = {
    id: axiosPath,
    filename: axiosPath,
    loaded: true,
    exports: fakeAxios,
    children: [],
    paths: [],
};

const { listDelhiveryDomestics, domesticFromMapping, LIST_URL } = require("../platforms/delhivery/common/domestics.js");

const row = (over = {}) => ({
    hq_client_id: "cms::client::20587acd-8e85-11ee-94c7-027599923d74",
    hq_client_name: "STYLEVERSE B2C",
    service_type: "DOMESTIC",
    mapping_status: "MAPPED",
    disabled: false,
    ...over,
});

const reset = (...next) => {
    calls.length = 0;
    replies = next;
};

test("reads hq_client_name from every usable mapping, with its HQ client id", async () => {
    reset({
        status: 200,
        // total_count 0 beside a populated results — results is the truth.
        data: {
            total_count: 0,
            results: [
                row(),
                row({ hq_client_id: "cms::client::b", hq_client_name: "STYLEVERSE SURFACE" }),
            ],
            last_evaluated_key: null,
        },
    });

    const { domestics, refreshed } = await listDelhiveryDomestics({ accessToken: "t" });

    assert.deepEqual(domestics, [
        { id: "cms::client::20587acd-8e85-11ee-94c7-027599923d74", name: "STYLEVERSE B2C", serviceType: "DOMESTIC" },
        { id: "cms::client::b", name: "STYLEVERSE SURFACE", serviceType: "DOMESTIC" },
    ]);
    assert.equal(refreshed, null);
    assert.equal(calls[0].url, LIST_URL);
    assert.equal(calls[0].method, "get");
    assert.equal(calls[0].headers.authorization, "Bearer t");
});

test("drops disabled, unmapped, nameless and duplicate mappings", () => {
    assert.equal(domesticFromMapping(row({ disabled: true })), null);
    assert.equal(domesticFromMapping(row({ mapping_status: "PENDING" })), null);
    assert.equal(domesticFromMapping(row({ hq_client_name: "  " })), null);
    assert.equal(domesticFromMapping(null), null);
});

test("follows last_evaluated_key until the listing ends", async () => {
    reset(
        { status: 200, data: { results: [row()], last_evaluated_key: "k1" } },
        { status: 200, data: { results: [row({ hq_client_id: "cms::client::c", hq_client_name: "C" }), row()], last_evaluated_key: null } }
    );

    const { domestics } = await listDelhiveryDomestics({ accessToken: "t" });

    assert.equal(calls.length, 2);
    assert.deepEqual(calls[1].params, { last_evaluated_key: "k1" });
    assert.deepEqual(domestics.map((d) => d.name), ["STYLEVERSE B2C", "C"]);
});

test("refreshes an expired token once and retries", async () => {
    reset(
        { status: 401, data: {} },
        { status: 200, data: { access_token: "fresh", refresh_token: "r2", expires_in: 600 } },
        { status: 200, data: { results: [row()] } }
    );

    const { domestics, refreshed } = await listDelhiveryDomestics({
        accessToken: "stale",
        refreshToken: "r1",
        realm: "ucp-X",
    });

    assert.equal(domestics.length, 1);
    assert.equal(refreshed.accessToken, "fresh");
    assert.equal(calls[2].headers.authorization, "Bearer fresh");
});

test("a refused session throws rather than returning an empty list", async () => {
    reset({ status: 403, data: {} });

    await assert.rejects(listDelhiveryDomestics({ accessToken: "t" }), /HTTP 403/);
});
