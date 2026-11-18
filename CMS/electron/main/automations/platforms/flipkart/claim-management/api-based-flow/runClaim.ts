import type { ProcessResult, QueuedClaim } from '@shared/types/claimQueue'
import { claimCredentials } from '@main/services/claimSession.service'
import { requireClaimConfig } from '@main/automations/common/claimConfig'
import { loadCore } from '@main/automations/common/coreLoader'
import { withTempDir } from '@main/automations/common/tempDir'
import type { ClaimDocument, FiledClaim } from '@main/automations/common/types'
import { requireClaimAccount } from '@main/automations/common/claimAccount'

/**
 * Files one Flipkart claim from this machine.
 *
 * `fileFlipkartClaim` in @trackvid/automation-core is the same function the
 * Automated-Scripts server calls.
 *
 * Flipkart returns the claim id as `claimId` rather than `ticketId`, and it
 * comes back null from the submit itself — the core reads it off the Processing
 * tab afterwards, exactly as the portal UI does.
 */

interface FlipkartCore {
  loginFlipkartApi: (
    credentials: { username: string; password?: string; _id?: string | undefined },
    opts?: { session?: { jar: Record<string, string> } }
  ) => Promise<unknown>
  getProductTypes: (ctx: unknown) => Promise<unknown[]>
}

interface FlipkartVocabulary {
  productTypes: unknown[]
  issueTypesByProduct: Record<string, unknown[]>
}

interface FlipkartSequence {
  fileFlipkartClaim: (
    ctx: unknown,
    configEntry: ClaimDocument,
    awbNumber: string,
    tempDir: string,
    vocab: FlipkartVocabulary,
    credentialUsername: string,
    options?: { perClaimFiles?: string[] }
  ) => Promise<FiledClaim & { claimId: string }>
}

export const runFlipkartClaim = async (
  claim: QueuedClaim,
  doc: ClaimDocument
): Promise<ProcessResult> => {
  const username = await requireClaimAccount('flipkart', doc)

  const awb = doc.AWBNumber ?? claim.awbNumber

  if (!awb) throw new Error('The claim has no AWB number')

  const credentials = await claimCredentials('flipkart', username)
  // What the sequence actually reads — see claimConfig.
  const entry = requireClaimConfig('flipkart', doc)

  const { loginFlipkartApi, getProductTypes } = loadCore<FlipkartCore>(
    'platforms/flipkart/claim-management/api-based-flow/claimApiFlow'
  )
  const { fileFlipkartClaim } = loadCore<FlipkartSequence>(
    'platforms/flipkart/claim-management/api-based-flow/fileClaim'
  )

  // The stored session already carries everything this login would
  // return, so a sign-in is only needed when it does not — see
  // common/claimContext in the core.
  const ctx = (credentials.context ??
    (await loginFlipkartApi(
      { username, password: credentials.password, _id: credentials.credentialId },
      { session: { jar: credentials.jar } }
    )))

  // The product-type list is fetched once and validated against, the same way
  // the server primes it before its batch. Issue types are fetched lazily by
  // the sequence, per product type.
  const vocab: FlipkartVocabulary = {
    productTypes: await getProductTypes(ctx),
    issueTypesByProduct: {}
  }

  const filed = await withTempDir(dir =>
    fileFlipkartClaim(ctx, entry, awb, dir, vocab, username)
  )

  return {
    cmsId: claim.cmsId,
    ticketId: filed.claimId,
    message: filed.alreadyExisted
      ? `Flipkart claim already existed (${filed.claimId})`
      : `Flipkart claim raised (${filed.claimId})`
  }
}
