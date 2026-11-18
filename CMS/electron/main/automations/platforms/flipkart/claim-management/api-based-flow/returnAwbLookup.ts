import { loadCore } from '@main/automations/common/coreLoader'
import type { ReturnAwbLookup } from '@main/automations/common/returnAwbLookup'
import { storedSession } from '@main/services/sessionReuse.service'

/**
 * Flipkart — the order id ("OD…") and order item id behind a return AWB, for
 * Create Claim. Asked in the background while the operator types the AWB; the
 * form fills them in and they are saved with the claim by `/cms/createCMS` —
 * the order id in `customerOrderNumber`, the item id in `subOrderNumber`.
 *
 * The source is the seller portal's Returns search (`returns_searchReturnItem`,
 * searchBy tracking_id), which the claim flow already calls to check the AWB
 * belongs to the account. Its `order_id` block is
 *
 *     { "orderId": "OD439015019313617100", "orderItemIds": ["439015019313617100"] }
 *
 * SAVED SESSION ONLY. The context is rebuilt from the stored record exactly as
 * the claim runner rebuilds it, with no liveness probe and no renewal: a
 * Flipkart sign-in is a browser plus an emailed OTP, which a lookup run while
 * someone types must never start. A dead session is this account's failure.
 *
 * FIRST ROW. A return AWB normally answers one row with one item; when it
 * answers more, the first row and its first item are taken (see pickOrderIds).
 */

interface FlipkartReturn {
  orderId: string | null
  orderItemIds: string[]
}

interface FlipkartCore {
  searchReturnItem: (
    ctx: unknown,
    searchValue: string,
    opts?: { searchBy?: string }
  ) => Promise<{ found: boolean; returns: FlipkartReturn[] }>
}

interface ClaimContextCore {
  claimContextFromSession: (platform: string, record: unknown) => unknown
}

export interface FlipkartOrderIds {
  orderId: string | null
  orderItemId: string | null
}

const unique = (values: (string | null | undefined)[]): string[] => [
  ...new Set(values.map(v => (typeof v === 'string' ? v.trim() : '')).filter(Boolean))
]

/**
 * The ids of the FIRST return the search answers: its `order_id.orderId` and
 * the first of its `order_id.orderItemIds` — one call, both ids, and the item
 * always belongs to that order. Null when there are no rows. Exported for the
 * unit test.
 */
export const pickOrderIds = (returns: FlipkartReturn[]): FlipkartOrderIds | null => {
  const first = returns.find(r => unique([r.orderId]).length > 0 || unique(r.orderItemIds).length > 0)

  if (!first) return null

  return {
    orderId: unique([first.orderId])[0] ?? null,
    orderItemId: unique(first.orderItemIds)[0] ?? null
  }
}

export const flipkartReturnAwbLookup: ReturnAwbLookup = async ({ awb, username }) => {
  const record = await storedSession('flipkart', username)

  if (!record?.jar) throw new Error('no saved session — capture it from the Login screen')

  const { claimContextFromSession } = loadCore<ClaimContextCore>('common/claimContext')
  const ctx = claimContextFromSession('flipkart', record)

  if (!ctx) throw new Error('the saved session cannot be reused without signing in')

  const { searchReturnItem } = loadCore<FlipkartCore>(
    'platforms/flipkart/claim-management/api-based-flow/claimApiFlow'
  )
  const { found, returns } = await searchReturnItem(ctx, awb, { searchBy: 'tracking_id' })
  const ids = found ? pickOrderIds(returns) : null

  // Not on this account — another account may hold it.
  if (!ids) return null

  return {
    // The Returns search names the AWB asked for, not the other leg; the saved
    // reports already fill the forward AWB and SKU.
    forwardAwb: null,
    sku: null,
    orderId: ids.orderId,
    subOrderNumber: ids.orderItemId
  }
}
