/**
 * What every call in claimApiFlow.js takes. Built by loginFlipkartApi or
 * restored from the session store.
 */
export type FlipkartApiContext = {
    /**
     * cookie name → value
     */
    jar: Record<string, string>;
    /**
     * fk-csrf-token; also the value of cookie XyZ7pQ9rS2T1uV8wA3bC6dE4fG0h
     */
    csrfToken: string;
    /**
     * x-seller-id / x-user-id on orchestrator calls; filled by getOrderSearch
     */
    sellerId: string | null;
    /**
     * x-location-id; empty when unknown
     */
    locationId?: string;
    logger?: {
        log: Function;
        warn?: Function;
    };
};
/**
 * POST /verifyOtp → data. Selenium makes this call; listed for reference.
 */
export type VerifyOtpData = {
    sellerId: string;
    name: string;
    displayName: string;
    businessName: string;
    /**
     * "ACC…" — NOT what x-user-id carries
     */
    userId: string;
    /**
     * "ACTIVE"
     */
    state: string;
    isOnBehalf: boolean;
    onBehalfEmail: string;
    onBehalfRole: string;
};
export type ClaimDetails = {
    /**
     * e.g. "20260915105626116295461" — the CMS ticket number
     */
    claim_id: string | null;
    /**
     * e.g. "IN26091510562667804534"
     */
    incident_id: string | null;
    /**
     * "OPEN" right after filing
     */
    claim_status: string | null;
    /**
     * null while open
     */
    claim_amount: number | null;
    claim_status_reason: string | null;
};
/**
 * getOrderSearch.return_item_list[]
 */
export type ReturnItem = {
    sku: string;
    title: string;
    order_item_id: string;
    /**
     * "OD…"
     */
    order_id: string;
    return_id: string;
    claim_type: string | null;
    /**
     * "completed"
     */
    status: string;
    /**
     * false once a claim exists
     */
    claim_eligible: boolean;
    /**
     * null until a claim is filed
     */
    claim_details: ClaimDetails | null;
    /**
     * the CMS AWB number
     */
    tracking_id: string;
    /**
     * "NON_FBF"
     */
    service_profile: string;
    /**
     * "NORMAL"
     */
    shipment_type: string;
    /**
     * "delivered"
     */
    shipment_status: string;
    auto_claim_type: string | null;
    sub_reason: string;
    /**
     * 0 once a claim exists
     */
    eligible_quantity: number;
    total_quantity: number;
    quantity: number;
    auto_payout: boolean;
    /**
     * ISO with offset
     */
    completed_date: string;
    seller_id: string;
    /**
     * "customer_return" | "courier_return"
     */
    type: string;
    reason: string;
    old_claim: boolean;
    total_price: number;
    product_image: string;
    /**
     * why claim_eligible is false
     */
    claim_eligible_reason: string | null;
    /**
     * "expect"
     */
    shipment_expectation: string;
};
/**
 * What getOrderSearch() returns.
 */
export type OrderSearchResult = {
    found: boolean;
    item: ReturnItem | null;
    claimId: string | null;
};
/**
 * getIssueTypes — one list per product type, keyed with spaces as underscores.
 * Only the requested product type's list is populated; the rest are null.
 */
export type IssueTypes = {
    Main_Product: string[] | null;
    Combo_product: string[] | null;
    Packaging: string[] | null;
    Accessory: string[] | null;
    Freebie: string[] | null;
};
/**
 * POST /napi/payments-rest/uploadSpfClaimFile → { url }. The url is the
 * attachment `path` below.
 */
export type UploadResponse = {
    /**
     * "/attachments/BN:…:<uuid>"
     */
    url: string;
};
export type ClaimAttachment = {
    /**
     * "shipping-label" for the label, the file name for evidence
     */
    name: string;
    /**
     * UploadResponse.url
     */
    path: string;
};
/**
 * Variables of Payments_SPF_WEB_createclaimV2.
 */
export type CreateClaimVariables = {
    order_id: string;
    order_item_id: string;
    return_id: string;
    /**
     * "expect"
     */
    shipment_expectation: string;
    quantity_affected: number;
    /**
     * from getProductTypes
     */
    product_type: string;
    /**
     * from getIssueTypes(product_type)
     */
    issue_type: string;
    description: string;
    attachments: ClaimAttachment[];
};
/**
 * createClaimV2 → all three null even when the claim WAS filed. Read the id
 * back with findClaim.
 */
export type CreateClaimResponse = {
    claim_id: string | null;
    incident_id: string | null;
    state: string | null;
};
/**
 * Tab state names. Seen: SELLER_PENDING, PROCESSING, APPROVED, AUTO_CLOSE,
 * REJECTED.
 */
export type SpfClaimState = "SELLER_PENDING" | "PROCESSING" | "APPROVED" | "AUTO_CLOSE" | "REJECTED" | string;
/**
 * What getClaimStateCounts() returns (claim.sellerClaims flattened).
 */
export type ClaimStateCounts = {
    total: number;
    /**
     * only states with claims
     */
    stateCounts: {
        state: SpfClaimState;
        count: number;
    }[];
    /**
     * e.g. SHIPMENT_LOST_CLAIMS
     */
    autoProcessedClaims: {
        source: string;
        count: number;
    }[];
};
/**
 * claims.claims[] — one row of the SPF Claims tab.
 */
export type SpfClaim = {
    claimId: string;
    incidentId: string;
    status: SpfClaimState;
    /**
     * the approved payout when APPROVED (e.g. 622.68); 0 otherwise
     */
    approvedAmount: number;
    settlementAmount: number;
    productPrice: number;
    totalPrice: number;
    /**
     * "courier_return" | "customer_return"
     */
    returnType: string;
    returnId: string;
    claimType: string | null;
    warehouseCode: string | null;
    reasonCodeDisplay: string | null;
    sku: string;
    /**
     * product title
     */
    productDetails: string;
    productImage: string;
    orderItemId: string;
    orderId: string;
    /**
     * "2025-06-20 17:27:02.0"
     */
    createdAt: string;
    updatedAt: string;
    /**
     * null on older claims
     */
    trackingId: string | null;
    quantityApproved: number | null;
    quantityClaimed: number | null;
    sellerRequestedQuantity: number;
};
/**
 * What findClaim() returns: an SpfClaim, normalised.
 */
export type FoundClaim = {
    claimId: string | null;
    incidentId: string | null;
    /**
     * upper-cased SpfClaimState
     */
    status: string | null;
    approvedAmount: number | null;
    settlementAmount: number | null;
    quantityApproved: number | null;
    orderId: string | null;
    orderItemId: string | null;
    returnId: string | null;
    trackingId: string | null;
    createdAt: string | null;
    updatedAt: string | null;
    raw: SpfClaim;
};
/**
 * What searchReturnItem() returns per matching return.
 */
export type AccountReturn = {
    trackingId: string | null;
    orderId: string | null;
    orderItemIds: string[];
    returnId: string | null;
    /**
     * "customer_return"
     */
    returnType: string | null;
    /**
     * "completed"
     */
    status: string | null;
    /**
     * "delivered"
     */
    shipmentStatus: string | null;
    /**
     * "Return Delivered"
     */
    statusText: string | null;
    completedDate: string | null;
    /**
     * order_item_id, title, sku, quantity, selling_price
     */
    products: object[];
};
/**
 * What fileFlipkartClaim() resolves with.
 */
export type FiledFlipkartClaim = {
    claimId: string;
    incidentId: string | null;
    alreadyExisted: boolean;
    /**
     * "Success" | "Approved" | "Rejected"; null for a fresh claim
     */
    cmsStatus: string | null;
    flipkartStatus: string | null;
    /**
     * set only when Flipkart APPROVED the claim
     */
    approvedAmount: number | null;
};
