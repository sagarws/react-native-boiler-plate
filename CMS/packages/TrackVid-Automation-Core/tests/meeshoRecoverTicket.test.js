const assert = require("node:assert/strict");
const path = require("node:path");
const { test } = require("node:test");

const {
    recoverTicket,
    VERIFY_DELAYS_MS,
} = require(
    path.resolve(__dirname, "..", "platforms/meesho/claim-management/api-based-flow/fileClaim.js")
);

/**
 * Finding the ticket Meesho says already exists.
 *
 * TWO REFUSALS END HERE, and both are the same shape: Meesho has a ticket and
 * we do not know its number.
 *
 *   "Ticket {{ticket_id}} has already been raised for this issue."  — and the
 *     id is NOT in that sentence: the API sends the template unrendered, so
 *     there is nothing to parse and the ticket has to be searched for.
 *   A bare 500 that created the ticket and lost the response.
 *
 * Either way the row needs the NUMBER and the STATUS, because without them it
 * sits on Failed to Proceed with a live ticket nobody is tracking, and every
 * retry asks Meesho the same question again.
 *
 * WHY IT POLLS. A ticket created a moment ago is not in the search index yet,
 * so a single read finds nothing and concludes there is no ticket — which is
 * how a duplicate gets raised on the next run.
 *
 * The search is passed IN, so this pins the waiting and the giving up rather
 * than Meesho's endpoint.
 */

const silent = { log() {}, warn() {} };

/** A ticket row, in the shapes Meesho spells it across builds. */
const ticket = (over = {}) => ({ ticket_id: "790148921216", status: "open", ...over });

test("returns the ticket and its status when the search finds one", async () => {
    const found = await recoverTicket(async () => [ticket()], "3295_1", {
        delays: [0],
        log: silent,
    });

    assert.equal(found.ticketId, "790148921216");
    assert.equal(found.meeshoStatus, "open");
    // Mapped for the row, not left in Meesho's vocabulary.
    assert.equal(found.cmsStatus, "In Review");
});

test("keeps looking while the ticket is not in the index yet", async () => {
    /*
     * THE WHOLE REASON THIS POLLS. A ticket created a moment ago is not
     * searchable immediately; a single read would conclude there is none and
     * the next run would raise a second one for the same return.
     */
    let asked = 0;

    const found = await recoverTicket(
        async () => {
            asked += 1;

            return asked < 3 ? [] : [ticket()];
        },
        "3295_1",
        { delays: [0, 0, 0], log: silent }
    );

    assert.equal(asked, 3);
    assert.equal(found.ticketId, "790148921216");
});

test("gives up rather than inventing a ticket", async () => {
    // Nothing found after every window. The caller's original error is still
    // the truth, and a success nobody can point at is worse than the failure.
    const found = await recoverTicket(async () => [], "3295_1", { delays: [0, 0], log: silent });

    assert.equal(found, null);
});

test("a failing search is not evidence that there is no ticket", async () => {
    // A network error is not an answer. It tries the next window instead of
    // reporting "no ticket" — which would invite a duplicate.
    let asked = 0;

    const found = await recoverTicket(
        async () => {
            asked += 1;

            if (asked === 1) throw new Error("ECONNRESET");

            return [ticket()];
        },
        "3295_1",
        { delays: [0, 0], log: silent }
    );

    assert.equal(found.ticketId, "790148921216");
});

test("reads the id under any of the names Meesho gives it", async () => {
    for (const [field, value] of [
        ["ticket_id", "T1"],
        ["ticketId", "T2"],
        ["jira_key", "T4"],
    ]) {
        const found = await recoverTicket(async () => [{ [field]: value }], "s", {
            delays: [0],
            log: silent,
        });

        assert.equal(found.ticketId, value, `missed ${field}`);
    }
});

test("a row with no id at all is not a ticket", async () => {
    // Something came back, but nothing identifying it. Recording that would
    // put a blank ticket number on the row and close it.
    const found = await recoverTicket(async () => [{ status: "open" }], "s", {
        delays: [0],
        log: silent,
    });

    assert.equal(found, null);
});

test("an unrecognised lifecycle state still counts as filed", async () => {
    /*
     * "Success" MEANS FILED HERE, not approved.
     *
     * Meesho's lifecycle spellings vary by build, and `mapMeeshoStatus` answers
     * null for one it does not know. `claimStatusToCmsStatus` falls back to
     * "Success" — and in THIS context that is right rather than optimistic:
     * recoverTicket only runs when a ticket exists, so the claim did reach
     * Meesho whatever its state is called. Leaving it null would send the row
     * back to Failed to Proceed with a live ticket against it, which is the
     * failure this whole path exists to end.
     *
     * Meesho's own word is kept beside it, so a state nobody has mapped yet is
     * still visible rather than flattened away.
     */
    const found = await recoverTicket(async () => [ticket({ status: "some_new_state" })], "s", {
        delays: [0],
        log: silent,
    });

    assert.equal(found.meeshoStatus, "some_new_state");
    assert.equal(found.cmsStatus, "Success");
});

test("a state Meesho DOES name is mapped, not flattened to Success", async () => {
    // The fallback must not swallow the states that are known — a rejected
    // claim shown as Success is money nobody chases.
    const rejected = await recoverTicket(async () => [ticket({ status: "rejected" })], "s", {
        delays: [0],
        log: silent,
    });

    assert.equal(rejected.cmsStatus, "Rejected");
});

test("waits progressively, not in a tight loop", () => {
    // The delays are the contract: an index that needs a moment is the reason
    // this exists, and a burst of instant reads would miss it just as surely
    // as one read.
    assert.ok(VERIFY_DELAYS_MS.length >= 2, "a single window is not a poll");
    assert.ok(
        VERIFY_DELAYS_MS.some((delay) => delay > 0),
        "every window is instant — nothing is being waited for"
    );
});
