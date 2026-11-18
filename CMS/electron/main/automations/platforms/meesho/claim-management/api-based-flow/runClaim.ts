import type { ProcessResult, QueuedClaim } from '@shared/types/claimQueue'
import { claimCredentials } from '@main/services/claimSession.service'
import { meeshoClaimEntry } from '../common/claimEntry'
import { loadCore } from '@main/automations/common/coreLoader'
import { withTempDir } from '@main/automations/common/tempDir'
import type { ClaimDocument, FiledClaim } from '@main/automations/common/types'
import { requireClaimAccount } from '@main/automations/common/claimAccount'
import { requireMeeshoClaimPreflight } from '../common/preflight'

/**
 * Files one Meesho claim from this machine.
 *
 * The sequence — dedupe on sub_order_number, upload every asset, create the
 * ticket, read the ticket id back — is `fileMeeshoClaim` in
 * @trackvid/automation-core, the same function the Automated-Scripts server
 * calls. Only the session differs: captured locally rather than read from the
 * database this app cannot reach.
 */

interface MeeshoCore {
  loginMeeshoApi: (
    credentials: { username: string; password?: string; _id?: string | undefined },
    opts?: { session?: { jar: Record<string, string> } }
  ) => Promise<unknown>
}

interface MeeshoSequence {
  fileMeeshoClaim: (
    ctx: unknown,
    configEntry: ClaimDocument,
    awbNumber: string,
    tempDir: string,
    credentials: { username: string },
    options?: { perClaimFiles?: string[] }
  ) => Promise<FiledClaim>
}

export const runMeeshoClaim = async (
  claim: QueuedClaim,
  doc: ClaimDocument
): Promise<ProcessResult> => {
  const username = await requireClaimAccount('meesho', doc)

  const awb = doc.AWBNumber ?? claim.awbNumber

  if (!awb) throw new Error('The claim has no AWB number')

  const credentials = await claimCredentials('meesho', username)
  // What the sequence actually reads — see claimConfig.
  const entry = meeshoClaimEntry(doc)

  // Same gate as the script-based runner: Meesho's create-ticket endpoint
  // rejects a payload that names a barcode_id detail with an empty value
  // (see claimApiFlow.js line 387), so a missing Packet ID fails here too.
  // Fail before uploading any evidence — the network cost is not the point,
  // the operator's log noise from a claim that could never succeed is.
  requireMeeshoClaimPreflight(awb, entry)

  const { loginMeeshoApi } = loadCore<MeeshoCore>(
    'platforms/meesho/claim-management/api-based-flow/claimApiFlow'
  )
  const { fileMeeshoClaim } = loadCore<MeeshoSequence>(
    'platforms/meesho/claim-management/api-based-flow/fileClaim'
  )

  // The stored session already carries everything this login would
  // return, so a sign-in is only needed when it does not — see
  // common/claimContext in the core.
  const ctx = (credentials.context ??
    (await loginMeeshoApi(
      { username, password: credentials.password, _id: credentials.credentialId },
      { session: { jar: credentials.jar } }
    )))

  const filed = await withTempDir(dir =>
    fileMeeshoClaim(ctx, entry, awb, dir, { username })
  ).catch((error: unknown) => {
    // Meesho refusing the claim window is final — the same verdict Check TAT
    // reads from validateTicketField, arriving here because the submit asked
    // the marketplace directly. Marked terminal so the row moves to Failed to
    // Proceed now instead of spending two more attempts on the same answer.
    if ((error as { code?: string })?.code === 'TAT_EXPIRED') {
      ;(error as { terminal?: boolean }).terminal = true
    }

    throw error
  })

  return {
    cmsId: claim.cmsId,
    ticketId: filed.ticketId,
    message: filed.alreadyExisted
      ? `Meesho ticket already existed (${filed.ticketId})`
      : `Meesho ticket raised (${filed.ticketId})`,
      // Passed through, not dropped: the runner read this off the existing
      // ticket at the marketplace, and it is the freshest statement of where
      // the claim actually stands.
      cmsStatus: filed.cmsStatus ?? null
  }
}
