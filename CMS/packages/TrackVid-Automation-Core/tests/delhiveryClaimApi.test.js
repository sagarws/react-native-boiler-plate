const assert = require("node:assert/strict");
const path = require("node:path");
const { test } = require("node:test");

/**
 * The two Delhivery requests that were once guesses.
 *
 * Both were assembled by inference because the original capture stripped POST
 * bodies, and both were wrong: the AWB search asked `forward_orders` for a
 * REVERSE leg and was answered 400 on every call, and the claim submit sent
 * flat JSON where the portal sends multipart. A live capture (2026-09-20, AWB
 * 29123116000212 → ticket J1789925203929469) settled both, and these tests
 * hold the shapes to it — the field names here are not ours to choose, and a
 * rename is a broken claim nobody sees until a submit fails.
 *
 * axios is stubbed through the require cache before the flow is loaded: it is
 * the module's only way out to the network, so the request it would have sent
 * is exactly what lands in `calls`.
 */

const ROOT = path.resolve(__dirname, "..", "..", "..");
const axiosPath = require.resolve("axios", { paths: [ROOT] });

const calls = [];
let reply = { status: 200, data: { results: [] } };

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

const flow = require("../platforms/delhivery/claim-management/api-based-flow/claimApiFlow.js");

/** A token carrying exactly the claims the flow reads out of it. */
const tokenFor = (payload) =>
    `x.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.y`;

const EXPRESS = "cms::client::f21a90b3-f015-11ee-b245-06c7672f963d";
const SURFACE = "cms::client::0796af0f-52a5-11f1-8d4f-0acfbd2bd84d";

const reset = () => {
    calls.length = 0;
    reply = { status: 200, data: { results: [] } };
};

test("the AWB search asks for FORWARD, the only leg this endpoint has", async () => {
    reset();
    await flow.searchShipments({ accessToken: tokenFor({}) }, { awb: "29123116000212" });

    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /\/forward_orders\/hq_es_shipments_search\/list$/);
    // ["REVERSE"] here is what answered 400 INVALID_OR_MISSING_PARAMS on every
    // claim: `forward_orders` has no reverse leg, and an RTO is a FORWARD
    // shipment anyway.
    assert.deepEqual(calls[0].data.filter_shipment_type, ["FORWARD"]);
    assert.equal(calls[0].data.search_term, "29123116000212");
    assert.deepEqual(calls[0].data.search_on, ["oid", "wbn"]);
    // The portal stamps one on every call; ours went without it.
    assert.match(calls[0].headers["x-ucp-request-id"], /^[0-9a-f-]{36}$/);
});

test("a waybill the filtered search misses is looked for in the search box", async () => {
    reset();
    reply = (config) =>
        String(config.url).endsWith("/global_search")
            ? { status: 200, data: { results: [{ awb_number: "29123116000212" }] } }
            : { status: 200, data: { results: [] } };

    const shipment = await flow.assertAwbExists({ accessToken: tokenFor({}) }, "29123116000212");

    assert.equal(shipment.awb_number, "29123116000212");
    // Last resort, after the filtered search and the lookup by AWB both came
    // back empty.
    assert.deepEqual(calls[2].data, {
        page: 1,
        page_size: 10,
        search_by: "WBN",
        search_term: "29123116000212",
    });
});

test("a return shipment is found by AWB, with its value, before the summary-only search", async () => {
    // Recorded 2026-10-28: 26472713456644 is a DTO pickup. The FORWARD search
    // answers nothing; the lookup by AWB — the portal's own, just before it
    // uploads — answers the REVERSE row with its value.
    reset();
    reply = (config) =>
        config.data && Array.isArray(config.data.filter_awb_number)
            ? {
                status: 200,
                data: {
                    results: [{
                        awb_number: "26472713456644",
                        shipment_type: "REVERSE",
                        cod_amount: null,
                        grand_total_value: 1020,
                    }],
                },
            }
            : { status: 200, data: { results: [] } };

    const shipment = await flow.assertAwbExists({ accessToken: tokenFor({}) }, "26472713456644");

    assert.equal(shipment.shipment_type, "REVERSE");
    assert.equal(flow.shipmentAmountOf(shipment), 1020);
    assert.deepEqual(calls[1].data, {
        filter_awb_number: ["26472713456644"],
        page: 1,
        page_size: 10,
        search_on: ["oid", "wbn"],
    });
    // Found, so the global search was never needed.
    assert.equal(calls.some((c) => String(c.url).endsWith("/global_search")), false);
});

test("the liability preview is the claim amount of last resort", async () => {
    reset();
    reply = { status: 200, data: { data: { data: { claim_amount: 1020, max_liability: 1020 } } } };

    assert.equal(await flow.liabilityPreviewAmount({ accessToken: tokenFor({}) }, "26472713456644"), 1020);
    assert.deepEqual(calls[0].data, { wbn: "26472713456644" });

    // Refused or empty: no amount, and no throw.
    reset();
    reply = { status: 500, data: {} };
    assert.equal(await flow.liabilityPreviewAmount({ accessToken: tokenFor({}) }, "x"), null);
});

test("a claim already raised through Support is found before anything is filed", async () => {
    // The claims list does not show a claim filed a minute ago; this list does
    // (J1793190060742161, recorded 2026-10-28).
    reset();
    const ticket = (overrides) => ({
        tracking_id: "26472713456644",
        category: "Claim LnD B2C",
        status: "open",
        public_ticket_id: "J1793190060742161",
        ...overrides,
    });
    reply = (config) =>
        config.data.status[0] === "CLOSED"
            // A closed QUERY on the same AWB must neither count nor hide the claim.
            ? { status: 200, data: { results: [ticket({ category: "Delivery Related", public_ticket_id: "J1" })] } }
            : config.data.status[0] === "OPEN"
                ? { status: 200, data: { results: [ticket({})] } }
                : { status: 200, data: { results: [] } };

    const found = await flow.findClaimTicketByAwb({ accessToken: tokenFor({}) }, "26472713456644");

    assert.equal(found.publicTicketId, "J1793190060742161");
    assert.equal(found.category, "Claim LnD B2C");
    assert.deepEqual(calls.map((c) => c.data.status[0]), ["CLOSED", "RESOLVED", "OPEN"]);
});

test("a ticket that is not a claim, or is for another AWB, does not count as filed", async () => {
    reset();
    reply = {
        status: 200,
        data: {
            results: [
                { tracking_id: "26472713456644", category: "Delivery Related", public_ticket_id: "J1" },
                { tracking_id: "99999999999999", category: "Claim LnD B2C", public_ticket_id: "J2" },
            ],
        },
    };

    assert.equal(await flow.findClaimTicketByAwb({ accessToken: tokenFor({}) }, "26472713456644"), null);
});

test("the claim amount comes off the shipment, as the portal's own form does", () => {
    // Nobody types this: the portal fills it in from the shipment the moment an
    // AWB is entered. 1384 on the shipment, 1384 on the ticket filed from it.
    assert.equal(flow.shipmentAmountOf({ cod_amount: 1384, grand_total_value: 1384 }), 1384);
    // Prepaid: there is no COD to collect, and the parcel's value stands in.
    assert.equal(flow.shipmentAmountOf({ cod_amount: 0, grand_total_value: 999 }), 999);
    assert.equal(flow.shipmentAmountOf({}), null);
});

test("an AWB on the other HQ client is found, and the session switches to it", async () => {
    reset();
    const ctx = { accessToken: tokenFor({ allowed_hq_clients: [EXPRESS, SURFACE] }), hqClientId: SURFACE };

    // The lane split, as Delhivery serves it: the same body under the wrong
    // client is a 200 with nothing in it, never an error.
    reply = (config) =>
        config.headers["x-hq-client-id"] === EXPRESS
            ? {
                status: 200,
                data: {
                    results: [{
                        awb_number: "29123116000212",
                        client_uuid: EXPRESS,
                        client_name: "UNIVERSAL SPORTSBIZ EXPRESS",
                        cod_amount: 1384,
                        box_list: [{ shipping_mode: "EXPRESS" }],
                    }],
                },
            }
            : { status: 200, data: { results: [] } };

    const shipment = await flow.assertAwbExists(ctx, "29123116000212", { domestic: "EXPRESS" });

    assert.equal(shipment.awb_number, "29123116000212");
    // The row names its own owner, and that is what the session keeps.
    assert.equal(ctx.hqClientId, EXPRESS, "the session must keep the client that owns the AWB");
    assert.equal(flow.shipmentAmountOf(shipment), 1384);
});

test("a client that REFUSES the search does not end the sweep", async () => {
    reset();
    const ctx = { accessToken: tokenFor({ allowed_hq_clients: [EXPRESS, SURFACE] }), hqClientId: SURFACE };

    /**
     * The failure this test exists for, in the gateway's own words.
     *
     * A client that cannot serve the shipment search does not answer "nothing
     * found" — it answers 400 INVALID_OR_MISSING_PARAMS, "Could not load your
     * dashboard. Please refresh the page." That threw out of the search, out of
     * the global-search fallback and out of the cross-client sweep, so an
     * account whose session pointed at the wrong client failed EVERY claim
     * while the other client held the waybill the whole time.
     */
    reply = (config) =>
        config.headers["x-hq-client-id"] === EXPRESS
            ? {
                status: 200,
                data: {
                    results: [{
                        awb_number: "55406810306902",
                        client_uuid: EXPRESS,
                        client_name: "UNIVERSAL SPORTSBIZ EXPRESS",
                        cod_amount: 1649,
                        box_list: [{ shipping_mode: "EXPRESS" }],
                    }],
                },
            }
            : {
                status: 400,
                data: {
                    module: "app-gateway",
                    error_code: "INVALID_OR_MISSING_PARAMS",
                    message: "Could not load your dashboard. Please refresh the page.",
                },
            };

    const shipment = await flow.assertAwbExists(ctx, "55406810306902", { domestic: "EXPRESS" });

    assert.equal(shipment.awb_number, "55406810306902");
    assert.equal(ctx.hqClientId, EXPRESS, "the sweep must reach the client that owns the AWB");
    assert.equal(flow.shipmentAmountOf(shipment), 1649);
});

test("an AWB on no client is a permanent AWB_NOT_FOUND", async () => {
    reset();
    const ctx = { accessToken: tokenFor({ allowed_hq_clients: [EXPRESS, SURFACE] }), hqClientId: EXPRESS };

    await assert.rejects(
        () => flow.assertAwbExists(ctx, "00000000000000"),
        (err) => err.code === "AWB_NOT_FOUND"
    );
});

test("the claim submit is multipart with a ticket_request blob", async () => {
    reset();
    reply = { status: 200, data: { public_ticket_id: "J1789925203929469", ticket_id: "uuid", duplicate: false } };

    const result = await flow.createTicket(
        { accessToken: tokenFor({ email: "seller@example.com" }) },
        {
            awbNumber: "29123116000212",
            subcategory: "Damage in delivered/returned shipment",
            claimType: "Received used or damaged product",
            description: "the claim text",
            claimAmount: 1384,
            files: [
                {
                    s3_key: "uploads/cms_customer_upload/29123116000212_1_Unbox_Image_1.png",
                    content_type: "image/png",
                    file_size: 2631829,
                    identifier: "Unbox_Image_1.png",
                },
            ],
        }
    );

    const submit = calls.find((c) => String(c.url).endsWith("/create_ticket"));

    assert.ok(submit, "create_ticket was called");
    assert.match(submit.headers["content-type"], /^multipart\/form-data; boundary=/);

    const body = submit.data.getBuffer().toString("utf8");
    assert.match(body, /name="ticket_request"; filename="blob"/);

    const json = JSON.parse(body.slice(body.indexOf("{"), body.lastIndexOf("}") + 1));

    assert.equal(json.category, "Claim LnD B2C");
    assert.equal(json.sub_category, "Damaged");
    // THE FIELD WHOSE ABSENCE COST A CLAIM. Without it the portal answers 200
    // with no ticket id — no error, nothing to act on — and the row goes to
    // Failed against a claim that may or may not exist. "WBN" is a waybill
    // number, which is what every claim here is keyed on.
    assert.equal(json.object_type, "WBN");
    assert.equal(json.ref_nums, "29123116000212");
    assert.equal(json.claim_amount, 1384);
    // The account the gateway authenticated, read from the token rather than
    // plumbed through every caller.
    assert.equal(json.email_id, "seller@example.com");

    // A STRING of JSON, nested exactly as the portal nests it.
    assert.equal(typeof json.media_context, "string");
    const media = JSON.parse(json.media_context);
    assert.equal(media.upload_type, "CUSTOMER_UPLOAD");
    assert.equal(media.source, "CMS");
    assert.equal(media.uploaded_files[0].identifier, "Unbox_Image_1.png");
    assert.equal(media.uploaded_files[0].file_size, 2631829);

    // None of the invented field names survive.
    for (const gone of ["raised_from", "awb_number", "attachment_keys", "claim_type", "domestic"]) {
        assert.equal(gone in json, false, `${gone} is not a field the portal sends`);
    }

    assert.equal(result.publicTicketId, "J1789925203929469");
});

test("a claim with no amount is sent without one rather than for zero", async () => {
    reset();
    reply = { status: 200, data: { public_ticket_id: "J1", duplicate: false } };

    await flow.createTicket(
        { accessToken: tokenFor({ email: "seller@example.com" }) },
        { awbNumber: "1", subcategory: "Missing shipment delivered/returned", files: [] }
    );

    const submit = calls.find((c) => String(c.url).endsWith("/create_ticket"));
    const body = submit.data.getBuffer().toString("utf8");
    const json = JSON.parse(body.slice(body.indexOf("{"), body.lastIndexOf("}") + 1));

    assert.equal("claim_amount" in json, false);
    // "Missing shipment delivered/returned" is a CONTENT MISMATCH to this
    // portal — see the mapping test for why that is not the obvious answer.
    assert.equal(json.sub_category, "Content Mismatch");
    // Nothing on the row said what this claim is about, so the portal's own
    // sentence stands in — blank descriptions are rejected.
    assert.match(json.description, /AWB# 1/);
});

test("the drawer's labels map to the words the API actually takes", () => {
    /*
     * NOT THE OBVIOUS MAPPING, and that is the point. Both of these are from
     * submits that came back with a ticket id:
     *
     *   "Received used or damaged product"   → "Damaged"
     *   "Item missing or received empty box" → "Content Mismatch"
     *
     * An empty box is a CONTENT MISMATCH to this portal. A rule that read the
     * claim's own wording would send "Missing", which the portal does not have
     * — and a name it does not have comes back as 200 with no ticket at all.
     */
    assert.equal(flow.subCategoryFor({ subcategory: "Damage in delivered/returned shipment" }), "Damaged");
    assert.equal(flow.subCategoryFor({ subcategory: "Missing shipment delivered/returned" }), "Content Mismatch");
    assert.equal(flow.subCategoryFor({ subcategory: "Mismatch in delivered/returned shipment" }), "Content Mismatch");
    assert.equal(flow.subCategoryFor({ claimType: "Item missing or received empty box" }), "Content Mismatch");
    assert.equal(flow.subCategoryFor({ claimType: "Received wrong product" }), "Content Mismatch");

    // The row's own subcategory is the more specific of the two, so it is read
    // first — the halves can disagree, and the vaguer one must not win.
    assert.equal(
        flow.subCategoryFor({
            subcategory: "Damage in delivered/returned shipment",
            claimType: "Item missing or received empty box",
        }),
        "Damaged"
    );

    // Nothing to go on: the claim is still filed, under a name the portal has.
    assert.equal(flow.subCategoryFor({}), "Damaged");
});

test("the freight lane is read from the shipment itself", () => {
    assert.equal(flow.shippingModeOf({ box_list: [{ shipping_mode: "EXPRESS" }] }), "EXPRESS");
    // The summary rows carry no box list; the client's name still says which
    // lane it is ("UNIVERSAL SPORTSBIZ SURFACE").
    assert.equal(flow.shippingModeOf({ client_name: "UNIVERSAL SPORTSBIZ SURFACE" }), "SURFACE");
    assert.equal(flow.shippingModeOf({ box_list: [] }), null);
    assert.equal(flow.shippingModeOf(null), null);
});

// -----------------------------------------------------------------------------
// Finding the ticket a lost reply left behind
// -----------------------------------------------------------------------------

/** The portal's own row, from a live lookup (2026-10-01). */
const TICKET_ROW = {
    ticket_id: "6acc1eb8-dfaf-4af2-9108-bb493797e37f",
    public_ticket_id: "J1790859523117080",
    status: "rejected",
    tracking_id: "55406810335613",
    category: "Claim LnD B2C",
    sub_category: "Content Mismatch",
};

test("asks one status bucket at a time, as the portal does", async () => {
    /*
     * ALL FOUR IN ONE `status` ARRAY WAS THE BUG. Every call came back 400
     * INVALID_OR_MISSING_PARAMS — the gateway's catch-all "Could not load your
     * dashboard" — so the recovery that exists to stop duplicate claims could
     * never answer, and a submit whose reply was lost became a Failed row
     * against a ticket that was really there.
     */
    reset();
    reply = { status: 200, data: { results: [TICKET_ROW] } };

    const found = await flow.findTicketByAwb({ accessToken: tokenFor({}) }, "55406810335613");

    assert.equal(found.publicTicketId, "J1790859523117080");
    assert.deepEqual(calls[0].data, {
        page: 1,
        status: ["CLOSED"],
        ref_num: "55406810335613",
    });
    // Stops at the first bucket that answers — three more calls for a ticket
    // already in hand would be three more chances to be refused.
    assert.equal(calls.length, 1);
});

test("keeps looking when a bucket comes back empty", async () => {
    reset();
    reply = (config) =>
        config.data.status[0] === "OPEN"
            ? { status: 200, data: { results: [TICKET_ROW] } }
            : { status: 200, data: { results: [] } };

    const found = await flow.findTicketByAwb({ accessToken: tokenFor({}) }, "55406810335613");

    assert.equal(found.publicTicketId, "J1790859523117080");
    assert.deepEqual(calls.map((c) => c.data.status[0]), ["CLOSED", "RESOLVED", "OPEN"]);
});

test("one refused bucket does not lose the three that might hold it", async () => {
    // This runs AFTER a failure, so a refusal on one status is the likeliest
    // thing in the world here — and the ticket is usually in another bucket.
    reset();
    reply = (config) =>
        config.data.status[0] === "CLOSED"
            ? { status: 400, data: { error_code: "INVALID_OR_MISSING_PARAMS" } }
            : { status: 200, data: { results: [TICKET_ROW] } };

    const found = await flow.findTicketByAwb({ accessToken: tokenFor({}) }, "55406810335613");

    assert.equal(found.publicTicketId, "J1790859523117080");
});

test("takes the row for THIS waybill, not simply the first", async () => {
    // What this feeds writes a ticket number onto a claim. A number from a
    // neighbouring parcel is worse than no number at all.
    reset();
    reply = {
        status: 200,
        data: {
            results: [
                { ...TICKET_ROW, public_ticket_id: "J-OTHER", tracking_id: "99999999999999" },
                TICKET_ROW,
            ],
        },
    };

    const found = await flow.findTicketByAwb({ accessToken: tokenFor({}) }, "55406810335613");

    assert.equal(found.publicTicketId, "J1790859523117080");
    // The portal's own word for the outcome, which is NOT the bucket it was
    // found in: filtered under CLOSED, the row reads "rejected".
    assert.equal(found.ticketStatus, "rejected");
});

test("answers null when the AWB genuinely has no ticket", async () => {
    // Not an error: it is the ordinary case, and the caller reports the
    // original failure rather than inventing a recovery.
    reset();
    reply = { status: 200, data: { results: [] } };

    assert.equal(await flow.findTicketByAwb({ accessToken: tokenFor({}) }, "1"), null);
    assert.equal(calls.length, 4, "every bucket was asked before giving up");
});

test("an internal ticket id resolves to its J-number, matched on ticket_id", async () => {
    // Recorded 2026-10-28: the claims list's jarvis_ticket_id 8a2e5b88-… is the
    // support list's ticket_id for J1793190060742161.
    reset();
    reply = (config) =>
        config.data.status[0] === "OPEN"
            ? {
                status: 200,
                data: {
                    results: [
                        { ticket_id: "15036fe8-3d27-4048-86cf-56826f8c7ca4", public_ticket_id: "J1" },
                        { ticket_id: "8a2e5b88-b076-4e66-b90e-e7b9b26a6cd3", public_ticket_id: "J1793190060742161" },
                    ],
                },
            }
            : { status: 200, data: { results: [] } };

    const ctx = { accessToken: tokenFor({}) };

    assert.equal(
        await flow.resolvePublicTicketId(ctx, "26472713456644", "8A2E5B88-B076-4E66-B90E-E7B9B26A6CD3"),
        "J1793190060742161"
    );
    // A J-number is not an internal id: nothing is asked.
    reset();
    assert.equal(await flow.resolvePublicTicketId(ctx, "26472713456644", "J1793190060742161"), null);
    assert.equal(calls.length, 0);
});

test("an internal id with no matching ticket resolves to nothing, not a guess", async () => {
    reset();
    reply = { status: 200, data: { results: [{ ticket_id: "other", public_ticket_id: "J9" }] } };

    assert.equal(
        await flow.resolvePublicTicketId({ accessToken: tokenFor({}) }, "x", "587232ca-22bb-4a34-ba64-695710378968"),
        null
    );
});
