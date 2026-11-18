import type { TatCheckProgress, TatCheckSummary, TatRowResult } from '@shared/types/tatCheck'
import { CLAIM_TAT_EVENTS } from '@shared/constants/channels'
import { fail, ok, type Result } from '@shared/types/result'
import type { ClaimDocument } from '@main/automations/common/types'
import { requireClaimAccount } from '@main/automations/common/claimAccount'
import { tatChecker } from '@main/automations/registry'
import { loadCore } from '@main/automations/common/coreLoader'
import { prepareCoreWithBrowser } from '@main/automations/common/prepareCore'
import { apiRequest } from './httpClient'
import { getAccessToken } from './session.store'
import { reportClaimStatus } from './claimLiveness.service'
import { logger } from './logger'
import { broadcast } from '../ipc/broadcast'

/**
 * "Check TAT" — does the marketplace still accept a claim for these rows?
 *
 * A claim past its window is not a claim that failed: it is one that can never
 * be filed. Left alone it sits on Pending and spends its three attempts
 * discovering that, one long run at a time, with the real reason buried in a
 * submit error. This asks first, and files the dead ones away as Failed to
 * Proceed with "ME1: TAT expired" so the Pending tab means what it says.
 *
 * WHAT IT WRITES, AND ONLY THAT: an expired row is reported as a TERMINAL
 * failure through the same endpoint a desktop run uses, which is what moves it
 * to Failed to Proceed. Nothing is written for a row that is still claimable,
 * and nothing is written when the answer could not be established — a check
 * that could not run must never be the reason a claim is abandoned.
 */

/**
 * The words written onto an expired row.
 *
 * FROM THE CORE, not typed here. The claim flow meets the same refusal on
 * submit and writes the same line, and the column is matched on rather than
 * merely read — two copies that drift by a capital letter split one reason
 * into two.
 */
const { TAT_EXPIRED: RESULT_ERROR } = loadCore<{ TAT_EXPIRED: string }>('common/claimErrors')

interface CheckPayload {
  platform?: unknown
  claims?: unknown
}

interface RequestedClaim {
  cmsId: string
  awb: string
}

const requested = (payload: CheckPayload): RequestedClaim[] => {
  const raw = Array.isArray(payload?.claims) ? payload.claims : []

  return raw
    .map(entry => {
      const row = entry as { cmsId?: unknown; awb?: unknown }

      return {
        cmsId: typeof row.cmsId === 'string' ? row.cmsId : '',
        awb: typeof row.awb === 'string' ? row.awb : ''
      }
    })
    .filter(row => row.cmsId && row.awb)
}

/** The claim as TrackVid holds it — the same read the claim processor does. */
const claimDocument = async (awb: string, platform: string, token: string): Promise<ClaimDocument | null> => {
  const response = await apiRequest<ClaimDocument | null>('/cms/find-by-awb', {
    method: 'POST',
    token,
    body: { awb, platform }
  })

  if (!response.success) throw new Error(response.error.message)

  return response.data ?? null
}

export const checkClaimTat = async (payload: unknown): Promise<Result<TatCheckSummary>> => {
  const asked = (payload as CheckPayload)?.platform
  const platform = typeof asked === 'string' ? asked.trim() : ''
  const claims = requested(payload as CheckPayload)
  const token = getAccessToken()

  if (!platform) return fail('VALIDATION_ERROR', 'No platform was given')
  if (claims.length === 0) return fail('VALIDATION_ERROR', 'Select the claims to check first')
  if (!token) return fail('VALIDATION_ERROR', 'Sign in to check TAT')

  const checker = tatChecker(platform)

  if (!checker) {
    return fail('VALIDATION_ERROR', `${platform} does not publish a claim window that can be checked`)
  }

  // The core reads env, browser paths and session settings from whatever the
  // app published — same boundary every claim passes through, and the checker
  // signs in through the same core code.
  await prepareCoreWithBrowser(message => logger.info(`[tat-check] ${message}`), platform)

  const contexts = new Map<string, unknown>()
  const rows: TatRowResult[] = []

  const counted = (outcome: TatRowResult['outcome']): number =>
    rows.filter(row => row.outcome === outcome).length

  /** How many of the most recent answers the dialog lists while it runs. */
  const RECENT = 8

  const report = (current: string | null, finished = false): void => {
    const progress: TatCheckProgress = {
      platform,
      total: claims.length,
      done: rows.length,
      expired: counted('expired'),
      blocked: counted('blocked'),
      within: counted('within'),
      unknown: counted('unknown'),
      moved: rows.filter(row => row.movedToFailed).length,
      current,
      recent: [...rows].reverse().slice(0, RECENT),
      finished
    }

    broadcast(CLAIM_TAT_EVENTS.progress, progress)
  }

  // Before the first answer, so the dialog opens with the total rather than
  // with zeroes it has to explain.
  report(claims[0]?.awb ?? null)

  for (const claim of claims) {
    report(claim.awb)

    try {
      const doc = await claimDocument(claim.awb, platform, token)

      if (!doc) throw new Error(`No claim found for AWB ${claim.awb}`)

      const username = await requireClaimAccount(platform, doc)
      const verdict = await checker({ doc, awb: claim.awb, username, contexts })

      let movedToFailed = false
      /**
       * The code that lands in Script Error.
       *
       * The window has one answer everywhere, so it is the default; anything
       * else the checker files away names its own — today "ME2: Invalid sub
       * order number.", which Refill Data can repair. Filing that under the
       * window's code would hide a fixable row behind a permanent one.
       */
      const error = verdict.error ?? RESULT_ERROR
      const filedAway = verdict.outcome === 'expired' || verdict.outcome === 'blocked'

      if (filedAway) {
        // Terminal, deliberately: three more attempts would each end in the
        // same refusal. `reportClaimStatus` is the desktop's own status write —
        // the backend moves a Pending row to Failed to Proceed when it sees a
        // terminal failure, and stamps the script error operators read.
        await reportClaimStatus(claim.cmsId, 'Failed', { error, terminal: true })
        movedToFailed = true
        logger.info(`[tat-check] ${claim.awb}: ${error} — ${verdict.message ?? 'no detail'}`)
      }

      rows.push({
        cmsId: claim.cmsId,
        awb: claim.awb,
        outcome: verdict.outcome,
        message: verdict.message,
        error: filedAway ? error : null,
        movedToFailed
      })
    } catch (error) {
      // One unreadable claim must not end the sweep, and it must not be filed
      // away either: "could not ask" is not "expired".
      const message = error instanceof Error ? error.message : String(error)

      logger.warn(`[tat-check] ${claim.awb}: ${message}`)
      rows.push({ cmsId: claim.cmsId, awb: claim.awb, outcome: 'unknown', message, movedToFailed: false })
    }
  }

  report(null, true)

  return ok({
    checked: rows.length,
    expired: counted('expired'),
    blocked: counted('blocked'),
    within: counted('within'),
    unknown: counted('unknown'),
    moved: rows.filter(row => row.movedToFailed).length,
    rows
  })
}
