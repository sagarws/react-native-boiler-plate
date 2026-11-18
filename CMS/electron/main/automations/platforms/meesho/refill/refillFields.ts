import { claimCredentials } from '@main/services/claimSession.service'
import { loadCore } from '@main/automations/common/coreLoader'
import type { RefillInput, RefillValues } from '@main/automations/refill/types'

/**
 * Meesho — the sub-order number, and where a filed ticket stands.
 *
 * TWO CALLS AT MOST, and usually one: the Returns search answers the sub-order
 * number (the same call that established the account), and the ticket search
 * answers the status. Neither is made unless the operator asked for the field
 * it answers.
 */

interface MeeshoCore {
  loginMeeshoApi: (
    credentials: { username: string; password?: string; _id?: string | undefined },
    opts?: { session?: { jar: Record<string, string> } }
  ) => Promise<unknown>
  searchTicketsBySubOrder: (ctx: unknown, subOrder: string) => Promise<unknown[]>
  extractTicketStatus: (ticket: unknown) => string | null
  mapMeeshoStatus: (status: string | null) => string | null
}

interface ReturnsSearch {
  searchReturns: (
    ctx: unknown,
    query: string
  ) => Promise<{ found: boolean; row: { subOrderNumber: string | null } | null }>
}

export const meeshoRefill = async ({
  awb,
  username,
  fields,
  contexts,
  doc
}: RefillInput): Promise<RefillValues> => {
  const { loginMeeshoApi, searchTicketsBySubOrder, extractTicketStatus, mapMeeshoStatus } =
    loadCore<MeeshoCore>('platforms/meesho/claim-management/api-based-flow/claimApiFlow')
  const { searchReturns } = loadCore<ReturnsSearch>('platforms/meesho/common/returnsSearch')

  // One session per account for the whole run — a refill over fifty claims on
  // one login must not sign in fifty times.
  let ctx = contexts.get(username)

  if (!ctx) {
    const credentials = await claimCredentials('meesho', username)

    ctx =
      credentials.context ??
      (await loginMeeshoApi(
        { username, password: credentials.password, _id: credentials.credentialId },
        { session: { jar: credentials.jar } }
      ))

    contexts.set(username, ctx)
  }

  const values: RefillValues = {}
  let subOrderNumber = (doc as { subOrderNumber?: string }).subOrderNumber ?? null

  if (fields.includes('subOrderNumber')) {
    const { found, row } = await searchReturns(ctx, awb)

    if (found && row?.subOrderNumber) {
      values.subOrderNumber = row.subOrderNumber
      subOrderNumber = row.subOrderNumber
    }
  }

  if (fields.includes('statusChange')) {
    // Meesho finds a ticket by the SUB-ORDER number, not by the ticket id — so
    // a row without one cannot be asked about, which is why the two fields are
    // usually ticked together.
    if (subOrderNumber) {
      const tickets = await searchTicketsBySubOrder(ctx, subOrderNumber)
      const marketplaceStatus = tickets[0] ? extractTicketStatus(tickets[0]) : null

      values.marketplaceStatus = marketplaceStatus
      values.status = mapMeeshoStatus(marketplaceStatus)
    }
  }

  return values
}
