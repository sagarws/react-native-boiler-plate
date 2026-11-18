import { claimCredentials } from '@main/services/claimSession.service'
import { loadCore } from '@main/automations/common/coreLoader'
import type { RefillInput, RefillValues } from '@main/automations/refill/types'

/**
 * Flipkart — where a filed claim stands, and what it was approved for.
 *
 * `findClaim` is the portal's own ticket search: the state counts name the tab,
 * then that tab is searched by tracking id. It answers with the claim's status
 * AND `approvedAmount`, which is only a payout once the claim is APPROVED —
 * every other tab reports zero.
 *
 * The rejection reason is the claim row's `reasonCodeDisplay` — requested by
 * the core's claims query and kept on `raw`, but not lifted onto the normalised
 * claim. The backend keeps it only beside a Rejected verdict.
 */

interface FlipkartCore {
  loginFlipkartApi: (
    credentials: { username: string; password?: string; _id?: string | undefined },
    opts?: { session?: { jar: Record<string, string> } }
  ) => Promise<unknown>
  findClaim: (
    ctx: unknown,
    trackingId: string,
    hint?: { claimId?: string | null }
  ) => Promise<{
    status: string | null
    approvedAmount: number | null
    raw?: { reasonCodeDisplay?: unknown } | null
  } | null>
  mapFlipkartStatus: (status: string | null) => string | null
  approvedAmountOf: (claim: unknown) => number | null
}

export const flipkartRefill = async ({
  awb,
  username,
  ticketNumber,
  fields,
  contexts
}: RefillInput): Promise<RefillValues> => {
  if (!fields.includes('statusChange')) return {}

  const core = loadCore<FlipkartCore>('platforms/flipkart/claim-management/api-based-flow/claimApiFlow')

  let ctx = contexts.get(username)

  if (!ctx) {
    const credentials = await claimCredentials('flipkart', username)

    ctx =
      credentials.context ??
      (await core.loginFlipkartApi(
        { username, password: credentials.password, _id: credentials.credentialId },
        { session: { jar: credentials.jar } }
      ))

    contexts.set(username, ctx)
  }

  // The ticket id narrows it when the row has one; without it the newest claim
  // for the AWB wins, which is what the portal's own search shows.
  const claim = await core.findClaim(ctx, awb, ticketNumber ? { claimId: ticketNumber } : {})

  if (!claim) return {}

  return {
    marketplaceStatus: claim.status,
    status: core.mapFlipkartStatus(claim.status),
    compensationAmount: core.approvedAmountOf(claim),
    rejectReason: typeof claim.raw?.reasonCodeDisplay === 'string' ? claim.raw.reasonCodeDisplay : null
  }
}
