import { otherBundleUpdate } from '../common/otherBundleUpdate'
import { COMMON_CREATE_FIELDS, trimOrUndef, type UpdateBuilder } from '../common/payload'

/**
 * The common fields plus the Sub Order ID — Flipkart's `order_item_id`, filled
 * from the saved Orders/Returns reports. Optional: the form never requires it.
 */
export const FLIPKART_CREATE_FIELDS: ReadonlySet<string> = new Set([
  ...COMMON_CREATE_FIELDS,
  'subOrderNumber'
])

export const flipkartUpdate: UpdateBuilder = (context) => {
  const bundle = (context.values.otherClaimDetails ?? {}) as Record<string, unknown>
  const claimArea = trimOrUndef(bundle.claimArea)

  return {
    ...otherBundleUpdate(context),
    ...(claimArea ? { otherClaimArea: claimArea } : {})
  }
}
