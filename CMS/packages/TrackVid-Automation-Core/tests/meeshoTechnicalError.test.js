const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test, beforeEach, after } = require("node:test");

/**
 * MR1 — Meesho refused and would not say why.
 *
 * THE CASE THIS CAME FROM. A claim failed with HTTP 500 and an empty body. The
 * response said nothing, and the REQUEST — the only thing that differed from a
 * filing that worked — existed nowhere once the process exited. It was settled
 * by filing the same claim by hand in the portal and diffing the browser's
 * payload against ours, which found three `ticket_details` keys we were leaving
 * out. That is not a debugging step anybody should take twice.
 *
 * So the flow now does two things when it runs out of explanations: it says MR1
 * rather than rethrowing three lines of JSON, and it writes the case to disk so
 * the next one can be READ.
 *
 * WHAT "RUNS OUT OF EXPLANATIONS" MEANS, precisely — and every branch below is
 * about not stealing a case from a code that explains it better:
 *
 *   the window is OPEN      (else ME1 — and ME1 is terminal, so a wrong one
 *                            writes off a claimable return)
 *   the sub-order VALIDATES (else ME2 — which Refill Data can actually fix)
 *   the 500 carried nothing (else it is Meesho's own words, and a retry is right)
 *
 * Only all three at once means the payload is the remaining difference.
 */

const ROOT = path.resolve(__dirname, "..", "..", "..");
const axiosPath = require.resolve("axios", { paths: [ROOT] });

/** Somewhere to write cases that is not an operator's real store. */
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), "claim-failures-test-"));

process.env.CLAIM_FAILURE_DIR = DIR;

/**
 * Answers per URL, so one claim can be walked end to end.
 *
 * `submit` is the createTicket reply; `validate` covers both validation calls.
 */
const answers = { submit: null, validate: null };
const seen = [];

const fakeAxios = (config) => {
    seen.push(config);

    const url = String(config.url || "");

    if (url.includes("createTicket")) return Promise.resolve(answers.submit);
    if (url.includes("validateTicketField")) return Promise.resolve(answers.validate);

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
const { MEESHO_TECHNICAL, TAT_EXPIRED, INVALID_SUB_ORDER } = require(
    path.resolve(__dirname, "..", "common/claimErrors.js")
);
const { listClaimFailures } = require(path.resolve(__dirname, "..", "common/claimFailureStore.js"));

const ctx = () => ({ supplierId: 7, supplierIdentifier: "SUP-7", jar: {}, logger: { warn() {} } });
const CLAIM = { subOrderNumber: "324853588461395712_1", awbNumber: "1490711725948834" };

/** Meesho's bare refusal: a 5xx whose body explains nothing. */
const EMPTY_500 = { status: 500, data: { options: { backendData: { error: "" } } } };

/** A validation answer that raises the given complaints — none means it passed. */
const validation = (...messages) => ({
    status: 200,
    data: {
        is_valid: messages.length === 0,
        errors: messages.map((message) => ({ error_message: message, field_name: null })),
    },
});

const cases = () => listClaimFailures();
const readCase = (file) => JSON.parse(fs.readFileSync(file, "utf8"));

beforeEach(() => {
    seen.length = 0;
    for (const file of cases()) fs.unlinkSync(file);
    answers.submit = EMPTY_500;
    answers.validate = validation();
});

after(() => {
    fs.rmSync(DIR, { recursive: true, force: true });
});

const submit = async () => {
    try {
        await flow.createTicket(ctx(), CLAIM);

        return null;
    } catch (error) {
        return error;
    }
};

test("says MR1 when nothing is wrong with the row and Meesho still refuses", async () => {
    const error = await submit();

    // The words an operator reads. Not three lines of JSON, and not a retry:
    // nothing on the row can be corrected to make this file.
    assert.equal(error.message, MEESHO_TECHNICAL);
    assert.equal(error.code, "MEESHO_TECHNICAL");
});

test("saves the case, so the next one is read rather than reproduced", async () => {
    await submit();

    const files = cases();

    assert.equal(files.length, 1, "one failure, one case");

    const saved = readCase(files[0]);

    assert.equal(saved.code, MEESHO_TECHNICAL);
    assert.equal(saved.platform, "meesho");
    assert.equal(saved.status, 500);
    // The identifiers to find the row again.
    assert.equal(saved.awbNumber, "1490711725948834");
    assert.equal(saved.subOrderNumber, "324853588461395712_1");
    assert.equal(saved.account, "SUP-7");
    assert.match(saved.reason, /payload is the remaining difference/);
});

test("the case carries the keys that were sent, in order", async () => {
    // THE WHOLE POINT. The difference that mattered last time was which keys
    // went, not what was in them — three the portal always sends were missing.
    await submit();

    const saved = readCase(cases()[0]);

    assert.deepEqual(
        saved.request.fields.map((field) => field.key),
        [
            "sub_order_number",
            "awb_number",
            "packet_state",
            "barcode_id",
            "barcode_image_link",
            "product_image_link",
            "product_reverse_way_bill_link",
            "product_openingvideo_link",
            "ticket_desc",
            "attachments",
            "callback_number",
        ]
    );
});

test("the case holds no cookies, no signed URLs and no seller prose", async () => {
    answers.submit = EMPTY_500;

    await flow
        .createTicket(ctx(), {
            ...CLAIM,
            description: "Dear Support Team, please refund us the value of our product inr 699",
            videoUrl: "https://gcs-example.invalid/TicketInputAttachments/61008/video.mp4?X-Goog-Signature=abc",
        })
        .catch(() => {});

    const text = fs.readFileSync(cases()[0], "utf8");

    // A case is a debugging aid, not a copy of the claim. Evidence URLs are
    // signed and the description is the seller's own words.
    assert.doesNotMatch(text, /X-Goog-Signature/, "a signed URL reached the case file");
    assert.doesNotMatch(text, /refund us the value/, "the seller's prose reached the case file");
    // What survives is the SHAPE: a count for a file slot, a length for text.
    const described = readCase(cases()[0]).request.fields;

    assert.equal(described.find((f) => f.key === "product_openingvideo_link").value, "[1]");
    assert.match(described.find((f) => f.key === "ticket_desc").value, /^\d+ chars$/);
});

test("leaves a closed window to ME1, and saves nothing", async () => {
    // ME1 explains it, and ME1 is terminal. MR1 stealing this case would turn a
    // finished row into an open defect report.
    answers.validate = validation("Claim can only be raised within 7 days of return delivery");

    const error = await submit();

    assert.equal(error.message, TAT_EXPIRED);
    assert.deepEqual(cases(), [], "a case was saved for a failure that was explained");
});

test("leaves an unknown sub-order to ME2, and saves nothing", async () => {
    // ME2 is the FIXABLE one — Refill Data reads the right number off the
    // Returns search. Calling it a technical error hides a row a person could
    // have corrected in a minute.
    answers.validate = validation("Please enter a valid sub order number.");

    const error = await submit();

    assert.equal(error.message, INVALID_SUB_ORDER);
    assert.deepEqual(cases(), []);
});

test("leaves a 500 that gave a reason alone, and saves nothing", async () => {
    // Meesho explained itself, so this is not unexplained — and a retry may
    // well be the right answer. Not ours to relabel.
    answers.submit = {
        status: 500,
        data: { options: { backendData: { errors: [{ defaultMessage: "Attachment rejected" }] } } },
    };

    const error = await submit();

    assert.notEqual(error.message, MEESHO_TECHNICAL);
    assert.deepEqual(cases(), []);
});

test("a 400 is Meesho understanding and refusing — not MR1", async () => {
    answers.submit = { status: 400, data: {} };

    const error = await submit();

    assert.notEqual(error.message, MEESHO_TECHNICAL);
    assert.deepEqual(cases(), []);
});

test("a claim that files writes no case at all", async () => {
    answers.submit = { status: 200, data: { ticket_id: 790148921216, is_valid: true } };

    const result = await flow.createTicket(ctx(), CLAIM);

    assert.equal(result.ticketId, "790148921216");
    assert.deepEqual(cases(), []);
});

test("a store that cannot be written never fails the claim", async () => {
    // The worst a broken store may do is leave a failure undocumented. A claim
    // that would have reported MR1 must still report MR1.
    const previous = process.env.CLAIM_FAILURE_DIR;

    // A path under a FILE, so mkdir cannot succeed.
    process.env.CLAIM_FAILURE_DIR = path.join(cases()[0] || __filename, "nope");

    const error = await submit();

    process.env.CLAIM_FAILURE_DIR = previous;

    assert.equal(error.message, MEESHO_TECHNICAL);
});
