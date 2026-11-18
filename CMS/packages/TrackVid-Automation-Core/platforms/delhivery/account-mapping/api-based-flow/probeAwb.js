/**
 * Delhivery — does this client account hold this AWB?
 *
 * Reuses the claim flow's own shipment search, which is already the
 * authoritative "is this waybill on this client" question: `assertAwbExists`
 * throws AWB_NOT_FOUND on an empty result precisely so a claim is not filed
 * against a shipment the account cannot see.
 *
 * NO REVERSE PASS ANY MORE. This used to ask REVERSE first, because a claim is
 * about a return leg, and only then FORWARD. `forward_orders` has no reverse
 * leg to give: the gateway answers that query 400 INVALID_OR_MISSING_PARAMS,
 * so the first pass was never a search at all — and on the AWB that exposed it
 * the second pass was the only one that could have worked. An RTO is
 * `shipment_type: "FORWARD"` with status RETURNED_TO_ORIGIN.
 */

const {
    findOnCurrentClient,
    shippingModeOf,
} = require("../../../../platforms/delhivery/claim-management/api-based-flow/claimApiFlow");

/**
 * @param {object} ctx  a logged-in Delhivery API context (`loginDelhiveryApi`)
 * @param {string} awb
 * @returns {Promise<{found: boolean, details: object|null}>}
 */
async function probeDelhiveryAwb(ctx, awb) {
    const wanted = String(awb).trim();
    // The dashboard search first, the portal's own search box after it — a
    // waybill the filtered query cannot see is still this account's, and
    // answering "no" to it would leave a mappable claim unmapped.
    const hit = await findOnCurrentClient(ctx, wanted);

    if (!hit) return { found: false, details: null };

    return {
        found: true,
        details: {
            // What the shipment says it is, rather than what was asked for.
            shipmentType: hit.shipment_type || null,
            // EXPRESS / SURFACE — the same word the claim row calls `domestic`.
            shippingMode: shippingModeOf(hit),
            awbNumber: hit.awb_number || wanted,
            orderId: hit.order_number || hit.oid || hit.order_id || null,
            status: hit.shipment_status || hit.status || null,
        },
    };
}

module.exports = { probeDelhiveryAwb };
