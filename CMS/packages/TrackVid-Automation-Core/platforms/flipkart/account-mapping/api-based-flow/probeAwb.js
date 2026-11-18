/**
 * Flipkart — does this seller account hold this AWB?
 *
 * `getOrderSearch` is the same GraphQL query the claim flow opens with, and it
 * runs against the signed-in seller's own return items — an AWB on another
 * seller's account comes back with an empty `return_item_list`.
 *
 * Free information on a hit: `claim_eligible` and, when a claim already exists,
 * `claim_details.claim_id`. Both are carried out so the mapping run can record
 * what it saw rather than making the claim runner ask again.
 */

const {
    getOrderSearch,
} = require("../../../../platforms/flipkart/claim-management/api-based-flow/claimApiFlow");

/**
 * @param {object} ctx  a logged-in Flipkart API context (`loginFlipkartApi`)
 * @param {string} awb  the tracking id on the CMS row
 * @returns {Promise<{found: boolean, details: object|null}>}
 */
async function probeFlipkartAwb(ctx, awb) {
    const { found, item, claimId } = await getOrderSearch(ctx, awb);

    if (!found) return { found: false, details: null };

    return {
        found: true,
        details: {
            sellerId: item?.seller_id ? String(item.seller_id) : null,
            claimEligible: item?.claim_eligible === true,
            existingClaimId: claimId || null,
            claimStatus: item?.claim_details?.claim_status || null,
        },
    };
}

module.exports = { probeFlipkartAwb };
