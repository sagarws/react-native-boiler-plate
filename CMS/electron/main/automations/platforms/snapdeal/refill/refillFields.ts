import { claimCredentials } from '@main/services/claimSession.service'
import { loadCore } from '@main/automations/common/coreLoader'
import type { RefillInput, RefillValues } from '@main/automations/refill/types'

/**
 * Snapdeal — the sub-order number, and where a filed claim ended up.
 *
 * The global AWB search answers the sub-order number (the same call that
 * established the account).
 *
 * THE STATUS COMES FROM THE RETURNS LIST, not the disputes list, because that
 * is where the MONEY is. A completed return carries
 * `paymentDetail.amount` when the claim was paid and nothing when it was not —
 * which is the only statement Snapdeal makes about the outcome, there being no
 * "approved" field to read. The disputes list knows a case exists and what it
 * is called; it does not know whether the seller was paid.
 *
 * So: an amount means Approved and is written as the compensation; a completed
 * return with no amount means Rejected; NO RECORD means the return is not
 * finished and nothing is written at all. The disputes list stays as the
 * fallback for a claim the returns list has not caught up with.
 */

interface SnapdealCore {
  loginSnapdealApi: (
    credentials: { username: string; password?: string; _id?: string | undefined },
    opts?: { session?: { jar: Record<string, string> } }
  ) => Promise<unknown>
  getDisputes: (ctx: unknown, input: { subOrderId: string }) => Promise<unknown[]>
  fetchSettledReturn: (
    ctx: unknown,
    input: { awbNumber: string; subOrderNumber?: string | null; returnType?: string | null }
  ) => Promise<{ found: boolean; status: string | null; amount: number | null }>
  newestDispute: (disputes: unknown[], subOrderId: string) => { status?: string; disputeStatus?: string } | null
  mapSnapdealStatus: (status: string | null) => string | null
}

interface SnapdealProbe {
  probeSnapdealAwb: (
    ctx: unknown,
    awb: string
  ) => Promise<{ found: boolean; details: { subOrderNumber?: string | null } | null }>
}

export const snapdealRefill = async ({
  awb,
  username,
  fields,
  contexts,
  doc
}: RefillInput): Promise<RefillValues> => {
  const core = loadCore<SnapdealCore>('platforms/snapdeal/claim-management/api-based-flow/claimApiFlow')
  const { probeSnapdealAwb } = loadCore<SnapdealProbe>(
    'platforms/snapdeal/account-mapping/api-based-flow/probeAwb'
  )

  let ctx = contexts.get(username)

  if (!ctx) {
    const credentials = await claimCredentials('snapdeal', username)

    ctx =
      credentials.context ??
      (await core.loginSnapdealApi(
        { username, password: credentials.password, _id: credentials.credentialId },
        { session: { jar: credentials.jar } }
      ))

    contexts.set(username, ctx)
  }

  const values: RefillValues = {}
  let subOrderNumber = (doc as { subOrderNumber?: string }).subOrderNumber ?? null

  if (fields.includes('subOrderNumber')) {
    const { found, details } = await probeSnapdealAwb(ctx, awb)

    if (found && details?.subOrderNumber) {
      values.subOrderNumber = details.subOrderNumber
      subOrderNumber = details.subOrderNumber
    }
  }

  if (fields.includes('statusChange')) {
    // The settled return first: it is the only call that knows whether the
    // seller was paid, and the payout is half of what "claim status" means.
    const settled = await core.fetchSettledReturn(ctx, {
      awbNumber: awb,
      subOrderNumber
    })

    if (settled.found) {
      values.status = settled.status
      values.marketplaceStatus = settled.amount !== null ? 'COMPLETED (paid)' : 'COMPLETED (unpaid)'
      // Only ever alongside Approved — a rejected claim has nothing to pay.
      if (settled.amount !== null) values.compensationAmount = settled.amount
    } else if (subOrderNumber) {
      // Not finished, so the returns list says nothing. The dispute's own state
      // is still worth reading: "In Review" is a truer answer than silence for
      // a claim that was filed and is being looked at.
      const disputes = await core.getDisputes(ctx, { subOrderId: subOrderNumber })
      // Newest case on THIS suborder — a return can carry several over its life.
      const top = core.newestDispute(disputes, subOrderNumber)
      const marketplaceStatus = top ? (top.status ?? top.disputeStatus ?? null) : null

      values.marketplaceStatus = marketplaceStatus
      values.status = core.mapSnapdealStatus(marketplaceStatus)
    }
  }

  return values
}
