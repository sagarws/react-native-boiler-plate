const assert = require("node:assert/strict");
const path = require("node:path");
const { test } = require("node:test");

/**
 * The ways a Meesho claim fails, and what each one must be called.
 *
 * FOUR FAILURE FIXES SHIPPED HERE WITH NO TEST between them — a 500 being let
 * to stand as a failure, a missing browser-id header, the wrong submit payload,
 * and an attachment named with the wrong AWB. Every one was found in
 * production. What follows pins the reasoning those fixes put in, because none
 * of it is checked anywhere else.
 *
 * WHY THESE FUNCTIONS AND NOT THE FLOW. Each one turns a marketplace's sentence
 * into a decision the rest of the system acts on — a claim code an operator
 * reads, a retry that must not happen, a ticket id that decides whether a
 * second ticket gets raised. They are pure, so they can be pinned exactly; the
 * flow around them needs a browser and a live seller account.
 *
 * THE RISK THEY GUARD IS MIS-LABELLING, not crashing. Meesho refuses in prose,
 * and the classifiers are regexes over that prose. A reworded message does not
 * throw — it quietly lands in the wrong bucket, and the wrong bucket sends
 * somebody to correct a sub-order number that was already right, or retries a
 * claim that can never succeed. So as many tests below assert what must NOT
 * match as what must.
 */

const ROOT = path.resolve(__dirname, "..", "..", "..");
const axiosPath = require.resolve("axios", { paths: [ROOT] });

/** Requests the flow would have sent, and the answer it gets back. */
const calls = [];
let reply = { status: 200, data: {} };

const fakeAxios = (config) => {
    calls.push(config);

    return Promise.resolve(typeof reply === "function" ? reply(config) : reply);
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
const { TAT_EXPIRED, INVALID_SUB_ORDER, MEESHO_INVALID_AWB, MEESHO_INVALID_PACKET_ID } =
    require(path.resolve(__dirname, "..", "common/claimErrors.js"));

/** A validation response in the shape `validateTicketField` returns. */
const refusal = (...messages) => ({
    isValid: false,
    errors: messages.map((message) => ({ message, field: null })),
    raw: {},
});

/** The same, with Meesho naming the field it objected to. */
const fieldRefusal = (field, message) => ({
    isValid: false,
    errors: [{ message, field }],
    raw: {},
});

// -----------------------------------------------------------------------------
// The claim window — ME1
// -----------------------------------------------------------------------------

/**
 * Meesho states this several ways and has changed the wording before. Each of
 * these is a real refusal shape the patterns were written against; a pattern
 * dropped in a tidy-up turns "TAT expired" into an unexplained failure that
 * gets retried nightly for ever.
 */
test("recognises every wording of a closed claim window", () => {
    const closed = [
        "Claim can only be raised within 7 days of return delivery",
        "TAT has been breached for this order",
        "The claim window has closed for this sub order",
        "This claim period is over",
        "Too late to raise a claim for this return",
        "Claim request expired",
    ];

    for (const message of closed) {
        const verdict = flow.tatVerdict(refusal(message));

        assert.equal(verdict.expired, true, `should read as TAT expired: ${message}`);
        // The marketplace's own sentence rides along — the code goes in the
        // column, the sentence goes in the log where there is room for it.
        assert.equal(verdict.message, message);
    }
});

test("does not call every refusal a closed window", () => {
    // THE MIS-LABEL THIS EXISTS TO PREVENT. "TAT expired" is terminal: the row
    // is finished and nobody looks again. A wrong AWB filed under it is a
    // claimable return written off.
    const other = [
        "Please enter a valid sub order number.",
        "This sub order does not belong to the supplier",
        "AWB number is required",
        "Internal server error",
    ];

    for (const message of other) {
        assert.equal(
            flow.tatVerdict(refusal(message)).expired,
            false,
            `must not be read as TAT expired: ${message}`
        );
    }
});

test("a validation that passed is not a failure of any kind", () => {
    const passed = { isValid: true, errors: [], raw: {} };

    assert.equal(flow.tatVerdict(passed).expired, false);
    assert.equal(flow.subOrderVerdict(passed).invalid, false);
    // Nothing to classify at all — must not throw on the way to deciding that.
    assert.equal(flow.tatVerdict(null).expired, false);
    assert.equal(flow.subOrderVerdict(undefined).invalid, false);
});

// -----------------------------------------------------------------------------
// An unknown sub-order number — ME2
// -----------------------------------------------------------------------------

test("recognises Meesho's own words for a number it does not know", () => {
    const verdict = flow.subOrderVerdict(refusal("Please enter a valid sub order number."));

    assert.equal(verdict.invalid, true);
});

test("recognises it from the field name too, not only the sentence", () => {
    // The second half of the rule: Meesho sometimes names the field and words
    // the message differently.
    for (const message of ["Invalid value", "sub order not found"]) {
        assert.equal(
            flow.subOrderVerdict(fieldRefusal("sub_order_number", message)).invalid,
            true,
            `should read as an unknown sub-order: ${message}`
        );
    }
});

test("does not read a closed window as a wrong number", () => {
    // These two are the pair most easily confused and they lead opposite ways:
    // ME2 is FIXABLE — Refill Data reads the right number off the Returns
    // search and the claim then files. Labelling a closed window ME2 sends an
    // operator to correct a number that was never wrong, and the claim fails
    // again on the next run.
    const verdict = flow.subOrderVerdict(
        refusal("Claim can only be raised within 7 days of return delivery")
    );

    assert.equal(verdict.invalid, false);
});

test("the two verdicts never both claim the same refusal", () => {
    // One refusal, one code. If both fire, whichever the flow happens to check
    // first wins — and that is not a decision anybody made.
    const messages = [
        "Claim can only be raised within 7 days of return delivery",
        "Please enter a valid sub order number.",
        "TAT breached",
        "Internal server error",
    ];

    for (const message of messages) {
        const both =
            flow.tatVerdict(refusal(message)).expired &&
            flow.subOrderVerdict(refusal(message)).invalid;

        assert.equal(both, false, `two codes claim the same refusal: ${message}`);
    }
});

test("the codes an operator reads are the shared ones, not a local spelling", () => {
    // Both runners write these and the claims filter MATCHES on them, so a
    // second spelling splits one reason into two — see common/claimErrors.
    assert.equal(flow.TAT_EXPIRED_MESSAGE, TAT_EXPIRED);
    assert.equal(flow.INVALID_SUB_ORDER_MESSAGE, INVALID_SUB_ORDER);
});

// -----------------------------------------------------------------------------
// A 500 with nothing in it — the duplicate-ticket guard
// -----------------------------------------------------------------------------

/**
 * `isOpaqueServerError` is what decides whether a failed submit is allowed to
 * stand as a failure, or whether the flow goes and ASKS Meesho if the ticket
 * exists first.
 *
 * The bug it came from: Meesho answers 500 AFTER creating the ticket. Treating
 * that as a plain failure meant the next run filed the same return again, and
 * one return had two tickets. But a 500 that DOES explain itself is a real
 * failure and must not send the flow on a search it does not need — hence
 * "opaque", not "5xx".
 */
const apiError = (status, body) => {
    const err = new Error("submit failed");

    err.code = "MEESHO_API_ERROR";
    err.status = status;
    err.body = body;

    return err;
};

test("a 500 that explains nothing is opaque — the ticket must be looked for", () => {
    assert.equal(flow.isOpaqueServerError(apiError(500, {})), true);
    assert.equal(flow.isOpaqueServerError(apiError(502, { options: {} })), true);
    assert.equal(flow.isOpaqueServerError(apiError(503, null)), true);
});

test("a 500 that gives a reason is a plain failure", () => {
    const explained = apiError(500, {
        options: { backendData: { errors: [{ defaultMessage: "Attachment rejected" }] } },
    });

    assert.equal(flow.isOpaqueServerError(explained), false);
});

test("a 4xx is never opaque, however empty", () => {
    // A 400 means Meesho understood and refused; there is no ticket to find,
    // and searching for one on every validation failure is a request per claim
    // spent learning nothing.
    assert.equal(flow.isOpaqueServerError(apiError(400, {})), false);
    assert.equal(flow.isOpaqueServerError(apiError(404, {})), false);
});

test("something that is not a Meesho API error at all is not opaque", () => {
    // A network drop or a bug in our own code must not be answered by asking
    // Meesho whether it made a ticket.
    const network = new Error("ECONNRESET");

    assert.equal(flow.isOpaqueServerError(network), false);
    assert.equal(flow.isOpaqueServerError(null), false);
    assert.equal(flow.isOpaqueServerError({ status: 500 }), false);
});

test("reads the reason out of the envelope Meesho buries it in", () => {
    const body = {
        options: {
            backendData: {
                errors: [
                    { defaultMessage: "Sub order already has a ticket" },
                    { message: "Duplicate" },
                ],
            },
        },
    };

    assert.equal(flow.meeshoErrorDetail(body), "Sub order already has a ticket; Duplicate");
    assert.equal(flow.meeshoErrorDetail({}), null);
    assert.equal(flow.meeshoErrorDetail("a string"), null);
    // An errors array carrying nothing usable is the same as no detail — and
    // it must not come back as an empty string, which would read as explained.
    assert.equal(flow.meeshoErrorDetail({ options: { backendData: { errors: [{}] } } }), null);
});

// -----------------------------------------------------------------------------
// Finding an existing ticket — the other half of the same guard
// -----------------------------------------------------------------------------

/**
 * A context the panel will actually talk to.
 *
 * BOTH identity fields, because `httpCall` refuses without them — the numeric
 * id goes in the body and the identifier in a header, and Meesho's edge answers
 * a call missing either with 403 rather than an error that names the cause.
 */
const signedIn = () => ({ supplierId: 7, supplierIdentifier: "SUP-7", jar: {} });

test("never calls the panel without a supplier identity", async () => {
    calls.length = 0;
    reply = { status: 200, data: { tickets: [] } };

    // THE FAILURE MODE THIS GUARD PREVENTS: a session whose identity could not
    // be read still looks usable, and every call it makes is answered 403 by
    // the edge — a whole run burned on a cause no response names. Better to
    // refuse here, where the message says what is missing.
    await flow.searchTicketsBySubOrder({ supplierId: 7, jar: {} }, "abc123_4");

    assert.equal(calls.length, 0, "called Meesho with no supplier identifier");
});

test("takes the ticket id under any of the names Meesho gives it", () => {
    // Five spellings across builds. A miss here does not merely fail to find
    // the ticket — it files a SECOND one for a return that already has one.
    const spellings = [
        ["ticket_id", "T1"],
        ["ticketId", "T2"],
        ["id", "T3"],
        ["jira_key", "T4"],
        ["ticket_number", "T5"],
    ];

    for (const [field, value] of spellings) {
        assert.equal(flow.extractTicketId({ [field]: value }), value, `missed ${field}`);
    }

    assert.equal(flow.extractTicketId({ unrelated: "x" }), null);
    assert.equal(flow.extractTicketId(null), null);
});

test("searches the sub-order upper-cased, and tries the padded id too", async () => {
    calls.length = 0;
    // Nothing found on the bare id, so the `_1` form must be tried as well.
    reply = { status: 200, data: { tickets: [] } };

    await flow.searchTicketsBySubOrder(signedIn(), "  abc123_4  ");

    const searched = calls.map((call) => (call.data && call.data.search_ids) || []).flat();

    // Upper-cased and trimmed: this is the dedupe check, and a spelling that
    // fails to match an existing ticket raises a duplicate.
    assert.deepEqual(searched, ["ABC123_4", "ABC123_4_1"]);
});

test("stops at the first form that finds something", async () => {
    calls.length = 0;
    reply = { status: 200, data: { tickets: [{ ticket_id: "T9" }] } };

    const found = await flow.searchTicketsBySubOrder(signedIn(), "abc123_4");

    assert.equal(found.length, 1);
    assert.equal(flow.extractTicketId(found[0]), "T9");
    // One request, not two: the second is only for when the first finds nothing.
    assert.equal(calls.length, 1);
});

// -----------------------------------------------------------------------------
// The submitted payload — the shape the portal actually produces
// -----------------------------------------------------------------------------

/**
 * Every key the portal sends on a successful filing, in its order.
 *
 * From a capture of a claim filed BY HAND that Meesho accepted (ticket
 * 790148921216). It is the reference for this whole section: the report that
 * started it was "it fails in our system and works in the portal", and the
 * difference was keys we left out.
 */
const PORTAL_KEYS = [
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
];

/** Runs createTicket against the stubbed transport and returns what it sent. */
const submitted = async (payload) => {
    calls.length = 0;
    reply = { status: 200, data: { ticket_id: 1, is_valid: true } };

    await flow.createTicket(signedIn(), payload);

    return calls[0].data;
};

/** The least a claim can carry: the two identifiers and nothing else. */
const BARE_CLAIM = { subOrderNumber: "324853588461395712_1", awbNumber: "1490711725948834" };

test("sends every key the portal sends, even when the row carries nothing for it", async () => {
    // THE BUG THIS PINS. `packet_state` and `barcode_id` were conditional while
    // the four file slots beside them were not, so a row with no packet id and
    // no packet state submitted a payload two keys short of anything the portal
    // produces — and Meesho answers a shape it dislikes with HTTP 500 and an
    // empty body, the least diagnosable failure this flow has. Filing the same
    // claim by hand worked, because the form supplies both.
    const body = await submitted(BARE_CLAIM);

    assert.deepEqual(
        body.ticket_details.map((d) => d.key),
        PORTAL_KEYS,
        "the submitted keys must match the portal's, in its order"
    );
});

test("an absent value is sent empty, never as a missing key", async () => {
    const body = await submitted(BARE_CLAIM);
    const field = (key) => body.ticket_details.find((d) => d.key === key);

    // Empty is how this form says "nothing here" — the same way `attachments`
    // and `ticket_desc` are sent on a claim that has neither.
    assert.deepEqual(field("packet_state"), {
        key: "packet_state", type: "drop_down", label: "State of the packet",
        value: "", selectedLabel: "",
    });
    assert.deepEqual(field("barcode_id"), {
        key: "barcode_id", type: "action_single_text_box", label: "Packet ID", value: "",
    });
    assert.deepEqual(field("attachments").value, []);
    assert.deepEqual(field("barcode_image_link").value, []);
});

test("fills those two from the row when it has them", async () => {
    const body = await submitted({
        ...BARE_CLAIM,
        stateOfPacket: "Intact",
        packetId: "DLVPCP017051342",
    });
    const field = (key) => body.ticket_details.find((d) => d.key === key);

    // Both spellings, as the portal sends them: lowercase value, Title Case label.
    assert.equal(field("packet_state").value, "intact");
    assert.equal(field("packet_state").selectedLabel, "Intact");
    assert.equal(field("barcode_id").value, "DLVPCP017051342");
});

test("sends the sub-order number exactly as the row holds it", async () => {
    // NOTHING ADDED. A real sub-order carries its own `_<n>`; inventing one for
    // a row that lacks it would file against an order nobody named. The search
    // may guess at the padded form — a guess there costs a request, and here it
    // would cost a ticket.
    const body = await submitted(BARE_CLAIM);
    const value = body.ticket_details.find((d) => d.key === "sub_order_number").value;

    assert.equal(value, "324853588461395712_1");
});

test("cases an identifier up without touching anything else in it", async () => {
    const body = await submitted({ subOrderNumber: "  abc123_4  ", awbNumber: "vlr082879603477" });
    const field = (key) => body.ticket_details.find((d) => d.key === key).value;

    // Upper-cased and trimmed — no other edit. Meesho's Returns search is a
    // text match, so a lowercase AWB reads as "not on this account".
    assert.equal(field("sub_order_number"), "ABC123_4");
    assert.equal(field("awb_number"), "VLR082879603477");
});

test("refuses an 18-digit identifier that arrived as a number", async () => {
    // `String(Number("324853588461395712"))` is "324853588461395700" — twelve
    // out, and a VALID id belonging to a different order. Not a malformed value
    // the portal would bounce: a claim filed against somebody else. Empty is
    // the honest answer, and the caller's emptiness check reports it.
    const body = await submitted({ ...BARE_CLAIM, subOrderNumber: 324853588461395712 });

    assert.equal(body.ticket_details.find((d) => d.key === "sub_order_number").value, "");
});

test("keeps the envelope the portal sends around those details", async () => {
    const body = await submitted(BARE_CLAIM);

    // Strings outside, numbers inside — the capture's own types. A number where
    // the portal sends a string is another shape it has never produced.
    assert.equal(body.category_id, "1");
    assert.equal(body.sub_category_id, "1");
    assert.equal(body.supplier_id, "7");
    assert.equal(body.supplier_identifier, "SUP-7");
    assert.deepEqual(body.faq_classification_info, {
        faq_classification_id: "",
        supplier_selected_sub_category_id: 1,
        supplier_selected_category_id: 1,
        misc: {},
    });
});

// -----------------------------------------------------------------------------
// The return has not arrived yet — ME3: Return is not delivered
// -----------------------------------------------------------------------------

/** A 200 refusal, which is how Meesho declines a claim it can reason about. */
const refused = (message) => ({
    status: 200,
    data: { is_valid: false, errors: [{ error_message: message, field_name: null }] },
});

/** Meesho's own three sentences, verbatim from a refused claim. */
const NOT_DELIVERED =
    "You can create this ticket only if your return order has been delivered. " +
    "Please collect your return delivery and then create this ticket. If you have " +
    "already collected your return, please try again in 1 hour.";

test("names the wait instead of pasting Meesho's three sentences into the column", async () => {
    // WHAT IT REPLACED: `CLAIM_REFUSED: You can create this ticket only if…`,
    // which wrapped over the whole row and said nothing at a glance.
    calls.length = 0;
    reply = refused(NOT_DELIVERED);

    const error = await flow.createTicket(signedIn(), BARE_CLAIM).catch((e) => e);

    assert.equal(error.message, "ME4: Return is not delivered");
    assert.equal(error.code, "MEESHO_RETURN_NOT_DELIVERED");
    // Meesho's own words are kept, off the column and on the error.
    assert.match(error.detail, /try again in 1 hour/);
});

test("the code IS the whole message, so the column shows it and nothing else", async () => {
    /*
     * WHAT THE SCRIPT ERROR COLUMN GETS.
     *
     * A failed claim's `error.message` travels verbatim — claimProcessor takes
     * `error instanceof Error ? error.message : String(error)` and hands it to
     * endRun, which posts it to /cms/desktop-claim-status, which writes it to
     * `scriptProcessingError`. Nothing along that path trims, prefixes or
     * summarises, so whatever is in `message` is exactly what an operator
     * reads in a narrow column.
     *
     * Which is why a machine tag must never be in it. `CLAIM_REFUSED: …` and
     * `TAT_EXPIRED: …` lead with a word from the code rather than from the
     * business, and push the useful half past the column's width.
     */
    calls.length = 0;
    reply = refused(NOT_DELIVERED);

    const error = await flow.createTicket(signedIn(), BARE_CLAIM).catch((e) => e);

    assert.equal(error.message, "ME4: Return is not delivered");
    assert.doesNotMatch(error.message, /CLAIM_REFUSED|TAT_EXPIRED|MEESHO_/);
    // Short enough to read in the column it lands in.
    assert.ok(error.message.length < 40, `too long for the column: ${error.message.length} chars`);
});

test("does not read a closed window as a return that has not arrived", async () => {
    // THE OVERLAP THAT MAKES ORDER MATTER. A closed window is worded "within 7
    // days of return DELIVERY", and this classifier is about DELIVERY too.
    // Getting it the wrong way round leaves a dead claim retried for ever.
    calls.length = 0;
    reply = refused("Claim can only be raised within 7 days of return delivery");

    const error = await flow.createTicket(signedIn(), BARE_CLAIM).catch((e) => e);

    assert.equal(error.code, "TAT_EXPIRED");
    assert.notEqual(error.message, "ME4: Return is not delivered");
});

// -----------------------------------------------------------------------------
// A sub-order number Meesho does not know — ME2, and the refile that fixes it
// -----------------------------------------------------------------------------

test("names a rejected sub-order ME2 rather than the generic refusal", async () => {
    /*
     * IT USED TO READ `CLAIM_REFUSED: Please enter a valid sub order number.`
     * — the same bucket as every refusal nobody has classified. Two costs: an
     * operator saw a machine tag instead of the code the rest of the system
     * uses for this fact, and the FLOW could not tell it apart either, so it
     * could not do the one thing that fixes it.
     */
    calls.length = 0;
    reply = refused("Please enter a valid sub order number.");

    const error = await flow.createTicket(signedIn(), BARE_CLAIM).catch((e) => e);

    assert.equal(error.message, INVALID_SUB_ORDER);
    assert.equal(error.code, "INVALID_SUB_ORDER");
    assert.doesNotMatch(error.message, /CLAIM_REFUSED/);
    // Meesho's own sentence is kept for the log, off the narrow column.
    assert.match(error.detail, /valid sub order number/i);
});

test("the submit and the validation agree about what this refusal is", async () => {
    // Two routes reach the same fact — the pre-flight validation and the submit
    // — and they now use the SAME pattern. One wording recognised on one path
    // and not the other is a row that reports two different reasons depending
    // on which check happened to catch it first.
    calls.length = 0;
    reply = refused("Please enter a valid sub order number.");

    const fromSubmit = await flow.createTicket(signedIn(), BARE_CLAIM).catch((e) => e);
    const fromValidation = flow.subOrderVerdict(refusal("Please enter a valid sub order number."));

    assert.equal(fromSubmit.code, "INVALID_SUB_ORDER");
    assert.equal(fromValidation.invalid, true);
});

// -----------------------------------------------------------------------------
// Meesho already has a ticket for this issue
// -----------------------------------------------------------------------------

test("says a ticket already exists, rather than reporting a refusal", async () => {
    /*
     * THE CLAIM EXISTS — that is the answer the row wanted, arriving as a
     * refusal. Reported as one, the row sat on Failed to Proceed with a live
     * ticket at Meesho that nobody was tracking, and each retry asked again.
     */
    calls.length = 0;
    reply = refused(
        "Ticket {{ticket_id}} has already been raised for this issue. Please reply on the same ticket."
    );

    const error = await flow.createTicket(signedIn(), BARE_CLAIM).catch((e) => e);

    assert.equal(error.code, "MEESHO_ALREADY_RAISED");
    // Not a CLAIM_REFUSED, which is what sent it to Failed to Proceed.
    assert.doesNotMatch(error.message, /CLAIM_REFUSED/);
});

test("does not try to read an id out of a sentence that has none", async () => {
    // Meesho's API sends the template UNRENDERED — `{{ticket_id}}`, literally.
    // There is nothing to parse, which is why the caller searches for the
    // ticket instead. A parser here would produce the string "{{ticket_id}}"
    // as a ticket number and write it onto the row.
    calls.length = 0;
    reply = refused("Ticket {{ticket_id}} has already been raised for this issue.");

    const error = await flow.createTicket(signedIn(), BARE_CLAIM).catch((e) => e);

    assert.doesNotMatch(error.message, /\{\{|ticket_id/);
    // Meesho's own words are kept on the error for the log.
    assert.match(error.detail, /already been raised/i);
});

// -----------------------------------------------------------------------------
// The Packet ID box holds the wrong thing — ME6
// -----------------------------------------------------------------------------

/** Meesho's own three sentences, verbatim from a refused claim. */
const WRONG_PACKET_ID =
    "Looks like you are filling the AWB number in the Packet ID field. " +
    "Please fill correct value in the Packet ID field. " +
    "If you don't have a packet id, please fill NA.";

test("names a wrong Packet ID ME6 rather than pasting three sentences into the column", async () => {
    // WHAT IT REPLACED: `CLAIM_REFUSED: Looks like you are filling the AWB
    // number in the Packet ID field…`, which wrapped over the row and led with
    // a machine tag. Nothing about this needs the marketplace — the Packet ID
    // is typed on the row, and "NA" is a valid answer.
    calls.length = 0;
    reply = refused(WRONG_PACKET_ID);

    const error = await flow.createTicket(signedIn(), BARE_CLAIM).catch((e) => e);

    assert.equal(error.message, MEESHO_INVALID_PACKET_ID);
    assert.equal(error.code, "INVALID_PACKET_ID");
    assert.doesNotMatch(error.message, /CLAIM_REFUSED/);
    // Meesho's instruction is the useful half, and it is kept — on the error,
    // for the log, where there is room for it.
    assert.match(error.detail, /please fill NA/i);
});

test("catches a reworded packet-id refusal by the field Meesho tags it with", async () => {
    // The sentence is the half most likely to change; `barcode_id` is the
    // portal's own name for the box and does not. A rewording must not fall
    // back into the bucket this code exists to empty.
    calls.length = 0;
    reply = {
        status: 200,
        data: {
            is_valid: false,
            errors: [{ error_message: "Invalid value entered.", field_name: "barcode_id" }],
        },
    };

    const error = await flow.createTicket(signedIn(), BARE_CLAIM).catch((e) => e);

    assert.equal(error.message, MEESHO_INVALID_PACKET_ID);
    assert.deepEqual(error.fields, ["barcode_id"]);
});

test("does not let ME6 claim a refusal that is really about something else", async () => {
    // The packet pattern is the broadest of the named ones, so it runs LAST.
    // A sub-order refusal that happened to mention the packet id would still be
    // ME2 — the number is what somebody has to correct.
    calls.length = 0;
    reply = refused("Please enter a valid sub order number for this packet id.");

    const error = await flow.createTicket(signedIn(), BARE_CLAIM).catch((e) => e);

    assert.equal(error.message, INVALID_SUB_ORDER);
    assert.equal(error.code, "INVALID_SUB_ORDER");
});

test("leaves every other refusal as CLAIM_REFUSED", async () => {
    // The catch-all still catches. A classifier that widened to cover this one
    // would start relabelling refusals nobody has read yet.
    calls.length = 0;
    reply = refused("Something else entirely");

    const error = await flow.createTicket(signedIn(), BARE_CLAIM).catch((e) => e);

    assert.equal(error.code, "MEESHO_CLAIM_REFUSED");
    assert.match(error.message, /^CLAIM_REFUSED: /);
});

// -----------------------------------------------------------------------------
// Attachments, and why an upload failed
// -----------------------------------------------------------------------------

test("names the fix for each upload failure it can recognise", () => {
    const tooLarge = flow.uploadFailureHint({
        detail: "File too large",
        sentBytes: 12_500_000,
    });

    assert.equal(tooLarge.tooLarge, true);
    // The size is stated in the same millions the limits table uses, so the two
    // can be compared without arithmetic.
    assert.match(tooLarge.hint, /12\.5MB/);

    assert.match(
        flow.uploadFailureHint({ detail: "invalid entity_type", entityType: "SUPPLIER" }).hint,
        /MEESHO_UPLOAD_ENTITY_TYPE/
    );
    assert.match(
        flow.uploadFailureHint({ detail: "Unexpected field", field: "file" }).hint,
        /MEESHO_UPLOAD_FIELD/
    );
});

test("says nothing rather than guessing at an unfamiliar upload failure", () => {
    // A wrong hint is worse than none: it sends somebody to change an env var
    // that was never the problem.
    const unknown = flow.uploadFailureHint({ detail: "Service unavailable" });

    assert.equal(unknown.hint, "");
    assert.equal(unknown.tooLarge, false);
});

// -----------------------------------------------------------------------------
// Statuses the sweep reads back
// -----------------------------------------------------------------------------

test("leaves the CMS status alone for a spelling it does not know", () => {
    // The lifecycle spellings vary by build and were never captured. Guessing
    // would overwrite a status an operator set by hand; null leaves it.
    assert.equal(flow.mapMeeshoStatus("some_new_state"), null);
    assert.equal(flow.mapMeeshoStatus(""), null);
    assert.equal(flow.mapMeeshoStatus(null), null);
});

test("maps the refusal spellings to Rejected, not to Approved", () => {
    // The one mapping where being wrong is expensive in both directions: a
    // rejected claim shown as Approved is money nobody chases.
    assert.equal(flow.mapMeeshoStatus("rejected"), "Rejected");
    assert.equal(flow.mapMeeshoStatus("denied"), "Rejected");
    assert.equal(flow.mapMeeshoStatus("approved"), "Approved");
    assert.equal(flow.mapMeeshoStatus("resolved"), "Approved");
});

/**
 * "This AWB number doesn't match the return shipment for the sub order."
 *
 * THE REVERSE AWB ON THE ROW IS NOT THIS SUB-ORDER'S. It reached the Script
 * Error column as `CLAIM_REFUSED: This AWB number doesn't match…`, wrapping
 * over the row behind a machine tag — the bucket every unread refusal lands in.
 *
 * ME3 is the code this system already uses for "the AWB is wrong": fileClaim
 * raises it when a sweep finds the number on no account at all. Same fact from
 * the other end, so one code keeps the two queues together.
 */
const AWB_MISMATCH =
    "This AWB number doesn't match the return shipment for the sub order. " +
    "Please enter the correct reverse AWB.";

test("names a mismatched reverse AWB ME3 rather than pasting the sentence", async () => {
    calls.length = 0;
    reply = refused(AWB_MISMATCH);

    const error = await flow.createTicket(signedIn(), BARE_CLAIM).catch((e) => e);

    assert.equal(error.message, MEESHO_INVALID_AWB);
    assert.equal(error.code, "MEESHO_INVALID_AWB");
    assert.doesNotMatch(error.message, /CLAIM_REFUSED/);
    // Meesho's instruction is the useful half, and it is kept — on the error,
    // for the log, where there is room for it.
    assert.match(error.detail, /correct reverse AWB/i);
});

test("does not mistake it for a bad sub-order number", async () => {
    /*
     * THE COLLISION THE ORDER GUARDS. Meesho's sentence names the sub-order
     * ("…for the sub order"), and the sub-order branch is the one that REFILES
     * with a different number. Reaching that branch would answer a question
     * nobody asked: the sub-order is fine, the AWB is not.
     */
    calls.length = 0;
    reply = refused(AWB_MISMATCH);

    const error = await flow.createTicket(signedIn(), BARE_CLAIM).catch((e) => e);

    assert.notEqual(error.message, INVALID_SUB_ORDER);
    assert.notEqual(error.code, "INVALID_SUB_ORDER");
});

test("catches the instruction half on its own", async () => {
    // The complaint is the half most likely to be reworded; the instruction is
    // the portal's standing advice and changes less.
    calls.length = 0;
    reply = refused("Please enter the correct reverse AWB for this return.");

    const error = await flow.createTicket(signedIn(), BARE_CLAIM).catch((e) => e);

    assert.equal(error.message, MEESHO_INVALID_AWB);
});

test("leaves a refusal that is really about the packet id alone", async () => {
    // ME6 and ME3 both concern a number typed on the row, and a pattern that
    // was a shade broader would take both.
    calls.length = 0;
    reply = refused(
        "Looks like you are filling the AWB number in the Packet ID field. " +
        "Please fill correct value in the Packet ID field."
    );

    const error = await flow.createTicket(signedIn(), BARE_CLAIM).catch((e) => e);

    assert.equal(error.message, MEESHO_INVALID_PACKET_ID);
});

// -----------------------------------------------------------------------------
// A session stored without its numeric supplier id — the ticket window's 204
// -----------------------------------------------------------------------------
// The capture kept `supplierIdentifier` but not `supplierId`. fetchTicket built
// its body (`supplier_id: 0`) before httpCall repaired the id, and Meesho
// answered HTTP 204 with nothing in it (2026-10-30). The repair now reads the
// session's own cookies (`s_id`, `current_az_identifier`), and the body is
// completed after it.

const { identityFromCookies } = require(path.resolve(__dirname, "..", "platforms/meesho/common/supplierIdentity.js"));

test("the supplier ids are read from the session's own cookies", () => {
    assert.deepEqual(identityFromCookies({ s_id: "3438", current_az_identifier: "dg97w" }), {
        supplierId: 3438,
        supplierIdentifier: "dg97w",
    });
    assert.deepEqual(identityFromCookies([{ name: "s_id", value: "7" }]), { supplierId: 7, supplierIdentifier: null });
    assert.deepEqual(identityFromCookies({}), { supplierId: null, supplierIdentifier: null });
});

test("opening a ticket on a session missing its numeric id sends the real id, not 0", async () => {
    calls.length = 0;
    reply = { status: 200, data: { data: { ticket_id: 793363925935, title: "I have received wrong return" } } };

    const ctx = { supplierId: null, supplierIdentifier: "dg97w", jar: { s_id: "3438", current_az_identifier: "dg97w" } };
    const data = await flow.fetchTicket(ctx, "793363925935");

    assert.equal(data.title, "I have received wrong return");
    assert.equal(calls[0].data.supplier_id, 3438);
    assert.equal(calls[0].data.identifier, "dg97w");
    assert.equal(calls[0].data.ticket_id, "793363925935");
});

test("a value the caller chose is never replaced", async () => {
    calls.length = 0;
    reply = { status: 200, data: { data: { ticket_id: 1 } } };

    await flow.fetchTicket({ supplierId: 5, supplierIdentifier: "abc", jar: { s_id: "3438" } }, "1");

    assert.equal(calls[0].data.supplier_id, 5);
    assert.equal(calls[0].data.identifier, "abc");
});

// -----------------------------------------------------------------------------
// An RTO is filed on Meesho's RTO form — form 1 refuses every RTO
// -----------------------------------------------------------------------------
// Verified 2026-10-30: five Delivered RTOs refused on form 1 with "only if your
// return order has been delivered"; the same claim was accepted by hand on 139,
// "I have received a wrong barcoded package in RTO".

const formList = (id, title) => ({ status: 200, data: { sub_categories: [{ sub_category_id: id, sub_category_title: title }] } });

test("a wrong-return claim on an RTO goes on form 139", async () => {
    calls.length = 0;
    reply = formList(139, "I have received a wrong barcoded package in RTO");

    const id = await flow.resolveSubCategoryIdLive(signedIn(), "I have received wrong return", { shipmentType: "RTO" });

    assert.equal(id, "139");
    assert.equal(calls[0]?.data?.sub_category_id, "139");
});

test("the RTO form is still used when Meesho cannot be asked", async () => {
    calls.length = 0;
    reply = () => {
        throw new Error("network down");
    };

    assert.equal(await flow.resolveSubCategoryIdLive(signedIn(), "I have received wrong return", { shipmentType: "rto" }), "139");
});

test("a customer return (RET) stays on form 1, as before", async () => {
    calls.length = 0;
    reply = formList(1, "I have received wrong return");

    assert.equal(await flow.resolveSubCategoryIdLive(signedIn(), "I have received wrong return", { shipmentType: "RET" }), "1");
});

test("no shipment type behaves exactly as before", async () => {
    calls.length = 0;
    reply = formList(1, "I have received wrong return");

    assert.equal(await flow.resolveSubCategoryIdLive(signedIn(), "I have received wrong return"), "1");
});
