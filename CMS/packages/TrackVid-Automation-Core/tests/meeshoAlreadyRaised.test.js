const assert = require("node:assert/strict");
const path = require("node:path");
const { test } = require("node:test");

const { recordExistingMeeshoTicket } = require(
    path.resolve(__dirname, "..", "platforms/meesho/claim-management/api-based-flow/fileClaim.js")
);
const { MEESHO_ALREADY_RAISED_NO_TICKET } = require(
    path.resolve(__dirname, "..", "common/claimErrors.js")
);

/**
 * "Ticket {{ticket_id}} has already been raised for this issue."
 *
 * THE DECISION THAT STANDS BETWEEN RECORDING A TICKET AND RAISING A SECOND
 * ONE, which is why it is a function of its own rather than a closure inside
 * the flow: a duplicate ticket for one return is the most expensive outcome
 * this platform has, and it cannot be tested through a browser and a live
 * seller account.
 *
 * THE ID IS NOT IN MEESHO'S SENTENCE — its API sends the template unrendered —
 * so the ticket has to be SEARCHED for. Two numbers may find it: the row's,
 * and the one Meesho's own returns search gave back. When they differ, the
 * difference is usually why the pre-flight dedupe found nothing.
 */

const silent = { log() {}, warn() {} };
const ticket = (over = {}) => ({ ticket_id: "790148921216", status: "open", ...over });

/** A search that answers only for the numbers it was told about. */
const searchFor = (known, seen = []) => async (sub) => {
    seen.push(sub);

    return known[sub] ? [known[sub]] : [];
};

const ROW_SUB = "3251902866908696256_1";
const MEESHO_SUB = "325190266908696256_1";

test("records the ticket when it is filed under the row's own number", async () => {
    const result = await recordExistingMeeshoTicket({
        search: searchFor({ [ROW_SUB]: ticket() }),
        candidates: [ROW_SUB, MEESHO_SUB],
        sub: ROW_SUB,
        filedAwb: "r2485756038fpl",
        log: silent,
        // Real waits are pinned in meeshoRecoverTicket; here the DECISION is
        // what matters, and living through them costs a minute per run.
        delays: [0],
    });

    assert.equal(result.ticketId, "790148921216");
    assert.equal(result.alreadyExisted, true);
    assert.equal(result.cmsStatus, "In Review");
    assert.equal(result.subOrderNumber, ROW_SUB);
    // Nothing was corrected — the row's number was right.
    assert.equal(result.correctedSubOrder, null);
});

test("finds it under Meesho's number when the row's is wrong", async () => {
    /*
     * THE CASE FROM THE LOG. The row carried 3251902866908696256_1 — one digit
     * too many — and Meesho's search returned 325190266908696256_1. The
     * pre-flight dedupe searched the row's, found nothing, filed, and was told
     * a ticket already existed. It is filed under Meesho's.
     */
    const result = await recordExistingMeeshoTicket({
        search: searchFor({ [MEESHO_SUB]: ticket() }),
        candidates: [ROW_SUB, MEESHO_SUB],
        sub: ROW_SUB,
        filedAwb: "r2485756038fpl",
        log: silent,
        // Real waits are pinned in meeshoRecoverTicket; here the DECISION is
        // what matters, and living through them costs a minute per run.
        delays: [0],
    });

    assert.equal(result.ticketId, "790148921216");
    assert.equal(result.subOrderNumber, MEESHO_SUB);
    // Reported back, so the next run does not repeat the search that failed.
    assert.equal(result.correctedSubOrder, MEESHO_SUB);
});

test("tries the row's number first, then Meesho's", async () => {
    // The row's is what the operator entered and is right most of the time;
    // going to Meesho's first would quietly prefer its answer over theirs.
    const seen = [];

    await recordExistingMeeshoTicket({
        search: searchFor({ [MEESHO_SUB]: ticket() }, seen),
        candidates: [ROW_SUB, MEESHO_SUB],
        sub: ROW_SUB,
        filedAwb: "awb",
        log: silent,
        // Real waits are pinned in meeshoRecoverTicket; here the DECISION is
        // what matters, and living through them costs a minute per run.
        delays: [0],
    });

    assert.equal(seen[0], ROW_SUB);
    assert.ok(seen.includes(MEESHO_SUB));
});

test("does not search the same number twice", async () => {
    // Both numbers are usually identical. Asking twice is a question already
    // answered, and each ask is a poll with real waits in it.
    const seen = [];

    await recordExistingMeeshoTicket({
        search: searchFor({ [ROW_SUB]: ticket() }, seen),
        candidates: [ROW_SUB, ROW_SUB, null, ""],
        sub: ROW_SUB,
        filedAwb: "awb",
        log: silent,
        // Real waits are pinned in meeshoRecoverTicket; here the DECISION is
        // what matters, and living through them costs a minute per run.
        delays: [0],
    }).catch(() => {});

    assert.deepEqual([...new Set(seen)], seen, `searched a number twice: ${seen}`);
});

test("ends in ME5 when Meesho is certain and nothing can be found", async () => {
    /*
     * TWO FACTS THAT CANNOT BOTH BE ACTED ON. Reporting the original refusal
     * reads as a plain failure and invites a retry — and retrying is exactly
     * how the ticket Meesho will not show becomes two tickets for one return.
     */
    const error = await recordExistingMeeshoTicket({
        search: searchFor({}),
        candidates: [ROW_SUB, MEESHO_SUB],
        sub: ROW_SUB,
        filedAwb: "awb",
        log: silent,
        // Real waits are pinned in meeshoRecoverTicket; here the DECISION is
        // what matters, and living through them costs a minute per run.
        delays: [0],
    }).catch((e) => e);

    assert.equal(error.message, MEESHO_ALREADY_RAISED_NO_TICKET);
    assert.equal(error.code, "MEESHO_ALREADY_RAISED_NO_TICKET");
    // What was looked under, for whoever goes to find it by hand.
    assert.match(error.detail, /3251902866908696256_1/);
    assert.match(error.detail, /325190266908696256_1/);
});

test("ends in ME5 rather than throwing when there is no number at all", async () => {
    // A row that never carried a sub-order number still reaches here. It must
    // say what it knows, not fail on an empty list.
    const error = await recordExistingMeeshoTicket({
        search: searchFor({}),
        candidates: [null, ""],
        sub: null,
        filedAwb: "awb",
        log: silent,
        // Real waits are pinned in meeshoRecoverTicket; here the DECISION is
        // what matters, and living through them costs a minute per run.
        delays: [0],
    }).catch((e) => e);

    assert.equal(error.code, "MEESHO_ALREADY_RAISED_NO_TICKET");
    assert.match(error.detail, /no sub-order number/i);
});

test("never reports a ticket it did not find", async () => {
    // A search answering with a row that carries no id is not a ticket.
    // Recording it would write a blank ticket number onto the row and close it.
    const error = await recordExistingMeeshoTicket({
        search: async () => [{ status: "open" }],
        candidates: [ROW_SUB],
        sub: ROW_SUB,
        filedAwb: "awb",
        log: silent,
        // Real waits are pinned in meeshoRecoverTicket; here the DECISION is
        // what matters, and living through them costs a minute per run.
        delays: [0],
    }).catch((e) => e);

    assert.equal(error.code, "MEESHO_ALREADY_RAISED_NO_TICKET");
});
