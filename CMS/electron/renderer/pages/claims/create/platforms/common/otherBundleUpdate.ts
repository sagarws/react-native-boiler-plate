import { cleanKeys, trimOrUndef, type UpdateContext } from './payload'

/**
 * The part of `otherClaimDetails` that Flipkart, Tata CliQ, Delhivery and
 * Amazon all send on update.
 *
 * Create posts the whole envelope as one JSON field; update flattens it into
 * `other*` fields, so the same three values have two spellings and this is the
 * one place that knows both.
 *
 * XBEES IS NOT HERE, deliberately. It stores into the same envelope but the
 * update endpoint takes only its disputed amount, and sending a shipping label
 * it never collected would write an empty one over whatever is stored.
 */
export const otherBundleUpdate = ({ values, platformLabel }: UpdateContext): Record<string, unknown> => {
  const bundle = (values.otherClaimDetails ?? {}) as Record<string, unknown>
  const payload: Record<string, unknown> = {}

  const shippingLabel = trimOrUndef(bundle.shippingLabelImage)
  if (shippingLabel) payload.otherShippingLabelImage = shippingLabel

  // Always sent when it IS a list, empty included: an operator who removed
  // every packing image meant to remove them. Hydration puts the stored keys
  // back into the form, so an untouched form re-sends what is already there.
  const packing = cleanKeys(bundle.packingImages)
  if (packing) payload.otherPackingImages = packing

  const parent = trimOrUndef(bundle.parentSelection)
  if (parent) payload.otherParentSelection = parent

  payload.eCommercePlatform = platformLabel

  return payload
}
