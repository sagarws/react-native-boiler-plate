import type { ProcessResult, QueuedClaim } from '@shared/types/claimQueue'
import { claimCredentials } from '@main/services/claimSession.service'
import { requireClaimConfig } from '@main/automations/common/claimConfig'
import { loadCore } from '@main/automations/common/coreLoader'
import { withTempDir } from '@main/automations/common/tempDir'
import type { ClaimDocument } from '@main/automations/common/types'
import { requireClaimAccount } from '@main/automations/common/claimAccount'

/**
 * Files one Myntra claim from this machine.
 *
 * `fileMyntraClaim` in @trackvid/automation-core is the same function the
 * Automated-Scripts server calls. Myntra's flow takes the cookie jar directly
 * rather than a login context object.
 */

interface MyntraCore {
  loginMyntraApi: (
    credentials: { username: string; password?: string; _id?: string | undefined },
    opts?: { session?: { jar: Record<string, string> } }
  ) => Promise<Record<string, string>>
}

interface MyntraSequence {
  fileMyntraClaim: (
    jar: unknown,
    configEntry: ClaimDocument,
    awbNumber: string,
    tempDir: string,
    options?: { perClaimFiles?: string[] }
  ) => Promise<{ ticketId: string | null; alreadyExisted: boolean }>
}

export const runMyntraClaim = async (
  claim: QueuedClaim,
  doc: ClaimDocument
): Promise<ProcessResult> => {
  const username = await requireClaimAccount('myntra', doc)

  const awb = doc.AWBNumber ?? claim.awbNumber

  if (!awb) throw new Error('The claim has no AWB number')

  const credentials = await claimCredentials('myntra', username)
  // What the sequence actually reads — see claimConfig.
  const entry = requireClaimConfig('myntra', doc)

  const { loginMyntraApi } = loadCore<MyntraCore>(
    'platforms/myntra/claim-management/api-based-flow/claimApiFlow'
  )
  const { fileMyntraClaim } = loadCore<MyntraSequence>(
    'platforms/myntra/claim-management/api-based-flow/fileClaim'
  )

  // The stored session already carries everything this login would
  // return, so a sign-in is only needed when it does not — see
  // common/claimContext in the core.
  const jar = (credentials.context ??
    (await loginMyntraApi(
      { username, password: credentials.password, _id: credentials.credentialId },
      { session: { jar: credentials.jar } }
    ))) as Awaited<ReturnType<typeof loginMyntraApi>>

  const filed = await withTempDir(dir => fileMyntraClaim(jar, entry, awb, dir))

  if (!filed.ticketId) {
    throw new Error('Myntra accepted the claim but returned no ticket id; verify manually')
  }

  return {
    cmsId: claim.cmsId,
    ticketId: filed.ticketId,
    message: filed.alreadyExisted
      ? `Myntra claim already existed (${filed.ticketId})`
      : `Myntra claim raised (${filed.ticketId})`
  }
}
