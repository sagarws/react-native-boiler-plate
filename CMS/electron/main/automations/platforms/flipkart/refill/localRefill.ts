import type { LocalRefill } from '@main/automations/refill/types'
import { lookupFlipkartAwb } from '@main/services/flipkartBackup.service'

/**
 * Flipkart's local answer for a bulk row — the stored Orders and Returns
 * reports, joined on the order item. The order item id is what Flipkart's claim
 * form keeps in `subOrderNumber`, exactly as Create Claim fills it.
 */
export const flipkartLocalRefill: LocalRefill = async awb => {
  const found = await lookupFlipkartAwb({ awb, side: 'return' })

  if (!found.success || !found.data) return null

  return {
    forwardAWB: found.data.forwardAwb,
    subOrderNumber: found.data.orderItemId || null,
    sku: found.data.sku,
    username: found.data.username || null
  }
}
