import { claimCredentials } from '@main/services/claimSession.service'
import { loadCore } from '@main/automations/common/coreLoader'
import type { RefillInput, RefillValues } from '@main/automations/refill/types'

/**
 * Myntra — the forward AWB, and where a filed ticket stands.
 *
 * `fetchNewClaim` is the same lookup the account probe makes: it answers with
 * the claim row for a return AWB, and that row carries `trackingId` — the
 * FORWARD leg's AWB, which the claims grid shows as the Scanned Number. So the
 * forward AWB costs nothing beyond a call the run was making anyway.
 *
 * The status comes from `fetchClaimByTicketId`, and brings the payout with it
 * once Myntra has settled — `finalAmount`, falling back to `compensationAmount`.
 * The rejection reason is `rejectReason` / `rejectReasonDescription`, falling
 * back to `validationReason`, Myntra's code for why the claim landed where it
 * did (e.g. `VMS_Footage_Not_Available_FWRD`).
 */

interface MyntraCore {
  loginMyntraApi: (
    credentials: { username: string; password?: string; _id?: string | undefined },
    opts?: { session?: { jar: Record<string, string> } }
  ) => Promise<unknown>
  fetchNewClaim: (
    jar: unknown,
    searchId: string
  ) => Promise<{ row?: { trackingId?: string | null } | null }>
  fetchClaimByTicketId: (
    jar: unknown,
    ticketId: string
  ) => Promise<{
    found: boolean
    status: string | null
    validationReason: string | null
    row: unknown
  }>
  mapMyntraStatus: (status: string | null) => string | null
  myntraCompensation: (row: unknown) => number | null
}

const field = (row: unknown, key: string): unknown =>
  row && typeof row === 'object' ? (row as Record<string, unknown>)[key] : undefined

/**
 * `finalAmount` is what Myntra actually settled, so it outranks the core's
 * `compensationAmount` read. The backend still stores it only beside an
 * Approved/Paid status, so an amount on an open ticket is never written.
 */
export const finalAmount = (row: unknown): number | null => {
  const raw = field(row, 'finalAmount')

  if (raw === null || raw === undefined || raw === '') return null

  const amount = Number(raw)

  return Number.isFinite(amount) ? amount : null
}

/**
 * Myntra's own rejection text — `rejectReason`, else its description — before
 * the `validationReason` code, which is only the category it fell under.
 */
export const rejectReasonOf = (row: unknown): string | null => {
  for (const key of ['rejectReason', 'rejectReasonDescription']) {
    const value = field(row, key)

    if (typeof value === 'string' && value.trim()) return value.trim()
  }

  return null
}

export const myntraRefill = async ({
  awb,
  username,
  ticketNumber,
  fields,
  contexts
}: RefillInput): Promise<RefillValues> => {
  const core = loadCore<MyntraCore>('platforms/myntra/claim-management/api-based-flow/claimApiFlow')

  // Myntra's helpers take the JAR itself rather than a context object — see
  // common/claimContext in the core.
  let jar = contexts.get(username)

  if (!jar) {
    const credentials = await claimCredentials('myntra', username)

    jar =
      credentials.context ??
      (await core.loginMyntraApi(
        { username, password: credentials.password, _id: credentials.credentialId },
        { session: { jar: credentials.jar } }
      ))

    contexts.set(username, jar)
  }

  const values: RefillValues = {}

  if (fields.includes('forwardAwbNumber')) {
    const lookup = await core.fetchNewClaim(jar, awb)
    const forward = lookup?.row?.trackingId ?? null

    // Only when it is a DIFFERENT number. Myntra answers this lookup for either
    // leg, so a row searched by its forward AWB would otherwise be "filled"
    // with the value it was searched by.
    if (forward && forward !== awb) values.forwardAWB = forward
  }

  if (fields.includes('statusChange') && ticketNumber) {
    const claim = await core.fetchClaimByTicketId(jar, ticketNumber)

    if (claim.found) {
      values.marketplaceStatus = claim.status
      values.status = core.mapMyntraStatus(claim.status)
      values.compensationAmount = finalAmount(claim.row) ?? core.myntraCompensation(claim.row)
      values.rejectReason = rejectReasonOf(claim.row) ?? claim.validationReason
    }
  }

  return values
}
