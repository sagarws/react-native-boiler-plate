import { loadCore } from '@main/automations/common/coreLoader'
import type { ClaimDocument } from '@main/automations/common/types'
import { credentialsFor } from '@main/services/company.service'
import { logger } from '@main/services/logger'

/**
 * The seller account a claim should be filed from.
 *
 * Every runner used to read `doc.account?.username` — a field
 * `/cms/find-by-awb` has never returned. Each platform keeps its account
 * somewhere different (`ajio_account_email`, `myntraClaimDetails.username`,
 * `otherClaimDetails.username`…), and the mapping lives in the core because
 * TrackVid-BE groups rows by exactly those fields before handing them to the
 * server's runners. One map, shared, rather than seven copies here.
 */

interface ClaimAccount {
  claimAccountUsername: (platform: string, doc: unknown) => string | null
  usesCompanyWideAccount: (platform: string) => boolean
  ACCOUNT_FIELDS: Record<string, string[]>
}

const core = (): ClaimAccount => loadCore<ClaimAccount>('common/claimAccount')

/**
 * The account the ROW itself names, or `''`.
 *
 * No fallbacks and no guessing — only what somebody put on the claim. The
 * processor needs that question answered on its own before it decides whether
 * to go and ask the marketplace, which is a different question from
 * `requireClaimAccount`'s "what should this be filed under".
 */
export const claimAccountUsername = (platform: string, doc: ClaimDocument): string =>
  core().claimAccountUsername(platform, doc)?.trim() ?? ''

/**
 * Platforms where the company's single login owns every ticket — Nykaa.
 *
 * A row there carries no account by design, so "this claim names nobody" is not
 * a blank to go and fill in.
 */
export const companyWideAccount = (platform: string): boolean =>
  core().usesCompanyWideAccount(platform)

/**
 * @throws when the claim names no account and the platform needs one — that is
 *   a row an operator has to fix, not something a runner can guess at.
 */
export const requireClaimAccount = async (
  platform: string,
  doc: ClaimDocument
): Promise<string> => {
  const { claimAccountUsername } = core()
  const username = claimAccountUsername(platform, doc)

  if (username) return username

  // Nothing on the row. Fall back to the company's own credentials.
  //
  // The operator picks the account on the create form, and the row is supposed
  // to carry it — but that has been lost more than once between the form and
  // the database, and a claim failing because a field went missing upstream is
  // not something the person filing it can act on.
  //
  // ONE credential means there is no ambiguity: every claim on this platform
  // runs under it, which is exactly what the create form's own dropdown does
  // when it auto-selects a sole account. Nykaa has always worked this way —
  // it carries no per-row account at all.
  const credentials = await credentialsFor(platform)

  if (credentials.length === 1 && credentials[0]?.username) {
    logger.warn(
      `[claim-account] ${platform} claim names no account — using the company's only ` +
        `${platform} credential (${credentials[0].username})`
    )

    return credentials[0].username
  }

  // More than one, and guessing would file a dispute from the wrong seller
  // account — worse than stopping.
  if (credentials.length > 1) {
    throw new Error(
      `This ${platform} claim names no account, and the company has ${credentials.length} ` +
        `${platform} logins — set the account on the row so the right one is used`
    )
  }

  throw new Error(
    `This ${platform} claim names no account, and no ${platform} login is configured for the company`
  )
}

/**
 * Writes a resolved account onto the claim document in memory.
 *
 * WHY THIS EXISTS. When a row arrives with no account, the processor asks the
 * marketplace which login holds the AWB and records the answer on the server.
 * The RUNNER, a moment later, reads the account off the document it was handed
 * — which was fetched before any of that happened, and still says nothing. So
 * a claim whose account had just been found failed with "names no account",
 * which is the one message that could not have been true.
 *
 * Stamped at the platform's own field, from the same map every runner reads
 * through, so the runner finds it exactly where it would have found an account
 * the operator set.
 */
export const stampClaimAccount = (
  platform: string,
  doc: ClaimDocument,
  username: string
): void => {
  const { ACCOUNT_FIELDS, claimAccountUsername } = core()
  const { platformKey } = loadCore<{ platformKey: (value: string) => string }>('common/platforms')
  const [field] = ACCOUNT_FIELDS[platformKey(platform)] ?? []

  if (!field || !username) return
  // Already there — nothing to stamp, and overwriting would be a different
  // decision than the one this function is for.
  if (claimAccountUsername(platform, doc)) return

  const path = field.split('.')
  const leaf = path.pop() as string
  let target = doc as Record<string, unknown>

  for (const step of path) {
    if (!target[step] || typeof target[step] !== 'object') target[step] = {}

    target = target[step] as Record<string, unknown>
  }

  target[leaf] = username
}
