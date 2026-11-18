import type { UpdateBuilder } from '../common/payload'

/**
 * Xbees sends its disputed amount and nothing else.
 *
 * It stores into the same `otherClaimDetails` envelope as Flipkart and the
 * rest, but `/cms/updateCMS` accepts only this one field from it — so the
 * shared `other*` contribution is deliberately not used here. Sending a
 * shipping label Xbees never collects would write an empty one over the stored
 * value.
 */
export const xbeesUpdate: UpdateBuilder = ({ values }) => {
  const bundle = (values.otherClaimDetails ?? {}) as Record<string, unknown>
  const amount = bundle.disputeAmount

  return amount !== undefined && amount !== '' ? { disputeAmount: amount } : {}
}
