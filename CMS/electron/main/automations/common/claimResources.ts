import type { ClaimDocument } from './types'
import { loadCore } from './coreLoader'

/**
 * What one claim's evidence bundle holds, before anything is downloaded.
 *
 * Each platform describes its own claim form in
 * `platforms/<platform>/claim-management/common/claimResources.ts` and is
 * registered in `registry.ts`; this file holds only what every platform shares.
 * The source is `/cms/find-by-awb`: `config` is the backend's per-platform
 * mapping (`getPlatformConfig`, the same one the claim runners read), and the
 * document around it carries resolved URLs for the row's generic evidence.
 */

export interface ResourceFile {
  /** Filename WITHOUT extension — the claim form's own name for the slot. */
  name: string
  /** The form field it goes into, as the operator will see it. */
  field: string
  url: string
}

export interface ClaimResources {
  /** Named after the platform's claim form, in form order. */
  files: ResourceFile[]
  /** Text the form asks for: label → value. Empty values are dropped later. */
  fields: [label: string, value: string][]
  /** The claim description, as plain text ready to paste. */
  description: string
}

export type ClaimResourceBuilder = (doc: ClaimDocument, config: Record<string, unknown>) => ClaimResources

/** A trimmed string, or "" for anything else. */
export const text = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : typeof value === 'number' ? String(value) : ''

const isUrl = (value: string): boolean => /^https?:\/\//i.test(value)

/**
 * Every URL in a value, in order, whatever shape the backend used:
 * a string, `{ url }`, or an array of either.
 */
export const urls = (value: unknown): string[] => {
  const one = (item: unknown): string => {
    if (typeof item === 'string') return item.trim()
    if (item && typeof item === 'object' && 'url' in item) return text(item.url)
    return ''
  }

  return (Array.isArray(value) ? value.map(one) : [one(value)]).filter(isUrl)
}

/** `url` → one file, or nothing when the slot is empty. */
export const single = (name: string, field: string, value: unknown): ResourceFile[] => {
  const [url] = urls(value)

  return url ? [{ name, field, url }] : []
}

/**
 * A multi-image slot. `name(i)` receives the 1-based index, so each platform
 * keeps its own spelling — Snapdeal's `product_image1`, Meesho's `product_1`.
 */
export const numbered = (name: (index: number) => string, field: string, value: unknown): ResourceFile[] =>
  urls(value).map((url, i) => ({ name: name(i + 1), field, url }))

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' ? (value as Record<string, unknown>) : {}

/**
 * HTML → plain text, links kept as bare URLs.
 *
 * Delegated to the core rather than re-implemented: the claim flows convert
 * the same email template before submitting it, and a desktop copy would drift
 * from what the automation actually sends. The core still holds four copies of
 * this converter (AJIO ×2, Nykaa, Snapdeal) — Snapdeal's is used because its
 * module loads without a browser; lifting one into the core's `common/text` is
 * the real fix.
 */
export const plainText = (html: unknown): string => {
  const source = text(html)

  if (!source) return ''

  const { htmlToText } = loadCore<{ htmlToText: (html: string) => string }>(
    'platforms/snapdeal/claim-management/common/utils'
  )

  return htmlToText(source)
}

/** The description every platform's config falls back to. */
export const templateDescription = (doc: ClaimDocument, config: Record<string, unknown>): string =>
  plainText(
    text(config.description) ||
      text(record(config.emailTemplate).body) ||
      text(record(doc.emailTemplate).body) ||
      text(doc.remark)
  )

/** The identifiers every claim form asks for in some form. */
export const commonFields = (doc: ClaimDocument): [string, string][] => [
  ['Platform', text(doc.eCommercePlatform)],
  ['Return AWB', text(doc.AWBNumber)],
  ['Forward AWB', text(doc.forwardAWB)],
  ['Customer order number', text(doc.customerOrderNumber)],
  ['Sub order number', text(doc.subOrderNumber)],
  ['Type of claim', text(doc.typeOfClaim)],
  ['Existing ticket', text(doc.ticketNumber)]
]

/**
 * Every piece of evidence the row itself carries, under TrackVid's own names.
 *
 * A platform's form uses only some of it. The rest still helps someone filing
 * by hand — a support agent may ask for the forward video a form has no slot
 * for — so it travels in `supporting/`, minus anything the form already took.
 */
export const supportingFiles = (doc: ClaimDocument): ResourceFile[] => {
  const myntra = record(doc.myntraClaimDetails)
  const other = record(doc.otherClaimDetails)

  return [
    ...single('six_side_images', 'Six side images', doc.sixSideImages),
    ...single('pod_proof', 'Proof of delivery', doc.podProof),
    ...single('return_product_image', 'Returned product image', doc.returnProductImage),
    ...single('forward_sent_product_image', 'Forward sent product image', doc.forwardSentProductImage),
    ...single('return_video', 'Return (unpacking) video', doc.returnVideoLink),
    ...single('forward_video', 'Forward (packing) video', doc.forwardVideoLink),
    ...single('barcode_image', 'Barcode image', doc.barcodeImage),
    ...single('received_product_image', 'Received product image', doc.receivedProductImage_1),
    ...single('reverse_waybill_image', 'Reverse waybill image', doc.reverseWayBillImage),
    ...single('outer_package_image_1', 'Outer package image', doc.outerPackageImage_1),
    ...single('outer_package_image_2', 'Outer package image', doc.outerPackageImage_2),
    ...single('inner_package_image_1', 'Inner package image', doc.innerPackageImage_1),
    ...single('inner_package_image_2', 'Inner package image', doc.innerPackageImage_2),
    ...single('product_image_1', 'Product image', doc.productImage_1),
    ...single('product_image_2', 'Product image', doc.productImage_2),
    ...single('pod_image_1', 'POD image', doc.podImage_1),
    ...single('pod_image_2', 'POD image', doc.podImage_2),
    ...single('shipping_label', 'Shipping label', myntra.shippingLabelImage ?? other.shippingLabelImage),
    ...numbered(i => `packing_image_${i}`, 'Packing image', [
      ...urls(myntra.packingImages),
      ...urls(other.packingImages)
    ])
  ]
}

/**
 * Amazon, Tata CliQ, Other — anything with no claim form of its own here.
 * Everything the row has, under TrackVid's names.
 */
export const genericClaimResources: ClaimResourceBuilder = (doc, config) => ({
  files: supportingFiles(doc),
  fields: commonFields(doc),
  description: templateDescription(doc, config)
})
