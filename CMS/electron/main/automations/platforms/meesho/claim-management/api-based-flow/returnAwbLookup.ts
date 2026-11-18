import { loadCore } from '@main/automations/common/coreLoader'
import type { ReturnAwbLookup } from '@main/automations/common/returnAwbLookup'
import { storedSession } from '@main/services/sessionReuse.service'

/**
 * Meesho — the account, sub-order number and carrier behind a return AWB, for
 * Create Claim.
 *
 * THE ONLY SOURCE. Meesho's Create Claim does not read TrackVid's master data
 * (`/master/meesho-order-info`) — a return the master import has not reached
 * yet left the account and sub-order blank and the claim unfileable. This asks
 * Meesho itself: the supplier portal's Returns search (`fetchReturnClaims`,
 * `text_global` = the AWB), whose matching row carries `sub_order_num` and
 * `carrier_name`. The core's `searchReturns` is that call,
 * shared with Refill Data and account mapping, and it answers only the row that
 * actually carries the AWB — never a neighbour the text search turned up.
 *
 * The search is scoped to the session's supplier, so a row coming back IS the
 * answer to "which account holds this return" too.
 *
 * SAVED SESSION ONLY — no liveness pre-check and no sign-in: this runs while an
 * operator is typing. A dead session surfaces as this account's failure, and
 * re-capturing it stays the Login screen's job.
 */

interface ReturnsSearch {
  searchReturns: (
    ctx: unknown,
    query: string
  ) => Promise<{
    found: boolean
    row: { subOrderNumber: string | null; sellerSku?: string | null; carrier?: string | null } | null
  }>
}

const textOf = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null

export const meeshoReturnAwbLookup: ReturnAwbLookup = async ({ awb, username }) => {
  const record = await storedSession('meesho', username)

  if (!record?.jar) throw new Error('no saved session — capture it from the Login screen')

  const extra = (record.extra ?? {}) as Record<string, unknown>

  // The supplier ids, where the capture stored them. When it did not,
  // `searchReturns` recovers them from the session in one call.
  const ctx = {
    jar: record.jar,
    supplierId: record.supplierId ?? extra.supplierId ?? null,
    supplierIdentifier: record.supplierIdentifier ?? extra.supplierIdentifier ?? null
  }

  const { searchReturns } = loadCore<ReturnsSearch>('platforms/meesho/common/returnsSearch')
  const { found, row } = await searchReturns(ctx, awb)

  if (!found || !row) return null

  return {
    // The Returns search names the AWB asked for, not the other leg.
    forwardAwb: null,
    sku: textOf(row.sellerSku),
    subOrderNumber: textOf(row.subOrderNumber),
    logisticsPartner: textOf(row.carrier)
  }
}
