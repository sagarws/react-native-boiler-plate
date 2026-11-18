// -----------------------------------------------------------------------------
// Flipkart Seller Hub — request and response shapes of the SPF claim APIs
// -----------------------------------------------------------------------------
// JSDoc only; nothing here runs. `npm run build` turns these into
// types/…/flipkartApiTypes.d.ts, so a TypeScript consumer (Trackvid-CMS) and an
// editor reading claimApiFlow.js see the same shapes.
//
// Every shape is copied from a real capture of the portal (Chrome 152,
// 2026-09-15): the fields listed are the ones Flipkart returned, with the
// values' observed types. How and when each call is made is in FLIPKART_API.md.
//
// When Flipkart changes a response, change the shape here AND the query string
// in claimApiFlow.js — the query decides which fields come back at all.
// -----------------------------------------------------------------------------

// ── Session ──────────────────────────────────────────────────────────────────

/**
 * What every call in claimApiFlow.js takes. Built by loginFlipkartApi or
 * restored from the session store.
 * @typedef {object} FlipkartApiContext
 * @property {Record<string, string>} jar  cookie name → value
 * @property {string} csrfToken  fk-csrf-token; also the value of cookie XyZ7pQ9rS2T1uV8wA3bC6dE4fG0h
 * @property {string|null} sellerId  x-seller-id / x-user-id on orchestrator calls; filled by getOrderSearch
 * @property {string} [locationId]  x-location-id; empty when unknown
 * @property {{ log: Function, warn?: Function }} [logger]
 */

/**
 * POST /verifyOtp → data. Selenium makes this call; listed for reference.
 * @typedef {object} VerifyOtpData
 * @property {string} sellerId
 * @property {string} name
 * @property {string} displayName
 * @property {string} businessName
 * @property {string} userId  "ACC…" — NOT what x-user-id carries
 * @property {string} state  "ACTIVE"
 * @property {boolean} isOnBehalf
 * @property {string} onBehalfEmail
 * @property {string} onBehalfRole
 */

// ── Payments_SPF_WEB_getOrderSearch ──────────────────────────────────────────

/**
 * @typedef {object} ClaimDetails
 * @property {string|null} claim_id  e.g. "20260915105626116295461" — the CMS ticket number
 * @property {string|null} incident_id  e.g. "IN26091510562667804534"
 * @property {string|null} claim_status  "OPEN" right after filing
 * @property {number|null} claim_amount  null while open
 * @property {string|null} claim_status_reason
 */

/**
 * getOrderSearch.return_item_list[]
 * @typedef {object} ReturnItem
 * @property {string} sku
 * @property {string} title
 * @property {string} order_item_id
 * @property {string} order_id  "OD…"
 * @property {string} return_id
 * @property {string|null} claim_type
 * @property {string} status  "completed"
 * @property {boolean} claim_eligible  false once a claim exists
 * @property {ClaimDetails|null} claim_details  null until a claim is filed
 * @property {string} tracking_id  the CMS AWB number
 * @property {string} service_profile  "NON_FBF"
 * @property {string} shipment_type  "NORMAL"
 * @property {string} shipment_status  "delivered"
 * @property {string|null} auto_claim_type
 * @property {string} sub_reason
 * @property {number} eligible_quantity  0 once a claim exists
 * @property {number} total_quantity
 * @property {number} quantity
 * @property {boolean} auto_payout
 * @property {string} completed_date  ISO with offset
 * @property {string} seller_id
 * @property {string} type  "customer_return" | "courier_return"
 * @property {string} reason
 * @property {boolean} old_claim
 * @property {number} total_price
 * @property {string} product_image
 * @property {string|null} claim_eligible_reason  why claim_eligible is false
 * @property {string} shipment_expectation  "expect"
 */

/**
 * What getOrderSearch() returns.
 * @typedef {object} OrderSearchResult
 * @property {boolean} found
 * @property {ReturnItem|null} item
 * @property {string|null} claimId
 */

// ── Vocabularies ─────────────────────────────────────────────────────────────

/**
 * getIssueTypes — one list per product type, keyed with spaces as underscores.
 * Only the requested product type's list is populated; the rest are null.
 * @typedef {object} IssueTypes
 * @property {string[]|null} Main_Product
 * @property {string[]|null} Combo_product
 * @property {string[]|null} Packaging
 * @property {string[]|null} Accessory
 * @property {string[]|null} Freebie
 */

// ── Upload + createClaimV2 ───────────────────────────────────────────────────

/**
 * POST /napi/payments-rest/uploadSpfClaimFile → { url }. The url is the
 * attachment `path` below.
 * @typedef {object} UploadResponse
 * @property {string} url  "/attachments/BN:…:<uuid>"
 */

/**
 * @typedef {object} ClaimAttachment
 * @property {string} name  "shipping-label" for the label, the file name for evidence
 * @property {string} path  UploadResponse.url
 */

/**
 * Variables of Payments_SPF_WEB_createclaimV2.
 * @typedef {object} CreateClaimVariables
 * @property {string} order_id
 * @property {string} order_item_id
 * @property {string} return_id
 * @property {string} shipment_expectation  "expect"
 * @property {number} quantity_affected
 * @property {string} product_type  from getProductTypes
 * @property {string} issue_type  from getIssueTypes(product_type)
 * @property {string} description
 * @property {ClaimAttachment[]} attachments
 */

/**
 * createClaimV2 → all three null even when the claim WAS filed. Read the id
 * back with findClaim.
 * @typedef {object} CreateClaimResponse
 * @property {string|null} claim_id
 * @property {string|null} incident_id
 * @property {string|null} state
 */

// ── GetSpfClaimCountsOrchestrator ────────────────────────────────────────────

/**
 * Tab state names. Seen: SELLER_PENDING, PROCESSING, APPROVED, AUTO_CLOSE,
 * REJECTED.
 * @typedef {"SELLER_PENDING"|"PROCESSING"|"APPROVED"|"AUTO_CLOSE"|"REJECTED"|string} SpfClaimState
 */

/**
 * What getClaimStateCounts() returns (claim.sellerClaims flattened).
 * @typedef {object} ClaimStateCounts
 * @property {number} total
 * @property {{ state: SpfClaimState, count: number }[]} stateCounts  only states with claims
 * @property {{ source: string, count: number }[]} autoProcessedClaims  e.g. SHIPMENT_LOST_CLAIMS
 */

// ── GetSpfClaimsOrchestrator ─────────────────────────────────────────────────

/**
 * claims.claims[] — one row of the SPF Claims tab.
 * @typedef {object} SpfClaim
 * @property {string} claimId
 * @property {string} incidentId
 * @property {SpfClaimState} status
 * @property {number} approvedAmount  the approved payout when APPROVED (e.g. 622.68); 0 otherwise
 * @property {number} settlementAmount
 * @property {number} productPrice
 * @property {number} totalPrice
 * @property {string} returnType  "courier_return" | "customer_return"
 * @property {string} returnId
 * @property {string|null} claimType
 * @property {string|null} warehouseCode
 * @property {string|null} reasonCodeDisplay
 * @property {string} sku
 * @property {string} productDetails  product title
 * @property {string} productImage
 * @property {string} orderItemId
 * @property {string} orderId
 * @property {string} createdAt  "2025-06-20 17:27:02.0"
 * @property {string} updatedAt
 * @property {string|null} trackingId  null on older claims
 * @property {number|null} quantityApproved
 * @property {number|null} quantityClaimed
 * @property {number} sellerRequestedQuantity
 */

/**
 * What findClaim() returns: an SpfClaim, normalised.
 * @typedef {object} FoundClaim
 * @property {string|null} claimId
 * @property {string|null} incidentId
 * @property {string|null} status  upper-cased SpfClaimState
 * @property {number|null} approvedAmount
 * @property {number|null} settlementAmount
 * @property {number|null} quantityApproved
 * @property {string|null} orderId
 * @property {string|null} orderItemId
 * @property {string|null} returnId
 * @property {string|null} trackingId
 * @property {string|null} createdAt
 * @property {string|null} updatedAt
 * @property {SpfClaim} raw
 */

// ── returns_searchReturnItem (global AWB search) ─────────────────────────────

/**
 * What searchReturnItem() returns per matching return.
 * @typedef {object} AccountReturn
 * @property {string|null} trackingId
 * @property {string|null} orderId
 * @property {string[]} orderItemIds
 * @property {string|null} returnId
 * @property {string|null} returnType  "customer_return"
 * @property {string|null} status  "completed"
 * @property {string|null} shipmentStatus  "delivered"
 * @property {string|null} statusText  "Return Delivered"
 * @property {string|null} completedDate
 * @property {object[]} products  order_item_id, title, sku, quantity, selling_price
 */

// ── fileFlipkartClaim ────────────────────────────────────────────────────────

/**
 * What fileFlipkartClaim() resolves with.
 * @typedef {object} FiledFlipkartClaim
 * @property {string} claimId
 * @property {string|null} incidentId
 * @property {boolean} alreadyExisted
 * @property {string|null} cmsStatus  "Success" | "Approved" | "Rejected"; null for a fresh claim
 * @property {string|null} flipkartStatus
 * @property {number|null} approvedAmount  set only when Flipkart APPROVED the claim
 */

module.exports = {};
