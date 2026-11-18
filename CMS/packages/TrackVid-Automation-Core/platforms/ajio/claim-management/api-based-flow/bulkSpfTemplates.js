/**
 * Per-claim-type content for the bulk SPF claim — the AJIO issue sub-type, the
 * description that becomes the ticket body, and the proof image.
 *
 * Mirrors the mapping in TrackVid-BE
 * `src/utils/puppeteerForCms/triggerPuppeteerForMasterImport.ts`. Keep the two in
 * sync: if the BE templates or images change, change them here too. Kept as plain
 * constants so a runner is self-contained — no BE call to build a claim body.
 *
 * TWO WAYS IN, and they are not interchangeable:
 *
 *   contentForClaimType("NDR")            the operator picked it
 *   contentForOrderStatus("Marketplace…") the record's status implies it
 *
 * The desktop app takes the first: an operator uploads one file per claim type,
 * and the row a file lands in IS the choice. The automation server takes the
 * second, because a bulk upload there carries no such choice — it has only the
 * sheet and the database.
 *
 * The two can disagree. `mismatchedRows` below is what surfaces that rather than
 * letting it pass silently, because a claim filed under the wrong sub-type is
 * not correctable at AJIO — the ticket is raised, and raising the right one
 * afterwards means a duplicate.
 */

const ORDER_STATUS = {
    MARKETPLACE_DELIVERED: "Marketplace Delivered",
    RETURN_NOT_DELIVERED: "Return Not Delivered",
};

/**
 * DDR — Delivery Disputes Returns. AJIO says the return was delivered back to
 * the seller; the seller never received it. The ask is the POD.
 *
 * NDR — Not Delivered Returns. The return has been in transit far too long and
 * has not arrived at all. The ask is a status update, then an SPF payout if it
 * is confirmed lost.
 */
const CLAIM_TYPE = {
    NDR: "NDR",
    DDR: "DDR",
};

const DDR_BODY = `Dear Team,

The return shipment is showing as delivered in the system, but we have not yet received the parcel at our end. Kindly provide the POD (Proof of Delivery) for verification and assist us with a proper resolution. Also, please update us on the status of the ticket raised for this issue. Looking forward to your urgent support and resolution.`;

const NDR_BODY = `Dear Ajio Team,

This correspondence is an urgent follow-up regarding a return shipment that was created 60 days ago and has still not been successfully delivered.

Issue: The tracking information indicates that the return has been outstanding and undelivered for 60 days.
Requested Action: Immediate Status Update: Please investigate and provide the current, precise location and expected delivery timeline for this shipment.
SPF Claim: If the package is confirmed as lost, I request that you initiate an SPF (Seller Protection Fund) claim for this Order ID to process the full refund.

Please acknowledge receipt of this message and advise on the next steps you will take to resolve this issue promptly.

Thank you for your immediate attention.`;

const CLAIM_CONTENT = {
    [CLAIM_TYPE.DDR]: {
        claimType: CLAIM_TYPE.DDR,
        label: "Delivery Disputes Returns",
        subIssueType: "Delivery dispute Returns",
        // The exact option text of AJIO's "Issue Sub-Type" dropdown.
        typeOfClaim: "DELIVERY DISPUTE RETURNS",
        emailTemplate: { subject: "Delivery dispute Returns", body: DDR_BODY },
        imageUrl: "https://drive.google.com/file/d/1FKwhSaflmgvAeXXFHNqrkSWuAzYUniuF/view",
        // The order_status this type is normally raised against, used only to
        // flag a disagreement — never to override the operator's choice.
        expectedOrderStatus: ORDER_STATUS.MARKETPLACE_DELIVERED,
    },
    [CLAIM_TYPE.NDR]: {
        claimType: CLAIM_TYPE.NDR,
        label: "Not Delivered Returns",
        subIssueType: "Not Delivered Returns",
        typeOfClaim: "NOT DELIVERED RETURNS",
        emailTemplate: { subject: "Not Delivered Returns", body: NDR_BODY },
        imageUrl: "https://drive.google.com/file/d/1eIZs_iNWsVMe4-8YaiBXRRij4nWb2nqW/view",
        expectedOrderStatus: ORDER_STATUS.RETURN_NOT_DELIVERED,
    },
};

/** order_status -> claim type. The server path's only way of choosing. */
const TYPE_BY_ORDER_STATUS = {
    [ORDER_STATUS.MARKETPLACE_DELIVERED]: CLAIM_TYPE.DDR,
    [ORDER_STATUS.RETURN_NOT_DELIVERED]: CLAIM_TYPE.NDR,
};

/** The only statuses the order-status path will claim. */
const CLAIMABLE_STATUSES = [ORDER_STATUS.MARKETPLACE_DELIVERED, ORDER_STATUS.RETURN_NOT_DELIVERED];

const normaliseType = (claimType) => String(claimType || "").trim().toUpperCase();

/** @returns {object|null} the content for a claim type, or null if unknown. */
function contentForClaimType(claimType) {
    return CLAIM_CONTENT[normaliseType(claimType)] || null;
}

/** @returns {string|null} the claim type a record's status implies. */
function claimTypeForOrderStatus(orderStatus) {
    return TYPE_BY_ORDER_STATUS[String(orderStatus || "").trim()] || null;
}

/** @returns {object|null} the content a record's status implies. */
function contentForOrderStatus(orderStatus) {
    return contentForClaimType(claimTypeForOrderStatus(orderStatus));
}

/**
 * True when the operator's choice contradicts what the record's status implies.
 *
 * Only meaningful for a status this tool recognises: a record sitting at some
 * third status implies nothing, so there is nothing to disagree with.
 */
function isTypeMismatch(claimType, orderStatus) {
    const implied = claimTypeForOrderStatus(orderStatus);

    if (!implied) return false;

    return implied !== normaliseType(claimType);
}

module.exports = {
    ORDER_STATUS,
    CLAIM_TYPE,
    CLAIM_CONTENT,
    CLAIMABLE_STATUSES,
    contentForClaimType,
    contentForOrderStatus,
    claimTypeForOrderStatus,
    isTypeMismatch,
};
