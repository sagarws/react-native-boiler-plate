import type { LocalRefill } from '@main/automations/refill/types'
import { findSnapdealByAwb } from '@main/services/snapdealBackup.store'

/**
 * Snapdeal's local answer for a bulk row — the stored return report, which
 * carries the forward AWB, the sub-order and the SKU on the return AWB's row.
 * The same lookup Create Claim makes when an AWB is typed.
 */
export const snapdealLocalRefill: LocalRefill = async awb => {
  const record = await findSnapdealByAwb(awb, 'return')

  if (!record) return null

  return {
    forwardAWB: record.awb || null,
    subOrderNumber: record.subOrderCode || null,
    sku: record.sku || null
  }
}
