const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test, beforeEach, after } = require("node:test");

/**
 * "This is an RTO shipment" — refiled on Meesho's RTO form, once.
 *
 * THE FAILURE THIS ENDS (2026-11-04, three claims on one account). A
 * wrong-return claim on an RTO parcel went on form 1 because the Returns search
 * had not said `type: "RTO"`, and Meesho refused it:
 *
 *   CLAIM_REFUSED: This is an RTO shipment. Please select the correct FAQ to
 *   raise a claim on an RTO shipment: "I have received a wrong barcoded package
 *   in RTO" or "I have received an RTO in a non-barcoded package".
 *
 * The same claim was then accepted by hand on form 139 (ticket 793769199476).
 * The refusal names the form, so the flow refiles there instead of reporting.
 *
 *   ONLY on that refusal, ONLY to a form the claim type has, ONLY ONCE.
 */

const ROOT = path.resolve(__dirname, "..", "..", "..");
const axiosPath = require.resolve("axios", { paths: [ROOT] });

const RTO_REFUSAL =
    'This is an RTO shipment. Please select the correct FAQ to raise a claim on an RTO shipment: ' +
    '"I have received a wrong barcoded package in RTO" or "I have received an RTO in a non-barcoded package".';

/** Every createTicket body, in order. */
const submits = [];
/** Sub-category ids Meesho accepts a ticket on. Anything else is refused as RTO. */
let acceptsOn = new Set(["139"]);
/** What fetchSubCategory answers, keyed by the sub_category_id it is asked about. */
let formLists = {};

const fakeAxios = (config) => {
    const url = String(config.url || "");

    if (url.includes("createTicket")) {
        submits.push(config.data);

        if (!acceptsOn.has(String(config.data.sub_category_id))) {
            return Promise.resolve({
                status: 200,
                data: { is_valid: false, errors: [{ error_message: RTO_REFUSAL, field_name: null }] },
            });
        }

        return Promise.resolve({ status: 200, data: { ticket_id: 793769199476, is_valid: true } });
    }

    // The Returns search fails — the case that left the type unknown.
    if (url.includes("returnRto") || url.includes("fetchReturnClaims")) {
        return Promise.resolve({ status: 503, data: { error: "unavailable" } });
    }

    if (url.includes("fetchSubCategory")) {
        const list = formLists[String(config.data && config.data.sub_category_id)] || [];

        return Promise.resolve({ status: 200, data: { sub_categories: list } });
    }

    // No prior tickets.
    return Promise.resolve({ status: 200, data: {} });
};

fakeAxios.get = () => Promise.resolve({ status: 200, data: Buffer.from("png") });
fakeAxios.post = () =>
    Promise.resolve({
        status: 200,
        data: { url: "https://gcs.example/TicketInputAttachments/7/1/product_1.png", is_valid: true, errors: null },
    });

require.cache[axiosPath] = {
    id: axiosPath,
    filename: axiosPath,
    loaded: true,
    exports: fakeAxios,
    children: [],
    paths: [],
};

const { fileMeeshoClaim } = require(
    path.resolve(__dirname, "..", "platforms/meesho/claim-management/api-based-flow/fileClaim.js")
);
const flow = require(
    path.resolve(__dirname, "..", "platforms/meesho/claim-management/api-based-flow/claimApiFlow.js")
);

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "meesho-rto-"));
after(() => fs.rmSync(tempDir, { recursive: true, force: true }));

const quiet = { log() {}, warn() {}, error() {} };
const ctx = () => ({ supplierId: 61008, supplierIdentifier: "pcbev", jar: {}, logger: quiet });

const claim = (typeOfClaim, extra = {}) => ({
    typeOfClaim,
    subOrderNumber: "345076637187819392_1",
    stateOfPacket: "intact",
    packetId: "TP4UOEU02810110",
    productImage: ["https://cdn.example/product.png"],
    description: "wrong return",
    callbackNumber: "8200724282",
    ...extra,
});

const file = (entry) =>
    fileMeeshoClaim(ctx(), entry, "VL0085867597691", tempDir, { username: "seller@example.com" }, { log: quiet });

beforeEach(() => {
    submits.length = 0;
    acceptsOn = new Set(["139"]);
    formLists = {};
});

test("a wrong-return claim refused as RTO is refiled on form 139 and files", async () => {
    const result = await file(claim("I have received wrong return"));

    assert.deepEqual(submits.map((b) => b.sub_category_id), ["1", "139"]);
    assert.equal(String(result.ticketId), "793769199476");
    assert.equal(result.alreadyExisted, false);
});

test("the refile carries the RTO form id in the classification block too", async () => {
    await file(claim("I have received wrong return"));

    const rto = submits[1];

    assert.equal(rto.faq_classification_info.supplier_selected_sub_category_id, 139);
    assert.equal(rto.category_id, "1");
});

test("a claim type with no RTO form keeps Meesho's refusal, unchanged", async () => {
    const error = await file(claim("I have received damaged return")).catch((e) => e);

    assert.equal(submits.length, 1, "nothing to refile to, so no second submit");
    assert.equal(error.code, "MEESHO_RTO_SHIPMENT");
    assert.match(error.message, /^CLAIM_REFUSED: This is an RTO shipment/);
});

test("refiles only once — a second RTO refusal stands", async () => {
    acceptsOn = new Set();

    const error = await file(claim("I have received wrong return")).catch((e) => e);

    assert.deepEqual(submits.map((b) => b.sub_category_id), ["1", "139"]);
    assert.equal(error.code, "MEESHO_RTO_SHIPMENT");
});

test("a claim already accepted on form 1 is never refiled", async () => {
    acceptsOn = new Set(["1"]);

    await file(claim("I have received wrong return"));

    assert.deepEqual(submits.map((b) => b.sub_category_id), ["1"]);
});

// -----------------------------------------------------------------------------
// BE's own RTO claim types — the operator already chose the RTO form
// -----------------------------------------------------------------------------

test("'wrong barcoded package in RTO' files on 139 first time, no refusal", async () => {
    // THE ROWS THAT STILL FAILED: this type was in no map, fell back to form 1,
    // and Meesho refused it as an RTO.
    const result = await file(claim("I have received a wrong barcoded package in RTO"));

    assert.deepEqual(submits.map((b) => b.sub_category_id), ["139"]);
    assert.equal(String(result.ticketId), "793769199476");
});

test("'RTO in a non-barcoded package' is found by title in the RTO forms' list", async () => {
    formLists = {
        1: [{ sub_category_id: 1, sub_category_title: "I have received wrong return" }],
        139: [
            { sub_category_id: 139, sub_category_title: "I have received a wrong barcoded package in RTO" },
            { sub_category_id: 140, sub_category_title: "I have received an RTO in a non-barcoded package" },
        ],
    };
    acceptsOn = new Set(["140"]);

    await file(claim("I have received an RTO in a non-barcoded package"));

    assert.deepEqual(submits.map((b) => b.sub_category_id), ["140"]);
});

test("a type found in form 1's list never asks for the RTO list", async () => {
    formLists = { 1: [{ sub_category_id: 3, sub_category_title: "I have received damaged return" }] };
    acceptsOn = new Set(["3"]);

    const id = await flow.resolveSubCategoryIdLive(ctx(), "I have received damaged return");

    assert.equal(id, "3");
});

// -----------------------------------------------------------------------------
// The RTO form's payload — the shape the portal sent on ticket 793769199476
// -----------------------------------------------------------------------------

const RTO_PORTAL_KEYS = [
    "sub_order_number",
    "awb_number",
    "packet_state",
    "barcode_id",
    "product_image_link",
    "product_reverse_way_bill_link",
    "product_openingvideo_link",
    "ticket_desc",
    "attachments",
    "callback_number",
];

const sentOn = async (subCategoryId, extra = {}) => {
    submits.length = 0;
    acceptsOn = new Set([String(subCategoryId)]);

    await flow.createTicket(ctx(), {
        subCategoryId,
        subOrderNumber: "345076637187819392_1",
        awbNumber: "VL0085867597691",
        ...extra,
    });

    return submits[0];
};

test("form 139 is sent the RTO form's keys — no barcode image slot", async () => {
    const body = await sentOn("139");

    assert.deepEqual(body.ticket_details.map((d) => d.key), RTO_PORTAL_KEYS);
});

test("form 139's image slots are img_file, as the portal sends them", async () => {
    const body = await sentOn("139");
    const type = (key) => body.ticket_details.find((d) => d.key === key).type;

    assert.equal(type("product_image_link"), "img_file");
    assert.equal(type("product_reverse_way_bill_link"), "img_file");
});

test("a barcode image on form 139 is kept, in attachments", async () => {
    const body = await sentOn("139", {
        barcodeImageUrl: "https://gcs.example/barcode.png",
        attachments: ["https://gcs.example/extra.jpg"],
    });
    const attachments = body.ticket_details.find((d) => d.key === "attachments").value;

    assert.deepEqual(attachments, ["https://gcs.example/barcode.png", "https://gcs.example/extra.jpg"]);
});

test("form 1 keeps its own shape, exactly as before", async () => {
    const body = await sentOn("1", { barcodeImageUrl: "https://gcs.example/barcode.png" });
    const slot = (key) => body.ticket_details.find((d) => d.key === key);

    assert.deepEqual(slot("barcode_image_link").value, ["https://gcs.example/barcode.png"]);
    assert.equal(slot("product_image_link").type, "action_img_file");
    assert.deepEqual(slot("attachments").value, []);
});
