/**
 * Meesho — does this supplier account hold this AWB? Asked over HTTP.
 *
 * `POST /api/fulfillment/returnRto/fetchReturnClaims` is what the supplier
 * portal's own Returns screen calls, and it is the one Meesho endpoint that
 * takes a free-text query rather than a sub-order number. That distinction is
 * the whole reason this exists: every other supplier API is keyed on the
 * sub-order number, and an unmapped claim has no sub-order number either —
 * which is exactly the blank the mapping run is trying to fill.
 *
 * Verified request/response (2026-09-10). The answer is scoped to the supplier
 * the session belongs to, so a non-empty `data` IS the answer: another
 * account's session returns `data: []` for the same AWB.
 *
 * The row carries the SUB-ORDER NUMBER, which is written to the claim alongside
 * the account — the same thing the browser path reads off the screen, so
 * switching between them changes the speed and nothing else.
 *
 * THE CALL ITSELF lives in platforms/meesho/common/returnsSearch.js, shared with
 * the claim flow. It used to be duplicated here, and the copies drifted: the
 * claim flow learned to repair a session missing its supplier ids and this one
 * did not, so a mapping run reported "1 account could not be reached" for AWBs
 * the portal finds instantly. One endpoint, one implementation.
 */

const { findReturn, ORIGIN, PATH } = require("../../common/returnsSearch.js");

/**
 * @param {object} ctx  a Meesho API context — `{ jar, supplierId, supplierIdentifier }`
 * @param {string} awb
 * @param {string[]} [alternates]  other identifiers for the SAME return — a
 *   sub-order number, an order number — tried only when the AWB finds nothing.
 *
 *   Worth trying because a miss here is not only "not this account": a row whose
 *   AWB has gone stale misses on EVERY account, and the sweep then reports it as
 *   belonging to nobody. That reads as a data problem with the accounts when it
 *   is a data problem with the one number being asked about — and the sub-order
 *   number, which Meesho keys on and never changes, answers it.
 *
 * @returns {Promise<{found: boolean, details: object|null}>}
 */
async function probeMeeshoApiAwb(ctx, awb, alternates = []) {
    const others = (Array.isArray(alternates) ? alternates : [alternates])
        .map((value) => (typeof value === "string" ? value.trim() : ""))
        .filter(Boolean);

    const { found, row } = await findReturn(
        ctx,
        {
            awb,
            // Meesho's search is free text and matches either, so the shared
            // reader sorts out which field actually answered.
            subOrderNumber: others[0] || null,
            orderNumber: others[1] || null,
        },
        { step: "Search returns", logger: ctx && ctx.logger }
    );

    if (!found) return { found: false, details: null };

    // `raw` is the untouched Meesho row; the caller wants the normalised fields.
    const { raw, ...details } = row;

    return { found: true, details };
}

module.exports = { probeMeeshoApiAwb, ORIGIN, PATH };
