import type { LocalRefill } from '@main/automations/refill/types'
import { ajioRefill } from './refillFields'

/**
 * AJIO's local answer for a bulk row — the master-data backup, through the same
 * resolver Refill Data uses, so a bulk row and a refilled claim read the same
 * row the same way. The account comes from the POB that owns the return.
 */
export const ajioLocalRefill: LocalRefill = async awb => {
  const values = await ajioRefill({
    doc: {},
    awb,
    username: '',
    ticketNumber: null,
    fields: ['accountMapping', 'forwardAwbNumber', 'sellerSku', 'pobId'],
    contexts: new Map()
  })

  if (values.missing) return null

  return {
    forwardAWB: values.forwardAWB ?? null,
    sku: values.sellerSku ?? null,
    pobId: values.pobId ?? null,
    username: values.username ?? null
  }
}
