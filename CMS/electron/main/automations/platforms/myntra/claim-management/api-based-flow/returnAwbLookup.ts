import { loadCore } from '@main/automations/common/coreLoader'
import type { ReturnAwbLookup } from '@main/automations/common/returnAwbLookup'
import { storedSession } from '@main/services/sessionReuse.service'

/**
 * Myntra — the forward AWB and SKU behind a return AWB, for Create Claim.
 *
 * `fetchNewClaim` is the call the claim flow opens with, and its row already
 * carries both: `trackingId` is the FORWARD leg's AWB and `skuId` the line's
 * SKU. Same call Refill Data reads the forward AWB from.
 *
 * SAVED SESSION ONLY. The jar is read straight from the company document —
 * no liveness pre-check and no sign-in. Myntra answers a dead jar with an auth
 * error, which surfaces as this account's failure, and re-capturing it stays
 * the Login screen's job.
 */

interface MyntraCore {
  fetchNewClaim: (
    jar: unknown,
    searchId: string
  ) => Promise<{
    row?: {
      trackingId?: unknown
      skuId?: unknown
      styleInfo?: { styleBasic?: { price?: unknown } | null } | null
    } | null
  }>
}

/** The codes Myntra's flow raises for "this AWB is not claimable on this account". */
const NOT_MINE = new Set(['NO_VALID_CLAIM', 'AWB_NOT_FOUND'])

/** Myntra sends ids as numbers (`skuId`) and strings (`trackingId`). */
const textOf = (value: unknown): string | null => {
  if (typeof value !== 'string' && typeof value !== 'number') return null

  const text = String(value).trim()

  return text.length > 0 ? text : null
}

export const myntraReturnAwbLookup: ReturnAwbLookup = async ({ awb, username }) => {
  const record = await storedSession('myntra', username)

  if (!record?.jar) throw new Error('no saved session — capture it from the Login screen')

  const { fetchNewClaim } = loadCore<MyntraCore>(
    'platforms/myntra/claim-management/api-based-flow/claimApiFlow'
  )

  try {
    const lookup = await fetchNewClaim(record.jar, awb)
    const row = lookup?.row

    if (!row) return null

    const forward = textOf(row.trackingId)

    // The item's listed price — a partial return's disputed amount.
    const price = Number(row.styleInfo?.styleBasic?.price)

    return {
      price: Number.isFinite(price) && price > 0 ? price : null,
      // Myntra answers this search for either leg. Searched by the forward AWB,
      // `trackingId` is the number typed — not a second one to fill in.
      forwardAwb: forward && forward !== awb ? forward : null,
      sku: textOf(row.skuId)
    }
  } catch (error) {
    if (NOT_MINE.has((error as { code?: string } | null)?.code ?? '')) return null

    throw error
  }
}
