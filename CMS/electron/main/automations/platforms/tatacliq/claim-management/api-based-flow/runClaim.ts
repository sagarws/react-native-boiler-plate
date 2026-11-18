import type { ProcessResult, QueuedClaim } from '@shared/types/claimQueue'
import type { ClaimDocument } from '@main/automations/common/types'
import { requireClaimAccount } from '@main/automations/common/claimAccount'
import { requireClaimConfig } from '@main/automations/common/claimConfig'
import { claimCredentials } from '@main/services/claimSession.service'
import { credentialFor } from '@main/services/company.service'
import { loadCore } from '@main/automations/common/coreLoader'
import {
  openSignedInTataCliqPage,
  type PuppeteerPage,
  type TataCliqSlave
} from '@main/automations/platforms/tatacliq/common/signedInPage'
import { logger } from '@main/services/logger'
import { discardLease, leasedSession } from '@main/services/browserLease.service'

/**
 * Files one Tata CliQ claim from this machine.
 *
 * Shaped like the AJIO runner rather than the other five, because Tata CliQ has
 * AJIO's constraint: every call goes through a LOGGED-IN BROWSER PAGE. The
 * portal is behind Cloudflare, and the slave pick is server-side session state,
 * so `fileTataCliqClaim` takes a Puppeteer page and fetches from inside it.
 *
 * The sequence itself is the core's `fileTataCliqClaim` — slave → find →
 * already-claimed guard → six uploads → submit — so the desktop and the server
 * file a Tata CliQ claim identically.
 *
 * WHAT IS DIFFERENT FROM EVERY OTHER PLATFORM: a return is visible only to the
 * SLAVE that owns it, and the portal will not search without one selected. So
 * the runner hands the core the credential's synced slave list — ordered
 * most-recently-useful first by `slavesOf` — and the core sweeps it until one
 * owns the return. A claim MAY name a slave, and then that one is used or the
 * claim is refused; it does not have to, because Tata CliQ has no master data
 * to say which warehouse a return belongs to. The same relationship AJIO has
 * between a claim and its POB, minus the master row that resolves it.
 */

type ClaimStatus = 'success' | 'already_claimed' | 'not_found' | 'not_claimable' | 'failed'

interface TataCliqClaimFlow {
  fileTataCliqClaim: (
    page: PuppeteerPage,
    input: {
      reverseAwb: string
      slaves: TataCliqSlave[]
      slaveName?: string
      reason: string
      subReason?: string
      /** Slot key -> URL. The core fetches them; see its `imageBytes`. */
      images?: Record<string, string>
      packagingVideoUrl?: string
      unboxingVideoUrl?: string
      comment?: string
    },
    options?: { logger?: unknown }
  ) => Promise<{
    status: ClaimStatus
    ticketId: string | null
    transId: string | null
    forwardAwb: string | null
    message: string
  }>
}

/**
 * What the claim config calls the things this runner needs.
 *
 * Built by TrackVid-BE's `getPlatformConfig` — the same builder the server uses
 * — so the field names here are its names, not this app's. `qcImages` is a slot
 * key -> URL map rather than a list, because the portal's six uploads are
 * positional and a reviewer opens each expecting a particular thing.
 */
interface TataCliqClaimEntry extends ClaimDocument {
  awbNumber?: string
  AWBNumber?: string
  reverseAwb?: string
  slaveName?: string
  qcReason?: string
  qcSubReason?: string
  qcImages?: Record<string, string>
  packagingVideoUrl?: string
  unboxingVideoUrl?: string
  comment?: string
}

export const runTataCliqClaim = async (
  claim: QueuedClaim,
  doc: ClaimDocument
): Promise<ProcessResult> => {
  const username = await requireClaimAccount('tatacliq', doc)
  const entry = requireClaimConfig('tatacliq', doc) as TataCliqClaimEntry
  const credentials = await claimCredentials('tatacliq', username)

  // `reverseAwb` first: the config names it explicitly because Tata CliQ's
  // search is by REVERSE awb, and a forward AWB in that field finds nothing.
  const reverseAwb =
    entry.reverseAwb ?? entry.awbNumber ?? entry.AWBNumber ?? doc.AWBNumber ?? claim.awbNumber

  if (!reverseAwb) throw new Error('The claim has no return AWB')

  if (!entry.qcReason) {
    // Refused here rather than at the portal: the reason decides what the claim
    // needs (a sub-reason, videos), so a row without one cannot be filed and
    // the operator should be told that, not shown a portal error.
    throw new Error(
      'This Tata CliQ claim has no QC failure reason. Set one on the claim before filing.'
    )
  }

  // The slave list comes from the credential, not from the portal: it is what
  // Sync slaves wrote, and re-reading it per claim would mean a sweep per row.
  // `openSignedInTataCliqPage` also returns a live list — used below as the
  // fallback for a credential nobody has synced yet, so a first claim still
  // has something to search under.
  const credential = await credentialFor('tatacliq', username)
  const stored = (credential?.slaves ?? []) as TataCliqSlave[]

  const flow = loadCore<TataCliqClaimFlow>(
    'platforms/tatacliq/claim-management/api-based-flow/fileClaim'
  )

  const {
    page,
    context,
    reused: leased,
    release
  } = await leasedSession(`tatacliq:${username}`, async () => {
    const opened = await openSignedInTataCliqPage({
    username,
    password: credentials.password,
    // Never mid-run: a Tata CliQ sign-in costs an emailed code, and this is
    // unattended. A session that will not serve fails the row instead.
    allowSignIn: false
  })

    return {
      browser: opened.browser,
      page: opened.page,
      context: { slaves: opened.slaves }
    }
  })

  if (leased) logger.info(`[tatacliq-claim] reusing the open browser for ${username}`)

  try {
    const result = await flow.fileTataCliqClaim(
      page as PuppeteerPage,
      {
        reverseAwb,
        slaves: stored.length > 0 ? stored : context.slaves,
        ...(entry.slaveName ? { slaveName: entry.slaveName } : {}),
        reason: entry.qcReason,
        ...(entry.qcSubReason ? { subReason: entry.qcSubReason } : {}),
        ...(entry.qcImages ? { images: entry.qcImages } : {}),
        ...(entry.packagingVideoUrl ? { packagingVideoUrl: entry.packagingVideoUrl } : {}),
        ...(entry.unboxingVideoUrl ? { unboxingVideoUrl: entry.unboxingVideoUrl } : {}),
        ...(entry.comment ? { comment: entry.comment } : {})
      },
      { logger }
    )

    // A plain `failed` is the one outcome that does not say why, and a session
    // that has quietly expired looks exactly like it. Drop the browser so the
    // next claim starts clean. `not_found` and `not_claimable` are answers
    // ABOUT the return, from a session that plainly works — those keep it,
    // which matters more here than anywhere else: re-opening costs an OTP.
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
 * Maps Tata CliQ's status vocabulary onto this app's result.
 *
 * `fileTataCliqClaim` never throws — it reports every outcome as a status — so
 * this is where a real failure has to become one again. Returning a
 * ProcessResult for `failed` would record a claim that was never filed as filed.
 */
export const toProcessResult = (
  claim: QueuedClaim,
  result: {
    status: ClaimStatus
    ticketId: string | null
    transId: string | null
    forwardAwb: string | null
    message: string
  }
): ProcessResult => {
  switch (result.status) {
    case 'success':
      return {
        cmsId: claim.cmsId,
        ticketId: result.ticketId,
        message: result.message,
        cmsStatus: null
      }

    // The ticket exists at Tata CliQ. Recording it is the whole point — a retry
    // that did not know would raise a second claim for the same return.
    case 'already_claimed':
      return {
        cmsId: claim.cmsId,
        ticketId: result.ticketId,
        message: result.message,
        cmsStatus: null
      }

    // Answers about the return, not failures of the run. Both are terminal:
    // the portal will say the same thing on a retry, so the row should stop
    // spending attempts on it.
    case 'not_found':
    case 'not_claimable': {
      const error = new Error(result.message) as Error & { terminal?: boolean }

      error.terminal = true

      throw error
    }

    default:
      throw new Error(result.message || 'Tata CliQ claim failed')
  }
}
