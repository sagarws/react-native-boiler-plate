import { returnAwbAutofill } from '@renderer/services/claimCreate.service'
import { fillBlank, isBlank, type BulkSpec } from '../common/bulk'
import { shippingAndPackingPlacement } from '../common/packingBulk'

/**
 * Flipkart in Normal Bulk Claim. Claim Area comes from the registry's header fields.
 *
 * Each row asks Flipkart's Returns search (saved sessions, no sign-in) for the
 * order id and order item id, as the form does on an AWB, so a bulk claim is
 * saved with them too. Fill-only; a failed lookup leaves the row as it was.
 */
export const flipkartBulk: BulkSpec = {
  columns: [],
  place: shippingAndPackingPlacement,
  refill: true,
  enrich: async (values) => {
    if (!isBlank(values.customerOrderNumber) && !isBlank(values.subOrderNumber)) return values

    const bundle = (values.otherClaimDetails ?? {}) as Record<string, unknown>
    const chosen = typeof bundle.username === 'string' ? bundle.username.trim() : ''
    const response = await returnAwbAutofill('flipkart', String(values.AWBNumber ?? '').trim(), chosen || undefined)

    if (!response.success || !response.data.found) return values

    const next = fillBlank(values, 'customerOrderNumber', response.data.orderId)

    return fillBlank(next, 'subOrderNumber', response.data.subOrderNumber)
  }
}
