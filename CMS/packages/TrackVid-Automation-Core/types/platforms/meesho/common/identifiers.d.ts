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
export function meeshoId(value: unknown): string;
