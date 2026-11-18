/**
 * Xbees — does this client account hold this AWB?
 *
 * `POST {CLIENT_SHIP_HOST}/disputeDashboardCount` with `{ awbNo: [awb] }`.
 * Verified response:
 *
 *   { "ReturnCode": 100, "ReturnMessage": "Success",
 *     "ReturnCount": { "Total": 1, "Open": 1, "Closed": 0,
 *                      "Draft": 0, "Accepted": 0, "Rejected": 0 } }
 *
 * The counts are scoped to the account the bearer token belongs to, so a
 * `Total` above zero IS the answer: this client's portal knows the shipment.
 * A different account answers `Total: 0` for the same AWB.
 *
 * Chosen over `/disputeSummary` (which the claim flow already uses to find an
 * existing dispute) for one reason: disputeSummary lists DISPUTES, so an AWB
 * that belongs to the account but has never been disputed comes back empty and
 * reads as "not this account". That is the exact case account mapping exists
 * for — an unclaimed row — so the wrong endpoint would answer no to every row
 * worth mapping.
 */

const { xbeesPost } = require("../../../../platforms/xbees/claim-management/api-based-flow/claimApiFlow");

/**
 * @param {object} ctx  a logged-in Xbees API context (`loginXbeesApi`)
 * @param {string} awb
 * @returns {Promise<{found: boolean, details: object|null}>}
 */
async function probeXbeesAwb(ctx, awb) {
    const body = await xbeesPost(
        ctx,
        "/disputeDashboardCount",
        { awbNo: [String(awb).trim()] },
        "Dispute dashboard count"
    );

    // xbeesPost unwraps `ReturnResult` when there is one; this endpoint carries
    // its payload as `ReturnCount` at the top level, so the envelope comes back
    // whole. Read both shapes rather than depending on which one it took.
    const counts = body?.ReturnCount || body?.returnCount || null;
    const total = Number(counts?.Total ?? counts?.total ?? 0);

    return {
        found: Number.isFinite(total) && total > 0,
        // Kept for the row: the open/closed split says whether a dispute is
        // already in flight, which the claim runner would otherwise rediscover.
        details: counts ? { counts } : null,
    };
}

module.exports = { probeXbeesAwb };
