// -----------------------------------------------------------------------------
// Meesho — the one spelling of an AWB or a sub-order number
// -----------------------------------------------------------------------------
// UPPERCASE, TRIMMED, EVERY TIME. Meesho's waybills are alphanumeric with a
// letter prefix — VLR082879603477, SF3919427089 — and the value reaching this
// process has been through hands and systems that do not agree on case: a
// barcode scanner, a spreadsheet, a typed correction, a feed. What comes back is
// "vlr082879603477" as often as not.
//
// That matters because the portal does not treat the two the same. The Returns
// search is a text match and the claim form is a stored value, so a lowercase
// AWB can search as "not found" against a return that is sitting right there,
// and can file a ticket whose AWB reads as a different shipment from the one the
// return is under. Both failures are silent and neither looks like a case
// problem — the first reads as "wrong awb number, not on this account", the
// second as a ticket a reviewer rejects days later.
//
// So normalisation happens at the EDGE, on the way out: every value this
// platform sends to Meesho — searched with, validated with, or written onto a
// ticket — goes through here first. Doing it at the edge rather than on arrival
// is deliberate; a claim row keeps whatever the operator typed, and only what
// Meesho sees is made consistent.
//
// Reading back is unaffected. Matching a response row against a query is
// case-insensitive already (see common/awbGlobleSearch.js), so a row Meesho
// spells differently still matches.
// -----------------------------------------------------------------------------

/**
 * One identifier, as Meesho should see it.
 *
 * COERCED, TRIMMED, UPPER-CASED. A number goes through — a row can hold an AWB
 * as `1490711725948834` rather than as text, and refusing those meant a claim
 * whose AWB was stored as a number filed with no AWB at all.
 *
 * NOTHING IS ADDED OR REMOVED. No prefix, no suffix, no split-index padding —
 * the value goes to Meesho exactly as the row holds it, cased up and with
 * surrounding whitespace dropped. A real sub-order carries its own `_<n>`
 * already (`324853588461395712_1`), and inventing one for a row that does not
 * have it would file against an order nobody named. The SEARCH tries the padded
 * form as a second guess, because guessing there costs a request and nothing
 * else; the submit does not guess, because there it costs a ticket.
 *
 * `null` and `undefined` become "" rather than "NULL" — the callers all check
 * for emptiness before searching, and `String(undefined)` would sail past every
 * one of those checks as a nine-character query.
 *
 * ---
 *
 * THE UPPERCASE IS UNCONDITIONAL, and that is a deliberate choice against the
 * obvious optimisation. A rule like "only case it up when it has more letters
 * than digits" looks harmless and quietly does nothing to exactly the values
 * this exists for — Meesho's waybills are mostly digits with a short letter
 * prefix:
 *
 *     vlr082879603477   12 digits, 3 letters  → left lowercase
 *     sf3919427089      10 digits, 2 letters  → left lowercase
 *
 * Those are the two spellings the portal's Returns search will not match, which
 * is the whole failure described at the top of this file. Upper-casing a value
 * with no letters in it costs nothing and is a no-op; skipping it costs a
 * claim. So it is always applied.
 *
 * ---
 *
 * A NUMBER THAT IS NOT A SAFE INTEGER IS REFUSED, because it is already wrong
 * before this function sees it. Meesho's sub-order numbers are eighteen digits
 * and that is past `Number.MAX_SAFE_INTEGER`:
 *
 *     JSON.parse('{"s":324853588461395712}').s   →  324853588461395700
 *
 * Twelve out, and not a malformed identifier the portal would bounce — a VALID
 * one belonging to a DIFFERENT ORDER. Stringifying it would file a claim
 * against that order. The damage happens upstream at parse time and there is
 * nothing left to recover here, so the honest answer is "no identifier", which
 * the caller's emptiness check reports as the missing value it effectively is.
 *
 * `Number.isSafeInteger` is what separates the two: an AWB like
 * `1490711725948834` and a supplier id like `61008` are exact and pass; only a
 * number that has demonstrably lost digits is turned away.
 *
 * @param {unknown} value
 * @returns {string}
 */
function meeshoId(value) {
    if (typeof value === "string") return value.trim().toUpperCase();

    /*
     * A NUMBER, BUT ONLY ONE THAT SURVIVED PARSING INTACT.
     *
     * A row can hold an AWB as `1490711725948834` rather than as text, and
     * refusing those filed claims with no AWB at all. But an eighteen-digit
     * sub-order is past MAX_SAFE_INTEGER and has already lost digits by the
     * time it arrives — `Number.isSafeInteger` is what separates the two.
     */
    if (typeof value === "number") {
        return Number.isSafeInteger(value) ? String(value).toUpperCase() : "";
    }

    /*
     * EVERYTHING ELSE IS NO IDENTIFIER, and stringifying it is worse than
     * saying so. `String({})` is "[object Object]" — fifteen characters that
     * pass every emptiness check the callers make, then reach Meesho as a
     * search term and a ticket field. An object arriving here means the caller
     * handed over the wrong thing, and "" is the answer that lets its own
     * emptiness check report that.
     */
    return "";
}

module.exports = { meeshoId };
