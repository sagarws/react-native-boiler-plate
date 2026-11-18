import { claimCredentials } from '@main/services/claimSession.service'
import { loadCore } from '@main/automations/common/coreLoader'
import { requireClaimConfig } from '@main/automations/common/claimConfig'
import type { TicketFound, TicketLookupInput } from '@main/automations/common/ticketLookup'

/**
 * Snapdeal — is there a dispute on this suborder now?
 *
 * `getDisputes` is the same read the claim makes when a submit fails
 * ambiguously, asked again after any failure — including one that happened
 * before the submit, where the answer is a dispute an earlier run filed and
 * nobody recorded.
 *
 * The suborder is preferred from the CMS row, as the claim flow prefers it: it
 * was written when the return was created, and a search that failed is exactly
 * the case where the marketplace's copy is not available to fall back on.
 */

interface SnapdealCore {
  loginSnapdealApi: (
    credentials: { username: string; password?: string; _id?: string | undefined },
    opts?: { session?: { jar: Record<string, string> } }
  ) => Promise<unknown>
  getDisputes: (
    ctx: unknown,
    input: { subOrderId: string; pageSize?: number }
  ) => Promise<Record<string, unknown>[]>
  mapSnapdealStatus: (status: string | null) => string | null
}

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

export const snapdealTicketLookup = async ({
  doc,
  username
}: TicketLookupInput): Promise<TicketFound | null> => {
  const entry = requireClaimConfig('snapdeal', doc)
  const subOrderId = String(entry.subOrderNumber ?? '').trim()

  if (!subOrderId) return null

  const core = loadCore<SnapdealCore>(
    'platforms/snapdeal/claim-management/api-based-flow/claimApiFlow'
  )
  const credentials = await claimCredentials('snapdeal', username)
  const ctx =
    credentials.context ??
    (await core.loginSnapdealApi(
      { username, password: credentials.password, _id: credentials.credentialId },
      { session: { jar: credentials.jar } }
    ))

  const disputes = await core.getDisputes(ctx, { subOrderId })
  // Newest first is how the flow reads this list elsewhere.
  const dispute = disputes[0]

  if (!dispute) return null

  const ticketId =
    text(dispute.caseId) || text(dispute.disputeId) || text(dispute.id) || text(dispute.ticketId)

  if (!ticketId) return null

  const marketplaceStatus =
    text(dispute.status) || text(dispute.disputeStatus) || text(dispute.caseStatus) || null

  return { ticketId, cmsStatus: core.mapSnapdealStatus(marketplaceStatus), marketplaceStatus }
}
