/**
 * The Create / Update Claim form, as the backend wants it.
 *
 * PORTED FROM TrackVid-FE (`src/helper/types/cms-create.types.ts`), field for
 * field and name for name. The desktop app posts to the SAME endpoints the web
 * CMS posts to — `/cms/createCMS`, `/cms/updateCMS` — so a field renamed here
 * is a claim the server silently drops. When the two disagree, the FE wins:
 * it is the surface operators already file claims from.
 *
 * Lives in `shared/` because both sides need it — the renderer to render the
 * form, the main process to build the multipart body.
 */

export interface ICms {
  eCommercePlatform: string
  AWBNumber: string
  typeOfClaim: string
  costOfMissingArticle?: string
  customerOrderNumber?: string
  returnOrderId?: string
  forwardAWB?: string
  remark?: string
  skuName?: string
  /**
   * AJIO POB ID, read off the `/order/{awb}` master-data records and rendered
   * next to the SKU field. Optional at create time — a claim can be saved
   * without one. Sent only on AJIO.
   */
  pobId?: string
  returnVideo?: string
  returnVideoLink?: string
  forwardVideo?: string
  forwardVideoLink?: string
  returnProductImage: string
  forwardSentProductImage?: string
  sideImages?: string
  podProof?: string
  /** Not a field — the anchor the "video or link" rule reports against. */
  eitherVideoOrLink?: string
  additionalFieldTitle: string
  additionalFieldValue: string
  myntraClaimDetails?: IMyntraClaimDetails
  nykaaClaimDetails?: INykaaClaimDetails
  /**
   * Unified bundle shared by Flipkart, Tata CliQ, Delhivery, Amazon and Xbees —
   * every cascade-driven platform lands its parentSelection plus its own
   * image/field slots here, so the backend tracks a single envelope.
   */
  otherClaimDetails?: IOtherClaimDetails

  // Meesho-only (optional here; enforced by the Meesho validator when active)
  subOrderNumber?: string
  packetId?: string
  stateOfThePacket?: string
  barcodeImage?: string
  receivedProductImage_1?: string
  reverseWayBillImage?: string
  logisticsPartnerName?: string
  typeOfClaimName?: string

  /**
   * Per-platform account identifiers, set by the Account Username dropdown.
   * The backend prefers these over its master-data auto-lookup, so an operator
   * can override a stale master row from the form.
   */
  ajio_account_email?: string
  meesho_account_email?: string
  snapdeal_account_username?: string

  // Snapdeal-only
  outerPackageImage_1?: string
  outerPackageImage_2?: string
  innerPackageImage_1?: string
  innerPackageImage_2?: string
  productImage_1?: string
  productImage_2?: string
  podImage_1?: string
  podImage_2?: string
}

export interface INykaaClaimDetails {
  vendorCode: string
  skuId: string
  returnType: '' | 'RTO' | 'DTO' | 'REPL'
  /** Nykaa has no master-data lookup; the operator picks or leaves it blank. */
  username?: string
}

export const NYKAA_INITIAL_CLAIM_DETAILS: INykaaClaimDetails = {
  vendorCode: '',
  skuId: '',
  returnType: '',
  username: ''
}

export interface IMyntraClaimDetails {
  shippingLabelImage: string
  packingImages: string[]
  damagedProductVideo: string
  damagedProductVideoLink: string
  disputedAmount?: string
  physicalReceivedSku?: string
  username?: string
}

export const MYNTRA_INITIAL_CLAIM_DETAILS: IMyntraClaimDetails = {
  shippingLabelImage: '',
  packingImages: [],
  damagedProductVideo: '',
  damagedProductVideoLink: '',
  disputedAmount: '',
  physicalReceivedSku: '',
  username: ''
}

export const AMAZON_FULFILLMENT_CHANNEL_OPTIONS = [
  'Easy Ship/ Self Ship/ Seller Flex',
  'Fee related disputes'
] as const

export type AmazonFulfillmentChannel = (typeof AMAZON_FULFILLMENT_CHANNEL_OPTIONS)[number]

export const FLIPKART_CLAIM_AREA_OPTIONS = [
  'Issue(s) with a received return packet',
  'Did not receive a return packet'
] as const

export type FlipkartClaimArea = (typeof FLIPKART_CLAIM_AREA_OPTIONS)[number]

/**
 * Delhivery routes every claim through one shipment issue. The value is fixed
 * (the field renders disabled) but still persisted, so downstream automation
 * has an explicit signal without inspecting the platform name.
 */
export const DELHIVERY_SHIPMENT_ISSUE = 'Damage / Missing / Mismatch'

export const DELHIVERY_SUBCATEGORY_OPTIONS = [
  'Damage in delivered/returned shipment',
  'Missing shipment delivered/returned',
  'Mismatch in delivered/returned shipment'
] as const

export type DelhiverySubcategory = (typeof DELHIVERY_SUBCATEGORY_OPTIONS)[number]

/** Delhivery-only freight lane, rendered right after E-commerce Platform. */
export const DELHIVERY_DOMESTIC_OPTIONS = ['EXPRESS', 'SURFACE'] as const

export type DelhiveryDomestic = (typeof DELHIVERY_DOMESTIC_OPTIONS)[number]

export const PACKING_SIDES = ['top', 'right', 'bottom', 'left'] as const
export type PackingSide = (typeof PACKING_SIDES)[number]

/**
 * One Xbees positional package photo. Each slot carries its own `side` so the
 * array index is not the source of truth for which face of the box it shows.
 */
export interface XbeesPackingImage {
  fileKey: string
  side: PackingSide
}

export interface IOtherClaimDetails {
  /** Issue Area of Affected Item — the cascade parent, shared by all five. */
  parentSelection: string
  /** Flipkart-only: top-level claim classification. */
  claimArea: string
  /** Delhivery-only. `shipmentIssue` is always DELHIVERY_SHIPMENT_ISSUE. */
  shipmentIssue: string
  subcategory: string
  domestic: string
  /** Single-image S3 key. Flipkart / Tata CliQ / Delhivery / Amazon. */
  shippingLabelImage: string
  /**
   * Flipkart / Tata CliQ / Delhivery send a plain string[] (drag-reorder grid).
   * Xbees sends XbeesPackingImage[] so each of the four slots names its side.
   */
  packingImages: string[] | XbeesPackingImage[]
  /** Amazon-only: one of AMAZON_FULFILLMENT_CHANNEL_OPTIONS. */
  fulfillmentChannel: string
  /** Amazon-only: 1..2 S3 keys — photographs of the return's contents. */
  contentsOfReturnImages: string[]
  /** Amazon-only: optional single S3 key — the item's serial number. */
  serialNumberImage: string
  /** Xbees-only: kept as a string so leading zeros survive. */
  disputeAmount: string
  /** Seller-portal account. Flipkart / Tata CliQ / Delhivery / Amazon / Xbees. */
  username?: string

  // ── Tata CliQ QC Fail ────────────────────────────────────────────────────
  /** A TATACLIQ_QC_REASONS code. A string, and the leading zero matters. */
  qcReason?: string
  /** Belongs to Wrong Product alone. */
  qcSubReason?: string
  /**
   * Slot key → S3 key, NOT an array: the portal's six upload slots are
   * positional and named, and a reviewer opens each expecting a particular
   * thing.
   */
  qcImages?: Record<string, string>
  /** URLs the portal fetches itself rather than files it is given. */
  packagingVideoUrl?: string
  unboxingVideoUrl?: string
}

export const OTHER_INITIAL_CLAIM_DETAILS: IOtherClaimDetails = {
  parentSelection: '',
  claimArea: '',
  shipmentIssue: '',
  subcategory: '',
  domestic: '',
  shippingLabelImage: '',
  packingImages: [],
  qcReason: '',
  qcSubReason: '',
  qcImages: {},
  packagingVideoUrl: '',
  unboxingVideoUrl: '',
  fulfillmentChannel: '',
  contentsOfReturnImages: [],
  serialNumberImage: '',
  disputeAmount: '',
  username: ''
}

/** One claim type on a platform, as the company document stores it. */
export interface ClaimTypeOption {
  _id: string
  name: string
  description: string
  key?: string
  isDisable?: boolean
  parentSelection?: string
}

/** One platform on the company, with its claim catalogue. */
export interface ECommercePlatformRecord {
  _id: string
  name: string
  typeOfClaims: ClaimTypeOption[]
}

/** What the create form needs to know about the company, in one read. */
export interface ClaimFormCatalogue {
  platforms: ECommercePlatformRecord[]
  /** Platform name (as stored) → the seller accounts held for it. */
  accounts: Record<string, string[]>
  /**
   * Delhivery login (lowercased username) → the names of its "Domestic"
   * accounts, as synced after its last session update. A login absent here has
   * no list yet, and the form offers EXPRESS / SURFACE instead.
   */
  delhiveryDomestics: Record<string, string[]>
  /** Company feature flag gating the Bulk Claim button. */
  increffBulkClaim: boolean
  /** At least one platform with `allowed: true` in settings.increffAllocation. */
  hasIncreffAllocation: boolean
}

/** One `{ fileKey, url }` pair, as the backend returns a stored image. */
export interface StoredFile {
  fileKey?: string
  url?: string
}

/** A capture feed, as `/feed/common-feed` returns it. */
export interface CommonFeed {
  _id: string
  /** The field is `feedName` on the wire, and the picker renders it. */
  feedName: string
  isDisable?: boolean
  isDeleted?: boolean
}

/** One account that could not be asked during a return-AWB autofill, and why. */
export interface ReturnAwbAccountFailure {
  username: string
  reason: string
}

/**
 * Create Claim's return-AWB autofill — the answer from whichever account held it.
 *
 * `found: false` with `failures` empty means every account was asked and none
 * holds the AWB. Failures are listed separately because "not on any account"
 * and "could not ask two of them" have different fixes.
 */
export interface ReturnAwbAutofill {
  found: boolean
  /** The account that holds the AWB, when found. */
  username: string | null
  forwardAwb: string | null
  sku: string | null
  /** The item's listed price, when the marketplace returns one (Myntra). */
  price: number | null
  /** Meesho's sub-order number for the return, when the marketplace was asked (Meesho). */
  subOrderNumber: string | null
  /** The marketplace's order id, when asked (Flipkart's "OD…" — saved as `customerOrderNumber`). */
  orderId: string | null
  /** The return's carrier as the marketplace names it, when asked (Meesho). */
  logisticsPartner: string | null
  /** How many accounts were asked. */
  asked: number
  failures: ReturnAwbAccountFailure[]
}
