import type { ProcessResult, QueuedClaim } from '@shared/types/claimQueue'
import { claimCredentials } from '@main/services/claimSession.service'
import { requireClaimConfig } from '@main/automations/common/claimConfig'
import { loadCore } from '@main/automations/common/coreLoader'
import type { ClaimDocument, FiledClaim } from '@main/automations/common/types'
import { requireClaimAccount } from '@main/automations/common/claimAccount'
import { storedSession } from '@main/services/sessionReuse.service'
import { publishSession } from '@main/services/platformSession.service'
import { logger } from '@main/services/logger'

/**
 * Files one Nykaa claim from this machine.
 *
 * `fileNykaaClaim` in @trackvid/automation-core is the same function the
 * Automated-Scripts server calls. Nykaa takes evidence as a URL in the ticket
 * body rather than as uploads, so unlike the other platforms there is no temp
 * directory to manage here.
 */

interface NykaaSession {
  jar: Record<string, string>
  portalId: string
  userId: string | null
  /** False when this call actually signed in, so the result is worth storing. */
  reused?: boolean
}

interface NykaaCore {
  loginNykaaApi: (
    credentials: { username: string; password?: string; _id?: string | undefined },
    opts?: {
      session?: { jar: Record<string, string>; portalId?: string; userId?: string | null }
    }
  ) => Promise<NykaaSession>
}

interface NykaaSequence {
  fileNykaaClaim: (ctx: unknown, configEntry: ClaimDocument, awbNumber: string) => Promise<FiledClaim>
}

/**
 * Ships the session this run signed in with, so the next claim skips the login.
 *
 * `portalId` goes with it deliberately: without it the core's claim context
 * refuses to rebuild — `common/claimContext` lists it as required — and the
 * stored session is unusable even though its jar is fine. That was the
 * "the stored session is missing portalId" line before every Nykaa sign-in.
 *
 * The core hands back a `{ name: value }` jar; `publishSession` wants cookies,
 * and reshapes them per platform on the way out. The domain is the portal's
 * because that is the origin the jar is replayed against.
 *
 * Best-effort: a session that could not be saved costs the next claim a login.
 * Failing THIS claim over it would cost the dispute.
 */
const keepSession = async (username: string, session: NykaaSession): Promise<void> => {
  try {
    const jar = Object.entries(session.jar).map(([name, value]) => ({
      name,
      value,
      domain: 'dispute.nykaa.com'
    }))

    if (jar.length === 0) return

    const saved = await publishSession('nykaa', username, jar, {
      portalId: session.portalId,
      userId: session.userId
    })

    if (saved.success) {
      logger.info(`[nykaa-claim] saved the session for ${username} (${jar.length} cookies)`)
    } else {
      logger.warn(`[nykaa-claim] could not save the session: ${saved.error.message}`)
    }
  } catch (error) {
    logger.warn(
      `[nykaa-claim] could not save the session: ` +
        (error instanceof Error ? error.message : String(error))
    )
  }
}

/**
 * The claim context for one Nykaa login — the stored session when it can stand
 * in for a sign-in, otherwise a sign-in whose session is kept for next time.
 *
 * Shared by the single claim below and the DDR bulk claim, so both reuse and
 * renew a Nykaa session by the same rules. Throws when this work may not sign
 * in and the stored session cannot be used (`claimCredentials`).
 */
export const openNykaaClaimContext = async (username: string): Promise<unknown> => {
  const credentials = await claimCredentials('nykaa', username)

  const { loginNykaaApi } = loadCore<NykaaCore>(
    'platforms/nykaa/claim-management/api-based-flow/claimApiFlow'
  )

  // The stored session already carries everything this login would return, so a
  // sign-in is only needed when it does not — see common/claimContext in the
  // core. `context` is null when the record is missing `portalId`, which is why
  // the whole record goes to the core below rather than just the jar: the core
  // re-checks it, and can still reuse a jar this app could not fully describe.
  let ctx = credentials.context

  if (!ctx) {
    const stored = (await storedSession('nykaa', username)) as NykaaSession | null

    const signedIn = await loginNykaaApi(
      { username, password: credentials.password, _id: credentials.credentialId },
      {
        session: {
          jar: stored?.jar ?? credentials.jar,
          ...(stored?.portalId ? { portalId: stored.portalId } : {}),
          ...(stored?.userId ? { userId: stored.userId } : {})
        }
      }
    )

    ctx = signedIn

    // KEEP a session this run just minted, so the next claim skips the login.
    //
    // Without this every Nykaa claim opens Chrome and signs in again, and the
    // stored session only ever gets older — a queue of ten claims meant ten
    // Zoho sign-ins. AJIO's runner already does this; Nykaa never did, which is
    // the whole reason a browser opened on every single claim.
    if (signedIn.reused === false) await keepSession(username, signedIn)
  }

  return ctx
}

export const runNykaaClaim = async (
  claim: QueuedClaim,
  doc: ClaimDocument
): Promise<ProcessResult> => {
  const username = await requireClaimAccount('nykaa', doc)

  const awb = doc.AWBNumber ?? claim.awbNumber

  if (!awb) throw new Error('The claim has no AWB number')

  // What the sequence actually reads — see claimConfig.
  const entry = requireClaimConfig('nykaa', doc)
  const ctx = await openNykaaClaimContext(username)

  const { fileNykaaClaim } = loadCore<NykaaSequence>(
    'platforms/nykaa/claim-management/api-based-flow/fileClaim'
  )

  const filed = await fileNykaaClaim(ctx, entry, awb)

  return {
    cmsId: claim.cmsId,
    ticketId: filed.ticketId,
    message: filed.alreadyExisted
      ? `Nykaa ticket already existed (#${filed.ticketId})`
      : `Nykaa ticket raised (#${filed.ticketId})`,
      // Passed through, not dropped: the runner read this off the existing
      // ticket at the marketplace, and it is the freshest statement of where
      // the claim actually stands.
      cmsStatus: filed.cmsStatus ?? null
  }
}
