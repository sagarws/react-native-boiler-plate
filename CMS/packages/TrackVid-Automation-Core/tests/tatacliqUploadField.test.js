const assert = require("node:assert/strict");
const { test } = require("node:test");

const { uploadProofImage } = require("../platforms/tatacliq/claim-management/api-based-flow/claimApiFlow.js");

/**
 * The QC Panel's own Submit uploads each image with
 *   startCsvUpload_(…, "imgFile_" + tranx + "_" + i)  →  data.append(_fullTrnx, file)
 * so the multipart FIELD NAME carries the transaction and the slot. Under the
 * modal input's name (`imgFile_{n}`) the portal answered "Problem occured while
 * uploading Images" (2026-10-30); under `imgFile_{transId}_{n}` it stored
 * /images/courierInbound/slave_…/{transId}/{transId}_{n}.png.
 */

function fakePage(answer) {
    const seen = {};

    return {
        seen,
        evaluate: async (_fn, url, field, b64, name) => {
            Object.assign(seen, { url, field, name });

            return { status: 200, ok: true, text: answer };
        },
    };
}

test("posts under imgFile_{transId}_{slot}", async () => {
    const page = fakePage("/images/courierInbound/slave_X/129602063011577/129602063011577_1.png");

    const result = await uploadProofImage(page, {
        transId: "129602063011577",
        slot: 1,
        base64: "AAAA",
        fileName: "probe.png",
    });

    assert.equal(page.seen.field, "imgFile_129602063011577_1");
    assert.match(page.seen.url, /flag=uploadImgFlag$/);
    assert.deepEqual(result, {
        fileName: "129602063011577_1.png",
        path: "/images/courierInbound/slave_X/129602063011577/129602063011577_1.png",
    });
});

test("the portal's refusal is reported, never passed on as a file", async () => {
    const page = fakePage("Problem occured while uploading Images. Please contact Tech Support Team.");

    await assert.rejects(
        uploadProofImage(page, { transId: "T", slot: 2, base64: "AAAA" }),
        /not a stored path: Problem occured/
    );
});
