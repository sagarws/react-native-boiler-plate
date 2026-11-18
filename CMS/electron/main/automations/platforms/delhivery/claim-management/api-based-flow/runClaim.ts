import type { ProcessResult, QueuedClaim } from '@shared/types/claimQueue'
import { claimCredentials } from '@main/services/claimSession.service'
import { requireClaimConfig } from '@main/automations/common/claimConfig'
import { loadCore } from '@main/automations/common/coreLoader'
import { withTempDir } from '@main/automations/common/tempDir'
import type { ClaimDocument, FiledClaim } from '@main/automations/common/types'
import { logger } from '@main/services/logger'
import { requireClaimAccount } from '@main/automations/common/claimAccount'

/**
 * Files one Delhivery claim from this machine.
 *
 * `fileDelhiveryClaim` in @trackvid/automation-core is the same function the
 * Automated-Scripts server calls.
 *
 * Delhivery is the one platform where a failure on our side can still leave a
 * real ticket at the carrier — the submit lands but the response is lost. The
 * core's `recoverTicketAfterFailure` asks by AWB before any failure is
 * reported, and it is used here for the same reason the server uses it: without
 * it the next run files a duplicate claim.
 */

interface DelhiveryCore {
  loginDelhiveryApi: (
    credentials: { username: string; password?: string; _id?: string | undefined },
    opts?: { session?: { jar: Record<string, string> } }
  ) => Promise<unknown>
}

interface DelhiverySequence {
  fileDelhiveryClaim: (
    ctx: unknown,
    configEntry: ClaimDocument,
    awbNumber: string,
    tempDir: string,
    options?: { perClaimFiles?: string[] }
  ) => Promise<FiledClaim>
  recoverTicketAfterFailure: (
    ctx: unknown,
    awbNumber: string,
    failure: { code?: string }
  ) => Promise<{ publicTicketId?: string } | null>
}

export const runDelhiveryClaim = async (
  claim: QueuedClaim,
  doc: ClaimDocument
): Promise<ProcessResult> => {
  const username = await requireClaimAccount('delhivery', doc)

  const awb = doc.AWBNumber ?? claim.awbNumber

  if (!awb) throw new Error('The claim has no AWB number')

  const credentials = await claimCredentials('delhivery', username)
  // What the sequence actually reads — see claimConfig.
  const entry = requireClaimConfig('delhivery', doc)

  const { loginDelhiveryApi } = loadCore<DelhiveryCore>(
    'platforms/delhivery/claim-management/api-based-flow/claimApiFlow'
  )
  const { fileDelhiveryClaim, recoverTicketAfterFailure } = loadCore<DelhiverySequence>(
    'platforms/delhivery/claim-management/api-based-flow/fileClaim'
  )

  // The stored session already carries everything this login would
  // return, so a sign-in is only needed when it does not — see
  // common/claimContext in the core.
  const ctx = (credentials.context ??
    (await loginDelhiveryApi(
      { username, password: credentials.password, _id: credentials.credentialId },
      { session: { jar: credentials.jar } }
    )))

  try {
    const filed = await withTempDir(dir => fileDelhiveryClaim(ctx, entry, awb, dir))

    return {
      cmsId: claim.cmsId,
      ticketId: filed.ticketId,
      message: filed.alreadyExisted
        ? `Delhivery ticket already existed (${filed.ticketId})`
        : `Delhivery ticket raised (${filed.ticketId})`,
      // Passed through, not dropped: the runner read this off the existing
      // ticket at the marketplace, and it is the freshest statement of where
      // the claim actually stands.
      cmsStatus: filed.cmsStatus ?? null
    }
  } catch (error) {
    // Before reporting a failure, ask whether the ticket exists anyway.
    const failure = error as { code?: string; message?: string }
    const recovered = await recoverTicketAfterFailure(ctx, awb, failure)

    if (!recovered?.publicTicketId) throw error

    logger.warn(
      `Delhivery claim ${claim.cmsId} errored but the ticket exists: ${recovered.publicTicketId}`
    )

    return {
      cmsId: claim.cmsId,
      ticketId: recovered.publicTicketId,
      message: `Delhivery ticket recovered after an error (${recovered.publicTicketId})`
    }
  }
}
