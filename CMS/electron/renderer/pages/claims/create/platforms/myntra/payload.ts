import { cleanKeys, trimOrUndef, type UpdateBuilder } from '../common/payload'

/** Myntra keeps its own create body — none of the common image slots apply. */
export const MYNTRA_CREATE_FIELDS: ReadonlySet<string> = new Set([
  'eCommercePlatform',
  'AWBNumber',
  'typeOfClaim',
  'forwardAWB',
  // Optional; filled from Myntra's `skuId`. Stored as `seller_sku`, like every platform's SKU.
  'skuName',
  'remark',
  /*
   * The videos ARE part of the claim here.
   *
   * The Myntra form renders the same video row every platform does, and the
   * master-data lookup pre-fills `returnVideoLink` from the Myntra row.
   * Omitting these dropped the operator's video on every save, and the claim
   * reached the seller portal with no CCTV link in its description. They are
   * plain text fields, so multer's file whitelist is unaffected.
   */
  'returnVideo',
  'returnVideoLink',
  'forwardVideo',
  'forwardVideoLink',
  'eitherVideoOrLink'
])

export const myntraUpdate: UpdateBuilder = ({ values, platformLabel }) => {
  const bundle = (values.myntraClaimDetails ?? {}) as Record<string, unknown>
  const payload: Record<string, unknown> = {}

  const disputed = bundle.disputedAmount
  if (disputed !== undefined && disputed !== '') payload.disputedAmount = disputed

  const physical = trimOrUndef(bundle.physicalReceivedSku)
  if (physical) payload.physicalReceivedSku = physical

  const shippingLabel = trimOrUndef(bundle.shippingLabelImage)
  if (shippingLabel) payload.myntraShippingLabelImage = shippingLabel

  const packing = cleanKeys(bundle.packingImages)
  if (packing) payload.myntraPackingImages = packing

  // The file wins over the link when both are present: an operator who just
  // recorded footage meant that, not the URL sitting beside it.
  const damagedVideo = trimOrUndef(bundle.damagedProductVideo)

  if (damagedVideo) {
    payload.myntraDamagedProductVideo = damagedVideo
  } else {
    const damagedLink = trimOrUndef(bundle.damagedProductVideoLink)

    if (damagedLink) payload.myntraDamagedProductVideoLink = damagedLink
  }

  payload.eCommercePlatform = platformLabel

  return payload
}
