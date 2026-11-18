const assert = require("node:assert/strict");
const { test } = require("node:test");

const {
    asLog,
    cmsStatusForTab,
} = require("../platforms/delhivery/claim-management/script-based-flow/fileClaim.js");

/**
 * The drawer sequence's own plumbing.
 *
 * WHAT THIS IS FOR. The sequence is shared by two runners that log differently:
 * the server hands it `console`, the desktop app hands it its own logger, which
 * has `info` and no `log` at all. Asking for console's shape threw
 * `log.log is not a function` — and it threw from inside the prior-claim
 * recovery, AFTER Delhivery had said a ticket already existed, so the one
 * outcome that recovery exists to produce was the one it could not report. The
 * claim came back "failed" over a logging call.
 */

test("takes the desktop app's logger, which has no .log", () => {
    const said = { info: [], warn: [] };
    const log = asLog({
        info: (message) => said.info.push(message),
        warn: (message) => said.warn.push(message)
    });

    log.log("a step");
    log.warn("a wobble");

    assert.deepEqual(said.info, ["a step"]);
    assert.deepEqual(said.warn, ["a wobble"]);
});

test("takes console, which is what the server passes", () => {
    const log = asLog(console);

    assert.equal(typeof log.log, "function");
    assert.equal(typeof log.warn, "function");
});

test("never goes silent on a logger it does not recognise", () => {
    // Every line here is a step somebody is watching a browser perform, so a
    // shape this does not know falls back to console rather than to nothing.
    assert.doesNotThrow(() => asLog({}).log("still said"));
    assert.doesNotThrow(() => asLog(null).warn("still said"));
    assert.doesNotThrow(() => asLog(undefined).log("still said"));
});

test("warns through whatever the logger has", () => {
    // A logger with only `info` still gets the warning — losing it would hide
    // "the prior-ticket lookup failed", which is the line that explains the
    // notice the claim then fails with.
    const said = [];

    asLog({ info: (message) => said.push(message) }).warn("lookup failed");

    assert.deepEqual(said, ["lookup failed"]);
});

test("a tab is a verdict, and Open is not one", () => {
    // Resolved means Delhivery approved it, Closed means it refused. Open says
    // only that the claim exists — writing a status from it would overwrite a
    // real verdict with a guess.
    assert.equal(cmsStatusForTab("resolved"), "Approved");
    assert.equal(cmsStatusForTab("closed"), "Rejected");
    assert.equal(cmsStatusForTab("open"), null);
    assert.equal(cmsStatusForTab(null), null);
});

// -----------------------------------------------------------------------------
// Reading the ticket row — which ticket number goes onto which claim
// -----------------------------------------------------------------------------

const {
    readTicketRow,
    SEARCH_SETTLE_MS,
} = require("../platforms/delhivery/claim-management/common/utils.js");

/** A tickets-table row, as the page builds it: the cell holds BOTH ids. */
const row = (ticketId, awb) => {
    const cell = {
        innerText: `${ticketId} ${awb}`,
        querySelector: (selector) =>
            selector.includes("text-cta-primary") ? { textContent: ticketId } : null,
    };

    return {
        innerText: `${ticketId} ${awb}`,
        querySelector: (selector) =>
            selector.includes("TICKET ID") ? cell : null,
    };
};

/** Stands the page up around a set of rows. */
const page = (rows, { emptyState = false } = {}) => {
    global.document = {
        querySelector: (selector) => {
            if (selector === "table.ap-table") {
                return rows === null ? null : { querySelectorAll: () => rows };
            }

            return emptyState ? {} : null;
        },
    };
};

test("takes the row for THIS waybill, not the first row", () => {
    /*
     * THE BUG, EXACTLY. The search is submitted against a table that is already
     * on screen, so for a moment the rows are the PREVIOUS, unfiltered result.
     * Reading the first row then put another parcel's ticket number onto this
     * claim — the AWB reads as handled, its real ticket is untracked, and the
     * number on the row belongs to somebody else's claim.
     */
    page([row("J-OTHER", "99999999999999"), row("J-MINE", "29123115984856")]);

    assert.deepEqual(readTicketRow("29123115984856"), {
        status: "found",
        ticketId: "J-MINE",
    });
});

test("says STALE when the rows are other parcels, so the caller waits", () => {
    // Not empty and not found: the search has not landed yet. Collapsing this
    // into either one is what made the wrong answer look like an answer.
    page([row("J-OTHER", "99999999999999")]);

    assert.deepEqual(readTicketRow("29123115984856"), { status: "stale", rows: 1 });
});

test("knows the difference between loading and genuinely empty", () => {
    // "No ticket exists for this AWB" is a real outcome — the claim was just
    // filed and the list has not caught up — and it has to be distinguishable
    // from a table that has not rendered.
    page(null);
    assert.deepEqual(readTicketRow("1"), { status: "loading" });

    page([], { emptyState: true });
    assert.deepEqual(readTicketRow("1"), { status: "empty" });

    page([]);
    assert.deepEqual(readTicketRow("1"), { status: "loading" });
});

test("reads Delhivery's own no-data row as empty", () => {
    page([{ innerText: "No data found", querySelector: () => null }]);

    assert.deepEqual(readTicketRow("1"), { status: "empty" });
});

test("waits before the first read, and that wait is tunable", () => {
    // The settle is the cheap half of the fix; the AWB match above is the half
    // that makes a wrong ticket impossible rather than unlikely.
    assert.equal(SEARCH_SETTLE_MS, 2000);
});
