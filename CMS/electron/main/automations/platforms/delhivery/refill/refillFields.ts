import { claimCredentials } from '@main/services/claimSession.service'
import { loadCore } from '@main/automations/common/coreLoader'
import type { RefillInput, RefillValues } from '@main/automations/refill/types'

/**
 * Delhivery — where a filed claim stands.
 *
 * THE SUPPORT TICKET FIRST, by the number the claim was given. Its verdict is
 * the decision itself — `accepted` or `rejected`, verified 2026-09-18 — and it
 * is keyed on the ticket, so there is no chance of reading a neighbouring
 * parcel's outcome.
 *
 * The claims list is the fallback, for a row whose ticket number was never
 * recorded. It is searched by AWB and matched strictly on `wbn`: the search can
 * answer with neighbours, and a status stapled onto the wrong parcel is worse
 * than no status.
 *
 * Anything that is not a decision — open, pending, whatever Delhivery calls the
 * middle — maps to nothing at all, so a claim under review stays under review
 * instead of being rewritten on every sweep.
 *
 * THE REASON LIVES ONLY ON THE CLAIMS LIST, as `closing_remark`. The ticket
 * carries the verdict and nothing about why, so a ticket that says Rejected
 * costs one more call — the list, matched on `wbn` as below — and a ticket that
 * says anything else costs none.
 */

interface DelhiveryCore {
  loginDelhiveryApi: (
    credentials: { username: string; password?: string; _id?: string | undefined },
    opts?: { session?: unknown }
  ) => Promise<unknown>
  listLostDamageClaims: (
    ctx: unknown,
    input: { awb: string }
  ) => Promise<{ wbn?: string; status?: string | null; closing_remark?: string | null }[]>
  mapDelhiveryStatus: (status: string | null) => string | null
  fetchClientTicket: (
    ctx: unknown,
    publicTicketId: string
  ) => Promise<{ status?: string | null; public_ticket_id?: string } | null>
  mapDelhiveryTicketStatus: (status: string | null) => string | null
  isInternalTicketId: (value: string | null) => boolean
  resolvePublicTicketId: (ctx: unknown, awb: string, ticketUuid: string) => Promise<string | null>
}

export const delhiveryRefill = async ({
  awb,
  username,
  fields,
  contexts,
  ticketNumber
}: RefillInput): Promise<RefillValues> => {
  if (!fields.includes('statusChange')) return {}

  const core = loadCore<DelhiveryCore>(
    'platforms/delhivery/claim-management/api-based-flow/claimApiFlow'
  )

  let ctx = contexts.get(username)

  if (!ctx) {
    const credentials = await claimCredentials('delhivery', username)

    ctx =
      credentials.context ??
      (await core.loginDelhiveryApi({
        username,
        password: credentials.password,
        _id: credentials.credentialId
      }))

    contexts.set(username, ctx)
  }

  // Strictly this parcel's row — the search can answer with neighbours.
  const claimRow = async () => {
    const results = await core.listLostDamageClaims(ctx, { awb })

    return results.find(row => String(row?.wbn) === String(awb)) ?? null
  }

  /*
   * A ROW HOLDING DELHIVERY'S INTERNAL TICKET ID, NOT ITS J-NUMBER.
   *
   * Claims found already filed were recorded with the UUID the claims list
   * calls `jarvis_ticket_id`. The ticket cannot be read by it, so the status
   * was only ever coming from the claims list — and the seller sees a number
   * that means nothing on the portal. Resolved here, used for this read, and
   * handed back so the run writes the J-number onto the row. One correction
   * per row: once it holds the J-number, this never fires again.
   */
  let correctedTicket: string | null = null

  if (ticketNumber && core.isInternalTicketId(ticketNumber)) {
    correctedTicket = await core.resolvePublicTicketId(ctx, awb, ticketNumber).catch(() => null)
  }

  const readable = correctedTicket ?? ticketNumber
  const corrected = correctedTicket ? { ticketNumber: correctedTicket } : {}

  if (readable) {
    const ticket = await core.fetchClientTicket(ctx, readable)

    if (ticket) {
      const marketplaceStatus = ticket.status ?? null
      const status = core.mapDelhiveryTicketStatus(marketplaceStatus)
      // The reason is not worth failing the verdict over: a list that will not
      // answer leaves the status standing without one.
      const rejectReason =
        status === 'Rejected'
          ? ((await claimRow().catch(() => null))?.closing_remark ?? null)
          : null

      return { ...corrected, marketplaceStatus, status, rejectReason }
    }
  }

  const hit = await claimRow()

  if (!hit) return corrected

  return {
    ...corrected,
    marketplaceStatus: hit.status ?? null,
    status: core.mapDelhiveryStatus(hit.status ?? null),
    rejectReason: hit.closing_remark ?? null
  }
}
