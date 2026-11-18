import { claimCredentials } from '@main/services/claimSession.service'
import { loadCore } from '@main/automations/common/coreLoader'
import { requireClaimConfig } from '@main/automations/common/claimConfig'
import type { TicketFound, TicketLookupInput } from '@main/automations/common/ticketLookup'

/**
 * Meesho — is there a ticket for this sub-order now?
 *
 * `searchTickets` is the same read the claim uses when `createTicket` answers
 * without a ticket id, asked again after a failure. Meesho files a claim
 * against the SUB-ORDER NUMBER, so that is the key; the AWB is not something
 * this endpoint knows about.
 */

interface MeeshoCore {
  loginMeeshoApi: (
    credentials: { username: string; password?: string; _id?: string | undefined },
    opts?: { session?: { jar: Record<string, string> } }
  ) => Promise<unknown>
  searchTicketsBySubOrder: (ctx: unknown, subOrderNumber: string) => Promise<unknown[]>
  extractTicketId: (ticket: unknown) => string | null
  extractTicketStatus: (ticket: unknown) => string | null
  mapMeeshoStatus: (status: string | null) => string | null
}

export const meeshoTicketLookup = async ({
  doc,
  username
}: TicketLookupInput): Promise<TicketFound | null> => {
  const entry = requireClaimConfig('meesho', doc)
  const subOrderNumber = String(entry.subOrderNumber ?? '').trim()

  // Nothing to ask with. Not a failure of this check — Meesho has no other key.
  if (!subOrderNumber) return null

  const core = loadCore<MeeshoCore>('platforms/meesho/claim-management/api-based-flow/claimApiFlow')
  const credentials = await claimCredentials('meesho', username)
  const ctx =
    credentials.context ??
    (await core.loginMeeshoApi(
      { username, password: credentials.password, _id: credentials.credentialId },
      { session: { jar: credentials.jar } }
    ))

  const tickets = await core.searchTicketsBySubOrder(ctx, subOrderNumber)
  const ticket = tickets[0]

  if (!ticket) return null

  const ticketId = core.extractTicketId(ticket)

  if (!ticketId) return null

  const marketplaceStatus = core.extractTicketStatus(ticket)

  return { ticketId, cmsStatus: core.mapMeeshoStatus(marketplaceStatus), marketplaceStatus }
}
