const assert = require("node:assert/strict");
const path = require("node:path");
const { test, beforeEach } = require("node:test");

/**
 * Refiling with the sub-order number Meesho's own search returned.
 *
 * THE FAILURE THIS ENDS. A claim died on
 * `CLAIM_REFUSED: Please enter a valid sub order number.` — on a return the
 * search had ALREADY located, whose real sub-order number was sitting in the
 * same response that found it. The row's number wins when both exist, which is
 * right most of the time because it is what the operator entered; but a row
 * imported with a stale or mistyped number sent something Meesho does not know,
 * and the run reported a refusal instead of using the answer it was holding.
 *
 * THREE RULES, and each is a way of not making it worse:
 *
 *   ONLY on that refusal. Any other failure is a different problem, and a
 *     blanket "try again with something else" turns one rejected submit into
 *     two.
 *   ONLY when the number DIFFERS. Sending the same value twice asks a question
 *     already answered.
 *   ONLY ONCE. If Meesho refuses its own number there is nothing further to
 *     try, and the second failure is the one that stands.
 */

const ROOT = path.resolve(__dirname, "..", "..", "..");
const axiosPath = require.resolve("axios", { paths: [ROOT] });

/** Every createTicket submit, in order, with the sub-order it carried. */
const submits = [];
/** Sub-order numbers Meesho will accept. Anything else is refused. */
let accepts = new Set();

const subOrderOf = (data) =>
    ((data && data.ticket_details) || []).find((d) => d.key === "sub_order_number")?.value ?? "";

const fakeAxios = (config) => {
    const url = String(config.url || "");

    if (url.includes("createTicket")) {
        const sent = subOrderOf(config.data);

        submits.push(sent);

        if (!accepts.has(sent)) {
            return Promise.resolve({
                status: 200,
                data: {
                    is_valid: false,
                    errors: [
                        { error_message: "Please enter a valid sub order number.", field_name: "sub_order_number" },
                    ],
                },
            });
        }

        return Promise.resolve({ status: 200, data: { ticket_id: 790148921216, is_valid: true } });
    }

    return Promise.resolve({ status: 200, data: {} });
};

require.cache[axiosPath] = {
    id: axiosPath,
    filename: axiosPath,
    loaded: true,
    exports: fakeAxios,
    children: [],
    paths: [],
};

const flow = require(
    path.resolve(__dirname, "..", "platforms/meesho/claim-management/api-based-flow/claimApiFlow.js")
);

const ctx = () => ({ supplierId: 7, supplierIdentifier: "SUP-7", jar: {}, logger: { warn() {} } });

/** What the row holds, and what Meesho's search says the number really is. */
const ROW_SUB = "111111111111111111_1";
const MEESHO_SUB = "329504571700710976_1";

const submit = (subOrderNumber) =>
    flow.createTicket(ctx(), { subOrderNumber, awbNumber: "VL0085386526379" });

beforeEach(() => {
    submits.length = 0;
    accepts = new Set([MEESHO_SUB]);
});

test("the row's number is what is tried first", async () => {
    // It is what the operator entered, and it is right most of the time.
    await submit(ROW_SUB).catch(() => {});

    assert.equal(submits[0], ROW_SUB);
});

test("a rejected number comes back as something the flow can act on", async () => {
    // THE PREREQUISITE FOR THE REFILE. While this was `CLAIM_REFUSED` the flow
    // could not tell it apart from any other refusal, so it could not answer
    // it with the number it already had.
    const error = await submit(ROW_SUB).catch((e) => e);

    assert.equal(error.code, "INVALID_SUB_ORDER");
    assert.equal(error.message, "ME2: Invalid sub order number.");
});

test("Meesho's own number files when the row's is refused", async () => {
    // The search found the return; its response carried the real number. This
    // is that number being used instead of reported.
    const result = await flow.createTicket(ctx(), {
        subOrderNumber: MEESHO_SUB,
        awbNumber: "VL0085386526379",
    });

    assert.equal(result.ticketId, "790148921216");
    assert.deepEqual(submits, [MEESHO_SUB]);
});

test("a number Meesho does not know is refused, not retried for ever", async () => {
    // One submit, one refusal. The retry lives in fileClaim, which has the
    // search response; createTicket itself must never loop.
    await submit(ROW_SUB).catch(() => {});

    assert.equal(submits.length, 1, "createTicket retried on its own");
});

test("does not mistake another refusal for a bad sub-order", async () => {
    // A blanket "try again with something else" turns one rejected submit into
    // two, on a claim that was never going to file.
    accepts = new Set();

    const error = await flow
        .createTicket(ctx(), { subOrderNumber: ROW_SUB, awbNumber: "X" })
        .catch((e) => e);

    assert.equal(error.code, "INVALID_SUB_ORDER");
    assert.equal(submits.length, 1);
});
