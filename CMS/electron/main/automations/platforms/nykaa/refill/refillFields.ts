import { claimCredentials } from '@main/services/claimSession.service'
import { loadCore } from '@main/automations/common/coreLoader'
import type { RefillInput, RefillValues } from '@main/automations/refill/types'

/**
 * Nykaa — where a filed ticket now stands, and nothing else.
 *
 * ONE FIELD, because Nykaa has one worth repairing. There is no per-claim
 * account (the company's single login owns every ticket), no sub-order number
 * and no forward AWB to fill in. What there is, is a Zoho Desk ticket whose
 * state moves after filing — Open through to Closed — and which nobody can see
 * from the claims list.
 *
 * THE LOOKUP IS BY TICKET NUMBER, through the portal's search
 * (`/portal/api/tickets/search?searchStr=<number>`), and falls back to the
 * reverse AWB when there is no number or the search finds nothing.
 *
 * THE FALLBACK IS BY REVERSE AWB, matched client-side. Zoho's ticket list has no
 * per-AWB filter, so the flow pages through the account's tickets once and
 * indexes them on `cf.cf_awb_dto_rto`. That index is cached on the session,
 * which is why the run reuses one context per account rather than opening one
 * per row: fifty rows then cost one index, not fifty.
 *
 * A ticket that is not in the index is NOT reported as anything. The index
 * stops at a page cap, so an older claim can be real and unindexed, and writing
 * a status for it would be inventing an outcome.
 */

interface NykaaCore {
  loginNykaaApi: (
    credentials: { username: string; password?: string; _id?: string | undefined },
    opts?: { session?: { jar: Record<string, string> } }
  ) => Promise<unknown>
  findTicketByNumber: (ctx: unknown, ticketNumber: string) => Promise<Record<string, unknown> | null>
  findTicketByReverseAwb: (
    ctx: unknown,
    reverseAwb: string
  ) => Promise<Record<string, unknown> | null>
  mapNaykaaStatus: (status: string | null) => string | null
}

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

export const nykaaRefill = async ({
  awb,
  username,
  ticketNumber,
  fields,
  contexts
}: RefillInput): Promise<RefillValues> => {
  if (!fields.includes('statusChange')) return {}

  const core = loadCore<NykaaCore>('platforms/nykaa/claim-management/api-based-flow/claimApiFlow')

  let ctx = contexts.get(username)

  if (!ctx) {
    const credentials = await claimCredentials('nykaa', username)

    ctx =
      credentials.context ??
      (await core.loginNykaaApi(
        { username, password: credentials.password, _id: credentials.credentialId },
        { session: { jar: credentials.jar } }
      ))

    contexts.set(username, ctx)
  }

  /*
   * BY TICKET NUMBER FIRST — the portal's own search, one request per row and
   * no page cap, so an old ticket is found as surely as a new one. The
   * reverse-AWB index stays as the fallback for a row without a number, or
   * one the search does not return.
   */
  const number = text(ticketNumber)
  const ticket =
    (number ? await core.findTicketByNumber(ctx, number) : null) ??
    (await core.findTicketByReverseAwb(ctx, awb))

  // Found by neither: no outcome worth writing over what the row already says.
  if (!ticket) return {}

  const marketplaceStatus = text(ticket.status) || text(ticket.statusType) || null

  return {
    marketplaceStatus,
    status: core.mapNaykaaStatus(marketplaceStatus)
  }
}
