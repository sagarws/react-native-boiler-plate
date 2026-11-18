/**
 * Myntra — does this partner account hold this AWB?
 *
 * `fetchNewClaim` answers for the signed-in partner only, and it is the same
 * call the claim flow opens with. It does NOT return a "not found" — it throws
 * NO_VALID_CLAIM, because for a claim that is a dead end. For mapping it is an
 * ordinary "no", so it is caught here and nowhere else.
 *
 * Every other error is rethrown. A dead session and "this AWB is not yours"
 * both leave the row unmapped, but only one of them is fixed by re-capturing
 * the session — collapsing them into `found: false` would hide that.
 */

const {
    fetchNewClaim,
} = require("../../../../platforms/myntra/claim-management/api-based-flow/claimApiFlow");

/** The codes Myntra's own flow raises for "this AWB is not claimable here". */
const NOT_MINE = new Set(["NO_VALID_CLAIM", "AWB_NOT_FOUND"]);

/**
 * @param {object} ctx  a Myntra API context — `{ jar }` from `loginMyntraApi`
 * @param {string} awb
 * @returns {Promise<{found: boolean, details: object|null}>}
 */
async function probeMyntraAwb(ctx, awb) {
    const jar = ctx?.jar || ctx;

    try {
        const lookup = await fetchNewClaim(jar, String(awb).trim());
        const row = Array.isArray(lookup?.data) ? lookup.data[0] : lookup?.data || lookup;

        // A 200 with nothing in it is the same answer as the throw below —
        // Myntra returns both shapes for the same AWB minutes apart.
        if (!row) return { found: false, details: null };

        return {
            found: true,
            details: {
                orderId: row.orderId || row.order_id || null,
                styleId: row.styleId || null,
                sellerSku: row.sellerSku || row.sku || null,
            },
        };
    } catch (error) {
        if (NOT_MINE.has(error?.code)) return { found: false, details: null };

        throw error;
    }
}

module.exports = { probeMyntraAwb };
