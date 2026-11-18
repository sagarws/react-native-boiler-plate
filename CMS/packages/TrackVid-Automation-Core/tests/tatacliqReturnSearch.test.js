const assert = require("node:assert/strict");
const path = require("node:path");
const { test } = require("node:test");

const { findReturn, SEARCH_BY_REVERSE_AWB } = require(
    path.resolve(__dirname, "..", "platforms/tatacliq/claim-management/api-based-flow/claimApiFlow.js")
);

/**
 * Finding a return by its reverse AWB — the QC panel's own search.
 *
 * THE BUG THIS PINS, and why it survived so long. The request was sent as
 * JSON:
 *
 *     Content-Type: application/json
 *     {"searchText":"2377760377949","selectDD":"revAwb"}
 *
 * while the portal's own XHR sends form-encoded — captured 2026-09-24 from
 * EarlyRefundQC.jsp:
 *
 *     Content-Type: application/x-www-form-urlencoded; charset=UTF-8
 *     searchText=2377760377949&selectDD=revAwb
 *
 * These endpoints are JSPs reading `request.getParameter("searchText")`, and a
 * JSON body carries no parameters. So the portal answered **200 with the panel
 * rendered and empty**: no row, no error, nothing anywhere saying the request
 * had been ignored. Every Tata CliQ claim reported "no claim found for this
 * AWB" on a return that was sitting in the panel.
 *
 * A 200 that means "I ignored you" is the failure mode worth a test, because
 * nothing else in the system can tell it from an AWB that genuinely is not
 * there.
 */

/**
 * The panel's answer for a row that exists — the portal's own markup, from the
 * 2026-09-24 capture, trimmed to what the parser reads and with the customer's
 * name and address removed.
 *
 * Written from the real response rather than invented, because the parser keys
 * on the portal's ids and classes: `removeCIRInward_<transId>`, and
 * `commonPopper_<awb>` whose class carries FWD or REV. A hand-made fixture
 * would pass while the real thing did not.
 */
const ROW_HTML = `
 <div class="col-12" id="finalTable">
  <div id="removeCIRInward_129602062267213" class="CNCNDRCIRHeader">
   <ul class="user-search row tableheading">
    <li class="width-srno">Sr.No</li>
    <li class="width-1 light-blue">Forward AWB</li>
    <li class="width-1">Invoice Number</li>
    <li class="width-1 revawbbuttton light-blue">Reverse AWB</li>
    <li class="width-1">CRM Ticket<br>Number</li>
    <li class="width-2 light-blue">Product Name</li>
   </ul>
   <ul class="user-search row imgHoverFullView">
    <li class="width-srno">1</li>
    <li class="width-1 light-blue">
     <a href="#" class="commonPopper FWD" id="commonPopper_14136861584362"
        data-popbox="commonPop_14136861584362">14136861584362</a></li>
    <li class="width-1">G3312726CA000665</li>
    <li class="width-1 revawbbuttton light-blue">
     <a href="#" class="commonPopper REV" id="commonPopper_2377760377949"
        data-popbox="commonPop_2377760377949">2377760377949</a></li>
    <li class="width-1"></li>
    <li class="width-2 light-blue">WROGN Men&#39;s White &amp; Beige Sneakers</li>
   </ul>
   <input id="Inward_129602062267213" type="button" value="QC Fail" />
  </div>
 </div>`;

/** A page that records exactly what was sent from inside it. */
const capturingPage = (sent, responseHtml = ROW_HTML) => ({
    evaluate: async (fn, target, verb, payload, asForm, referer) => {
        // Run the real in-page function against a stubbed fetch, so what is
        // asserted is what the browser would actually have sent.
        const calls = [];

        global.fetch = async (url, init) => {
            calls.push({ url, init });

            return { status: 200, ok: true, text: async () => responseHtml };
        };

        try {
            const result = await fn(target, verb, payload, asForm, referer);

            sent.push(calls[0]);

            return result;
        } finally {
            delete global.fetch;
        }
    },
});

test("sends the search form-encoded, the way the portal does", async () => {
    const sent = [];

    await findReturn(capturingPage(sent), "2377760377949");

    const { init } = sent[0];

    assert.equal(
        init.headers["Content-Type"],
        "application/x-www-form-urlencoded; charset=UTF-8",
        "sent as JSON — the JSP reads getParameter() and will see nothing"
    );
    assert.equal(init.body, "searchText=2377760377949&selectDD=revAwb");
});

test("never sends a JSON body to this endpoint", async () => {
    // The precise regression. It answered 200 either way, so only the request
    // shape can catch it.
    const sent = [];

    await findReturn(capturingPage(sent), "2377760377949");

    const { init } = sent[0];

    assert.notEqual(init.headers["Content-Type"], "application/json");
    assert.doesNotMatch(String(init.body), /^\s*\{/, "body is JSON");
});

test("searches by the portal's own code for reverse AWB", async () => {
    // `revAwb`, not the label "Reverse AWB" the dropdown displays. The portal
    // posts the code; the label matches no option server-side.
    assert.equal(SEARCH_BY_REVERSE_AWB, "revAwb");

    const sent = [];

    await findReturn(capturingPage(sent), "2377760377949");

    assert.match(String(sent[0].init.body), /selectDD=revAwb/);
});

test("escapes a value rather than pasting it into the body", async () => {
    // An AWB is alphanumeric, but the encoder is shared and a stray `&` or `=`
    // would silently split one parameter into two.
    const sent = [];

    await findReturn(capturingPage(sent), "A&B=C 1");

    assert.match(String(sent[0].init.body), /searchText=A%26B%3DC(%20|\+)1/);
});

test("reads the row out of the panel it gets back", async () => {
    const found = await findReturn(capturingPage([]), "2377760377949");

    assert.equal(found.found, true);
    assert.equal(found.forwardAwb, "14136861584362");
    assert.equal(found.reverseAwb, "2377760377949");
    assert.equal(found.transId, "129602062267213");
    // The portal renders the QC buttons only for a row it will accept a
    // decision on — which is its own answer to "can this be claimed".
    assert.equal(found.claimable, true);
    // The HTML rides along — a row that did not parse is a report worth the
    // markup, and the QC sub-reason list lives in there too.
    assert.ok(found.html.includes("finalTable"));
});

test("an empty panel is not found, and does not throw", async () => {
    /*
     * WHAT THE JSON REQUEST PRODUCED: 200, the panel rendered, no row in it.
     * Indistinguishable from an AWB that genuinely is not on this slave — which
     * is exactly why the wire format above is asserted rather than inferred
     * from behaviour.
     */
    const found = await findReturn(capturingPage([], '<div id="finalTable"></div>'), "X");

    assert.equal(found.found, false);
});

test("refuses to search for nothing", async () => {
    // A blank AWB would return the panel's default page and parse as a row
    // belonging to whatever is first on it.
    await assert.rejects(() => findReturn(capturingPage([]), ""), /reverse AWB is required/i);
});
