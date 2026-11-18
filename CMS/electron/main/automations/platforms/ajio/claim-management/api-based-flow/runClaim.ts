import type { ProcessResult, QueuedClaim } from '@shared/types/claimQueue'
import type { ClaimDocument } from '@main/automations/common/types'
import { requireClaimAccount } from '@main/automations/common/claimAccount'
import { requireClaimConfig } from '@main/automations/common/claimConfig'
import { claimCredentials } from '@main/services/claimSession.service'
import { loadCore } from '@main/automations/common/coreLoader'
import {
  openSignedInAjioPage,
  type PuppeteerPage
} from '@main/automations/platforms/ajio/common/signedInPage'
import { logger } from '@main/services/logger'
import { discardLease, leasedSession } from '@main/services/browserLease.service'

/**
 * Files one AJIO claim from this machine.
 *
 * AJIO is the odd one out among the seven, in the same way its master import
 * is: every call goes through a LOGGED-IN BROWSER PAGE rather than an HTTP
 * client. Akamai wants the browser's own HttpOnly `bff_session` and its real
 * TLS fingerprint, so `raiseClaim` takes a Puppeteer page and fetches from
 * inside it. That is why this runner owns a browser and the other six do not.
 *
 * The claim sequence itself is the core's `raiseClaim` — the same one the
 * automation server drives — so the desktop and the server file an AJIO claim
 * identically.
 */

/** Never throws — every outcome comes back as a status. */
type ClaimStatus =
  | 'success'
  | 'already_raised'
  | 'not_found'
  | 'not_claimable'
  | 'dry_run'
  | 'auth_expired'
  | 'failed'

interface AjioClaimFlow {
  raiseClaim: (
    page: PuppeteerPage,
    input: {
      sellerId: string
      configEntry: unknown
      credentials: { username: string; password: string; accountType?: string }
      userLogger?: unknown
    }
  ) => Promise<{ status: ClaimStatus; ticketId?: string; finalStatus?: string; message?: string }>
}

export const runAjioClaim = async (
  claim: QueuedClaim,
  doc: ClaimDocument
): Promise<ProcessResult> => {
  const username = await requireClaimAccount('ajio', doc)
  const entry = requireClaimConfig('ajio', doc)
  const credentials = await claimCredentials('ajio', username)

  const flow = loadCore<AjioClaimFlow>(
    'platforms/ajio/claim-management/api-based-flow/updatedClaimApiFlow'
  )

  const { page, context, reused: leased, release } = await leasedSession(
    `ajio:${username}`,
    async () => {
      const opened = await openSignedInAjioPage({ username, password: credentials.password })

      return {
        browser: opened.browser,
        page: opened.page,
        context: { sellerId: opened.sellerId }
      }
    }
  )

  if (leased) logger.info(`[ajio-claim] reusing the open browser for ${username}`)

  try {
    const result = await flow.raiseClaim(page as PuppeteerPage, {
      sellerId: context.sellerId,
      configEntry: entry,
      credentials: { username, password: credentials.password },
      userLogger: logger
    })

    // A plain `failed` is the one outcome that does not say why, and a session
    // that has quietly expired looks exactly like it. Drop the browser so the
    // next claim starts clean rather than inheriting a page that may be signed
    // out. `not_found` and `not_claimable` are answers ABOUT the return, from a
    // session that plainly works — those keep it.
    if (result.status === 'failed') await discardLease()

    return toProcessResult(claim, result)
  } catch (error) {
    await discardLease()

    throw error
  } finally {
    // A no-op while a drain holds the lease; a real close when it does not.
    await release()
  }
}

/**
 * Maps AJIO's status vocabulary onto this app's result.
 *
 * `raiseClaim` never throws — it reports every outcome as a status — so the
 * mapping is where a real failure has to be turned back into one. Returning a
 * ProcessResult for `failed` would record a claim that was never filed as
 * filed.
 */
export const toProcessResult = (
  claim: QueuedClaim,
  result: { status: ClaimStatus; ticketId?: string; finalStatus?: string; message?: string }
): ProcessResult => {
  const ticketId = result.ticketId ?? null

  switch (result.status) {
    case 'success':
      return {
        cmsId: claim.cmsId,
        ticketId,
        message: result.message ?? `AJIO claim raised (${ticketId ?? 'no ticket id'})`
      }

    // The ticket exists at AJIO. Recording it is the whole point — a retry that
    // did not know would raise a second claim for the same return.
    case 'already_raised':
      return {
        cmsId: claim.cmsId,
        ticketId,
        message: result.message ?? `AJIO claim already existed (${ticketId ?? 'no ticket id'})`
      }

    // The session died mid-claim. Tagged so the processor renews and retries
    // once, which is what every other platform's flow gets from `authError` —
    // AJIO could not say it before, because this flow reports statuses instead
    // of throwing.
    case 'auth_expired': {
      const error = new Error(result.message ?? 'AJIO rejected the login') as Error & {
        code?: string
        ticketId?: string
      }

      error.code = 'AUTH_EXPIRED'

      // The attachment path reaches here holding a ticket. Naming it keeps the
      // retry able to finish that ticket rather than raising a second one.
      if (ticketId) error.ticketId = ticketId

      throw error
    }

    // DISABLE_SUBMIT. Thrown with the tagged code so the claim processor treats
    // it as a dry run and leaves the row claimable, exactly as the other six do.
    case 'dry_run': {
      const error = new Error(
        result.message ?? 'CLAIM_SUBMIT_DISABLED: AJIO claim submit was skipped, no claim was filed'
      ) as Error & { code?: string }

      error.code = 'CLAIM_SUBMIT_DISABLED'

      throw error
    }

    // Not a bug and not retryable: the return is not under this POB, or AJIO
    // holds no detail for it. Said plainly so nobody re-queues it forever.
    case 'not_found':
    case 'not_claimable':
      throw new Error(result.message ?? `AJIO reported this claim as ${result.status}`)

    default: {
      // A ticket with a failed attachment comes back here WITH an id. Naming it
      // is what lets a temp_ticket retry finish the job instead of filing again.
      const detail = ticketId ? ` (ticket ${ticketId} was created)` : ''

      throw new Error(`${result.message ?? 'AJIO claim failed'}${detail}`)
    }
  }
}
