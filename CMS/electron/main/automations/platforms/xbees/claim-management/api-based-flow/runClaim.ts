import type { ProcessResult, QueuedClaim } from '@shared/types/claimQueue'
import { claimCredentials } from '@main/services/claimSession.service'
import { requireClaimConfig } from '@main/automations/common/claimConfig'
import { loadCore } from '@main/automations/common/coreLoader'
import { withTempDir } from '@main/automations/common/tempDir'
import type { ClaimDocument, FiledClaim } from '@main/automations/common/types'
import { requireClaimAccount } from '@main/automations/common/claimAccount'

/**
 * Files one Xbees claim from this machine.
 *
 * `fileXbeesClaim` in @trackvid/automation-core is the same function the
 * Automated-Scripts server calls — including the labelled photo slots, which
 * Xbees keys the dispute on.
 */

interface XbeesCore {
  loginXbeesApi: (
    credentials: { username: string; password?: string; _id?: string | undefined },
    opts?: { session?: { jar: Record<string, string> } }
  ) => Promise<unknown>
}

interface XbeesSequence {
  fileXbeesClaim: (
    ctx: unknown,
    configEntry: ClaimDocument,
    awbNumber: string,
    tempDir: string,
    vocab: Record<string, unknown>,
    options?: { perClaimFiles?: string[] }
  ) => Promise<FiledClaim>
}

export const runXbeesClaim = async (
  claim: QueuedClaim,
  doc: ClaimDocument
): Promise<ProcessResult> => {
  const username = await requireClaimAccount('xbees', doc)

  const awb = doc.AWBNumber ?? claim.awbNumber

  if (!awb) throw new Error('The claim has no AWB number')

  const credentials = await claimCredentials('xbees', username)
  // What the sequence actually reads — see claimConfig.
  const entry = requireClaimConfig('xbees', doc)

  const { loginXbeesApi } = loadCore<XbeesCore>(
    'platforms/xbees/claim-management/api-based-flow/claimApiFlow'
  )
  const { fileXbeesClaim } = loadCore<XbeesSequence>(
    'platforms/xbees/claim-management/api-based-flow/fileClaim'
  )

  // The stored session already carries everything this login would
  // return, so a sign-in is only needed when it does not — see
  // common/claimContext in the core.
  const ctx = (credentials.context ??
    (await loginXbeesApi(
      { username, password: credentials.password, _id: credentials.credentialId },
      { session: { jar: credentials.jar } }
    )))

  // `vocab` caches the reason tree across a batch. One claim per call here, so
  // it starts empty each time; the extra fetch is one request.
  const filed = await withTempDir(dir => fileXbeesClaim(ctx, entry, awb, dir, {}))

  return {
    cmsId: claim.cmsId,
    ticketId: filed.ticketId,
    message: filed.alreadyExisted
      ? `Xbees dispute already existed (${filed.ticketId})`
      : `Xbees dispute raised (${filed.ticketId})`,
      // Passed through, not dropped: the runner read this off the existing
      // ticket at the marketplace, and it is the freshest statement of where
      // the claim actually stands.
      cmsStatus: filed.cmsStatus ?? null
  }
}
