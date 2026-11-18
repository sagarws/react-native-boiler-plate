const assert = require("node:assert/strict");
const path = require("node:path");
const { test } = require("node:test");

const { meeshoId } = require(path.resolve(__dirname, "..", "platforms/meesho/common/identifiers.js"));

/**
 * One identifier, as Meesho should see it.
 *
 * Two rules, and each was arrived at by getting it wrong:
 *
 *   ALWAYS UPPER-CASE. Meesho's Returns search is a text match, so a lowercase
 *   AWB reads as "not on this account" against a return sitting right there,
 *   and a ticket filed with one carries an AWB that reads as a different
 *   shipment. The tempting optimisation — "only case it up if it has more
 *   letters than digits" — does nothing to precisely the values that need it,
 *   because a Meesho waybill is mostly digits with a short letter prefix.
 *
 *   COERCE A NUMBER, BUT NOT A BROKEN ONE. A row can hold an AWB as a number
 *   and refusing those filed claims with no AWB at all. But an eighteen-digit
 *   sub-order past MAX_SAFE_INTEGER has already lost digits by the time it
 *   arrives, and stringifying it would name a different order.
 */

test("upper-cases a waybill that is mostly digits", () => {
    // THE CASE A "more letters than digits" RULE SILENTLY SKIPS. Both of these
    // are real Meesho waybill shapes, and both would be left lowercase by it —
    // which is the exact failure this function exists to prevent.
    assert.equal(meeshoId("vlr082879603477"), "VLR082879603477");
    assert.equal(meeshoId("sf3919427089"), "SF3919427089");
    assert.equal(meeshoId("dlvpcp017051342"), "DLVPCP017051342");
});

test("upper-cases a value that is mostly letters too", () => {
    assert.equal(meeshoId("123sagar"), "123SAGAR");
    assert.equal(meeshoId("abc123_4"), "ABC123_4");
});

test("leaves a digits-only identifier exactly as it is", () => {
    // Upper-casing it is a no-op, which is the point: the rule needs no
    // exception, so there is no branch to get wrong.
    assert.equal(meeshoId("324853588461395712_1"), "324853588461395712_1");
    assert.equal(meeshoId("1490711725948834"), "1490711725948834");
});

test("adds nothing and removes nothing but surrounding space", () => {
    // No prefix, no suffix, no split-index padding. A real sub-order carries
    // its own `_<n>`; inventing one files against an order nobody named.
    assert.equal(meeshoId("  324853588461395712_1  "), "324853588461395712_1");
    assert.equal(meeshoId("324853588461395712"), "324853588461395712");
});

test("accepts a number that survived parsing intact", () => {
    // A row can store an AWB as a number. Refusing it filed a claim with no
    // AWB at all — worse than the value it was protecting against.
    assert.equal(meeshoId(1490711725948834), "1490711725948834");
    assert.equal(meeshoId(61008), "61008");
});

test("refuses a number that has already lost digits", () => {
    // 324853588461395712 parses to 324853588461395700 — twelve out, and a
    // VALID id belonging to a different order. Not a malformed value the
    // portal would bounce: a claim filed against somebody else. The damage is
    // done upstream at parse time; "" is the only honest answer left.
    const parsed = JSON.parse('{"s":324853588461395712}').s;

    assert.equal(parsed, 324853588461395700);
    assert.equal(Number.isSafeInteger(parsed), false);
    assert.equal(meeshoId(parsed), "");
});

test("refuses a number that is not a whole one", () => {
    // Nothing Meesho issues looks like this, and whatever it stringifies to is
    // not an identifier.
    assert.equal(meeshoId(1.5), "");
    assert.equal(meeshoId(Number.NaN), "");
    assert.equal(meeshoId(Number.POSITIVE_INFINITY), "");
});

test("anything that is not an identifier is empty, never its stringification", () => {
    /*
     * THE REGRESSION THIS PINS. Coercing with `String(value)` to let numbers
     * through also let objects through: `String({})` is "[object Object]" —
     * fifteen characters that pass every emptiness check the callers make,
     * then reach Meesho as a search term and go onto a ticket.
     *
     * Caught by Trackvid-CMS's own meeshoIdentifierCase test, which had
     * asserted `meeshoId({}) === ""` since before the coercion existed.
     */
    assert.equal(meeshoId({}), "");
    assert.equal(meeshoId([]), "");
    assert.equal(meeshoId({ toString: () => "VLR082879603477" }), "");
    assert.equal(meeshoId(true), "");
    assert.equal(meeshoId(() => "x"), "");
});

test("an absent value is empty, never the word for it", () => {
    // The callers all check for emptiness before searching. "UNDEFINED" would
    // sail past every one of those checks as a nine-character query.
    assert.equal(meeshoId(undefined), "");
    assert.equal(meeshoId(null), "");
    assert.equal(meeshoId(""), "");
    assert.equal(meeshoId("   "), "");
});
