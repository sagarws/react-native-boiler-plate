/**
 * Snapdeal — does this seller account hold this AWB?
 *
 * `globalSearch?searchType=AWBNUMBER` is scoped to the signed-in seller, so a
 * matching return row IS the answer. The claim flow already treats an empty
 * result as "Wrong awb number, Not exist in account"; this asks the same
 * question for a different reason.
 *
 * The response shape — rows two levels down under `returnsList`, the sub-order
 * on `subOrderId` — lives in `common/awbGlobleSearch`, beside Meesho's, so the
 * two searches that answer the same question are described in one place.
 */

const {
    globalSearchAwb,
} = require("../../../../platforms/snapdeal/claim-management/api-based-flow/claimApiFlow");
const { readSearchRow } = require("../../../../common/awbGlobleSearch");

/**
 * @param {object} ctx  a logged-in Snapdeal API context (`loginSnapdealApi`)
 * @param {string} awb
 * @returns {Promise<{found: boolean, details: object|null}>}
 */
async function probeSnapdealAwb(ctx, awb) {
    const { found, item, alreadyDisputed, disputeId } = await globalSearchAwb(ctx, awb);

    if (!found) return { found: false, details: null };

    const row = readSearchRow("snapdeal", item) || {};

    return {
        found: true,
        details: {
            ...row,
            // A dispute already exists — carried out because the claim runner
            // would otherwise find this out again a minute later.
            alreadyDisputed: alreadyDisputed === true,
            disputeId: disputeId || row.disputeId || null,
        },
    };
}

module.exports = { probeSnapdealAwb };
