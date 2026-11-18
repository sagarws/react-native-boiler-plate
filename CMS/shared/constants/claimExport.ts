import { platformKey } from '@shared/utils/platformKey'

/**
 * Manage Claims → Export: the spreadsheet columns, per platform.
 *
 * MIRRORS THE CREATE CLAIM FORM. Each platform's middle block is the fields its
 * own form asks for, labelled as the form labels them, so a sheet reads like
 * the claims an operator typed in. Change a form, change its entry here.
 *
 * NO RESOURCES. Images and uploaded video files are evidence, not data — they
 * are links that expire or file ids nobody can open from a cell. The one
 * exception is a video LINK: `returnVideoLink` / `forwardVideoLink` are the
 * AWB's VMS footage URLs, stored as plain text and openable from the sheet.
 *
 * `path` is a dotted path into the stored claim document. `account` is the one
 * computed column — five platforms keep the seller account in five different
 * places, and the core's `claimAccountUsername` already knows them all.
 */

export interface ExportColumn {
  header: string
  /** Dotted path into the stored claim, or `account` for the resolved seller account. */
  path: string
}

const HEAD: readonly ExportColumn[] = [
  { header: 'E-commerce Platform', path: 'eCommercePlatform' },
  { header: 'Account Username', path: 'account' },
  { header: 'Type Of Claim', path: 'typeOfClaim' },
  { header: 'Return AWB Number', path: 'AWBNumber' },
  { header: 'Forward AWB', path: 'forwardAWB' }
]

const TAIL: readonly ExportColumn[] = [
  { header: 'Remark', path: 'remark' },
  { header: 'Return Video Link', path: 'returnVideoLink' },
  { header: 'Forward Video Link', path: 'forwardVideoLink' },
  // Not form fields — what happened to the claim after it was filed, which is
  // why anyone exports a claims list.
  { header: 'Ticket Number', path: 'ticketNumber' },
  { header: 'Status', path: 'status' },
  { header: 'Created At', path: 'createdAt' }
]

const SKU: ExportColumn = { header: 'SKU', path: 'seller_sku' }
const COST_OF_MISSING: ExportColumn = { header: 'Cost Of Missing Article', path: 'costOfMissingArticle' }
const SUB_ORDER: ExportColumn = { header: 'Sub Order Number', path: 'subOrderNumber' }

/** Each platform's own form fields — the middle of its sheet. */
const PLATFORM_COLUMNS: Record<string, readonly ExportColumn[]> = {
  ajio: [
    { header: 'Return Order Number', path: 'returnOrderId' },
    { header: 'Customer Order Number', path: 'customerOrderNumber' },
    SKU,
    { header: 'POB ID', path: 'pobid' },
    COST_OF_MISSING
  ],
  meesho: [
    SUB_ORDER,
    { header: 'Packet ID', path: 'packetId' },
    { header: 'Logistics Partner Name', path: 'logisticsPartnerName' },
    { header: 'State Of The Packet', path: 'stateOfThePacket' },
    COST_OF_MISSING
  ],
  myntra: [
    SKU,
    { header: 'Disputed Amount', path: 'myntraClaimDetails.disputedAmount' },
    { header: 'Physical Received SKU', path: 'myntraClaimDetails.physicalReceivedSku' }
  ],
  snapdeal: [SUB_ORDER, SKU, COST_OF_MISSING],
  nykaa: [
    { header: 'Vendor Code', path: 'nykaaClaimDetails.vendorCode' },
    { header: 'SKU ID', path: 'nykaaClaimDetails.skuId' },
    { header: 'Return Type', path: 'nykaaClaimDetails.returnType' }
  ],
  amazon: [
    { header: 'Fulfillment Channel', path: 'otherClaimDetails.fulfillmentChannel' },
    SKU,
    COST_OF_MISSING
  ],
  flipkart: [
    // Filled from Flipkart's Returns search while the return AWB is typed, and
    // saved by createCMS — see flipkart/.../returnAwbLookup. Top-level fields.
    { header: 'Order ID', path: 'customerOrderNumber' },
    { header: 'Order Item ID', path: 'subOrderNumber' },
    { header: 'Claim Area', path: 'otherClaimDetails.claimArea' },
    { header: 'Issue Area', path: 'otherClaimDetails.parentSelection' },
    SKU,
    COST_OF_MISSING
  ],
  tatacliq: [
    SKU,
    COST_OF_MISSING,
    { header: 'Packaging Video URL', path: 'otherClaimDetails.packagingVideoUrl' },
    { header: 'Unboxing Video URL', path: 'otherClaimDetails.unboxingVideoUrl' }
  ],
  delhivery: [
    { header: 'Domestic', path: 'otherClaimDetails.domestic' },
    { header: 'Shipment Issue', path: 'otherClaimDetails.shipmentIssue' },
    { header: 'Subcategory', path: 'otherClaimDetails.subcategory' },
    SKU,
    COST_OF_MISSING
  ],
  xbees: [SKU, COST_OF_MISSING, { header: 'Dispute Amount', path: 'otherClaimDetails.disputeAmount' }]
}

/** A platform this map has never heard of still exports its common fields. */
const FALLBACK: readonly ExportColumn[] = [SKU, COST_OF_MISSING]

/** The columns of one platform's sheet, in order. */
export const exportColumns = (platform: string): readonly ExportColumn[] => [
  ...HEAD,
  ...(PLATFORM_COLUMNS[platformKey(platform)] ?? FALLBACK),
  ...TAIL
]
