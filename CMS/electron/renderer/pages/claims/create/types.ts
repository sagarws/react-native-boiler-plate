/**
 * Where the AJIO Return Order Number lookup reads from — see
 * platforms/ajio/ReturnLookupSource.
 */
export type ReturnLookupSourceValue = "api" | "report"

/**
 * The backend shapes Create Claim reads, as TrackVid-FE names them.
 *
 * PORTED from the web app's `api/cms-autofetch-service.ts`. These are response
 * types, not stored types — what a lookup answers, not what a claim is — so
 * they stay beside the form rather than in `shared/`, which holds what crosses
 * the process boundary. `ICms`, which does, lives in `@shared/types/cmsCreate`.
 */

export type OrderType = 'Return' | 'Forward'

export interface OrderLookupItem {
  return_video_link?: string
  forward_video_link?: string
  return_awb?: string
  forward_awb?: string
  customerOrderNumber?: string
}

export interface OrderLookupRecord {
  /** The source masterImport row. */
  _id: string
  /** `order_seller_SKU` from that row; empty string when blank. */
  sku: string
  /**
   * The row's own AWB pair and order number, so the caller can tell WHICH line
   * of a multi-line order this is. A Forward lookup matches `order_FWD_AWB_no`
   * OR `order_no` and so returns every line of the order — `returnAwb` is what
   * identifies the one line the claim is actually about.
   */
  returnAwb?: string
  forwardAwb?: string
  orderNo?: string
  /**
   * `POB_ID` from the row, already normalised by the backend (the placeholders
   * the importer writes — "undefined", "-", "n/a" — arrive as ""). Auto-filled
   * when the scoped record set yields one POB, a dropdown when it yields
   * several.
   */
  pobId?: string
}

export interface OrderLookupResponse {
  data: OrderLookupItem[]
  skus?: string[]
  /** One entry per matched row, positional, empty SKUs preserved. */
  records?: OrderLookupRecord[]
}

/** One stored image, as the backend returns it. */
export interface StoredImage {
  fileKey?: string
  url?: string
}

/** A claim that already exists, as `/cms/find-by-awb` returns it. */
export interface ExistingCmsPreview {
  _id: string
  eCommercePlatform: string
  AWBNumber: string
  typeOfClaim: string
  forwardAWB: string
  customerOrderNumber: string
  remark: string
  status: string
  ticketNumber: string
  returnVideoLink: string
  forwardVideoLink: string
  returnProductImage: string
  forwardSentProductImage: string
  sixSideImages: string
  podProof: string
  myntraClaimDetails: Record<string, any> | null
  nykaaClaimDetails: Record<string, any> | null
  otherClaimDetails: Record<string, any> | null
  // Meesho top-level slots.
  barcodeImage?: StoredImage | null
  receivedProductImage_1?: StoredImage | null
  reverseWayBillImage?: StoredImage | null
  // Snapdeal top-level slots.
  outerPackageImage_1?: StoredImage | null
  outerPackageImage_2?: StoredImage | null
  innerPackageImage_1?: StoredImage | null
  innerPackageImage_2?: StoredImage | null
  productImage_1?: StoredImage | null
  productImage_2?: StoredImage | null
  podImage_1?: StoredImage | null
  podImage_2?: StoredImage | null
  subOrderNumber: string
  packetId: string
  logisticsPartnerName: string
  /** "" (unset) | "1" | "2". */
  stateOfThePacket?: string
  costOfMissingArticle?: number | string
  createdAt: string | null
  updatedAt: string | null
  ajio_account_email?: string
  meesho_account_email?: string
  snapdeal_account_username?: string
  /** Stored AJIO POB ID (`cms.pobid`). */
  pobid?: string
  /** AJIO return order number ("RT…"), when one was entered. */
  returnOrderId?: string
  /** Stored AJIO seller SKU (`cms.seller_sku`). */
  skuName?: string
}
