import type { ProcessResult, QueuedClaim } from '@shared/types/claimQueue'
import { claimCredentials } from '@main/services/claimSession.service'
import { requireClaimConfig } from '@main/automations/common/claimConfig'
import { loadCore } from '@main/automations/common/coreLoader'
import { withTempDir } from '@main/automations/common/tempDir'
import type { ClaimDocument, FiledClaim } from '@main/automations/common/types'
import { requireClaimAccount } from '@main/automations/common/claimAccount'

/**
 * Files one Snapdeal claim from this machine.
 *
 * The sequence itself — resolve the AWB, refuse to re-file a dispute that
 * already exists, upload the evidence, submit, read back the case id — is
 * `fileSnapdealClaim` in @trackvid/automation-core, the same function the
 * Automated-Scripts server calls. This file supplies only what is different
 * here: a locally captured session instead of a database one, and no
 * report-share mirror.
 *
 * Nothing about the sequence may be reimplemented here. An earlier version of
 * this file did exactly that and drifted: it skipped the already-disputed
 * guard, so a claim the marketplace had already accepted would have been filed
 * a second time.
 */

interface SnapdealCore {
  loginSnapdealApi: (
    credentials: { username: string; password?: string; _id?: string | undefined },
    opts?: { session?: { jar: Record<string, string> } }
  ) => Promise<unknown>
}

interface SnapdealSequence {
  fileSnapdealClaim: (
    ctx: unknown,
    configEntry: ClaimDocument,
    awbNumber: string,
    tempDir: string,
    vocab: { issueCategories: unknown[] },
    credentialUsername: string,
    options?: { perClaimFiles?: string[] }
  ) => Promise<FiledClaim>
}

export const runSnapdealClaim = async (
  claim: QueuedClaim,
  doc: ClaimDocument
): Promise<ProcessResult> => {
  const username = await requireClaimAccount('snapdeal', doc)

  const awb = doc.AWBNumber ?? claim.awbNumber

  if (!awb) throw new Error('The claim has no AWB number')

  const credentials = await claimCredentials('snapdeal', username)
  // What the sequence actually reads — see claimConfig.
  const entry = requireClaimConfig('snapdeal', doc)

  const { loginSnapdealApi } = loadCore<SnapdealCore>(
    'platforms/snapdeal/claim-management/api-based-flow/claimApiFlow'
  )
  const { fileSnapdealClaim } = loadCore<SnapdealSequence>(
    'platforms/snapdeal/claim-management/api-based-flow/fileClaim'
  )

  // The captured jar is passed in, so the flow never reaches for the database
  // session store this app has no access to.
  // The stored session already carries everything this login would
  // return, so a sign-in is only needed when it does not — see
  // common/claimContext in the core.
  const ctx = (credentials.context ??
    (await loginSnapdealApi(
      { username, password: credentials.password, _id: credentials.credentialId },
      { session: { jar: credentials.jar } }
    )))

  const filed = await withTempDir(dir =>
    // `vocab` caches the issue-category list across a batch. One claim per call
    // here, so it starts empty each time; the extra fetch is one request.
    fileSnapdealClaim(ctx, entry, awb, dir, { issueCategories: [] }, username)
  )

  return {
    cmsId: claim.cmsId,
    ticketId: filed.ticketId,
    message: filed.alreadyExisted
      ? `Snapdeal dispute already existed (${filed.ticketId})`
      : `Snapdeal dispute raised (${filed.ticketId})`
  }
}
