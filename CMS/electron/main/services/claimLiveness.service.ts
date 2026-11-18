import type { QueuedClaim } from '@shared/types/claimQueue'
import { listClaims, setStatus, touchRun } from './claimQueue.service'
import { apiRequest } from './httpClient'
import { getAccessToken } from './session.store'
import { logger } from './logger'

/**
 * Liveness for claims filed on this machine — kept HERE, not on the server.
 *
 * The automation server's model is a 30-second POST per running job plus a
 * per-minute watchdog cron reading every RUNNING row. That load is what this
 * app exists to remove, and its endpoints are unusable from here anyway: they
 * authenticate with an internal server secret and key off a ScriptJob id the
 * desktop is never given.
 *
 * So the ticking is local and costs the server nothing, and the server hears
 * only about TRANSITIONS — three calls for a claim rather than forty for a
 * twenty-minute one.
 *
 * WHY RECOVERY IS BETTER HERE THAN A TIMEOUT COULD BE:
 *
 * The app holds `app.requestSingleInstanceLock()`, so a second copy cannot be
 * working a claim behind this one's back. That makes the rule exact rather than
 * statistical: **in a fresh process, every claim still marked `running` is
 * orphaned** — its owner is gone by definition. No threshold to tune, no window
 * in which a slow claim is wrongly declared dead, and none in which a dead one
 * is still believed alive.
 *
 * `lastBeatAt` exists for the operator's benefit, not for this decision.
 */

/** How the server names these states. Must match CMS_SCRIPT_STATUS in the BE. */
export type ScriptStatus = 'Running' | 'Success' | 'Failed' | 'Help Center Failed' | 'Not Started'

const BEAT_INTERVAL_MS = 30_000

/** Live tickers, by cmsId. Cleared when a run ends however it ends. */
const beating = new Map<string, NodeJS.Timeout>()

/**
 * Tells the backend where a claim stands.
 *
 * Best-effort by design: this app already holds the authoritative local record,
 * and failing a filed claim because a status line did not send would be trading
 * something that matters for something that does not. The hourly BE sweep is
 * the backstop for a report that never lands.
 */
export const reportClaimStatus = async (
  cmsId: string,
  status: ScriptStatus,
  extra: { ticketNumber?: string; error?: string; terminal?: boolean; skipped?: boolean } = {}
): Promise<void> => {
  const token = getAccessToken()

  if (!token) {
    // WAS A SILENT `return`. A session that expired mid-claim meant the outcome
    // was never sent and nothing anywhere said so: the row stayed on Running,
    // the log was empty, and the only evidence was a claim that never moved.
    // Still not fatal — the local record is authoritative and the claim is
    // filed or not regardless — but it must leave a trace.
    logger.error(
      `[claim-liveness] cannot report ${cmsId} as ${status}: not signed in. The row will sit on ` +
        'its last reported status until the backend sweep resets it.'
    )

    return
  }

  const sent = await apiRequest<unknown>('/cms/desktop-claim-status', {
    method: 'POST',
    token,
    body: {
      cmsId,
      status,
      ...(extra.ticketNumber ? { ticketNumber: extra.ticketNumber } : {}),
      ...(extra.error ? { error: extra.error } : {}),
      // "This can never work" — the backend moves the row to Failed to Proceed
      // straight away rather than waiting for the retry cap.
      ...(extra.terminal ? { terminal: true } : {}),
      // "This was never tried" — the backend writes the reason and charges no
      // attempt. Honoured only on `Not Started`; see the BE controller.
      ...(extra.skipped ? { skipped: true } : {})
    }
  })

  if (sent.success) logger.info(`[claim-liveness] ${cmsId} reported as ${status}`)
  else logger.warn(`[claim-liveness] could not report ${cmsId} as ${status}: ${sent.error.message}`)
}

/** Starts the local tick and tells the backend the claim is being worked. */
export const beginRun = async (cmsId: string): Promise<void> => {
  stopBeating(cmsId)

  await touchRun(cmsId)

  beating.set(
    cmsId,
    setInterval(() => {
      void touchRun(cmsId)
    }, BEAT_INTERVAL_MS)
  )

  await reportClaimStatus(cmsId, 'Running')
}

/** Ends the local tick and reports the outcome. */
export const endRun = async (
  cmsId: string,
  status: Exclude<ScriptStatus, 'Running'>,
  extra: { ticketNumber?: string; error?: string; terminal?: boolean } = {}
): Promise<void> => {
  stopBeating(cmsId)
  await reportClaimStatus(cmsId, status, extra)
}

/**
 * The backstop for a run that ended without saying how.
 *
 * `beginRun` tells the backend the claim is Running, and every outcome after it
 * is supposed to reach `endRun`. "Supposed to" was the whole problem: the
 * reporting in the processor's catch block can itself throw — a local store
 * write, a credential flag — and a throw inside a catch escapes the function
 * with the row still marked Running. The backend then believes the claim is
 * being worked, by a process that has already moved on, until the six-hourly
 * sweep resets it. To an operator that is a claim frozen on Running with no
 * error, which reads as a hung app rather than a failed claim.
 *
 * `beating` is exactly the right signal and it was already here: a ticker is
 * live from `beginRun` until `endRun` stops it, so an entry still present means
 * no outcome was ever reported.
 *
 * REPORTED AS FAILED, NOT "Not Started". The run really did begin, and a claim
 * that reached the marketplace before dying must not be described as never
 * attempted — that is the reading that invites a retry and a second ticket. The
 * message says the outcome is unknown, because it is.
 */
export const settleIfUnreported = async (cmsId: string): Promise<void> => {
  if (!beating.has(cmsId)) return

  logger.error(
    `[claim-liveness] ${cmsId} finished without reporting an outcome — failing it so the row ` +
      'does not sit on Running'
  )

  await endRun(cmsId, 'Failed', {
    error:
      'The run ended without reporting an outcome. Check the marketplace for a ticket against ' +
      'this AWB before retrying — it may have been filed.'
  })
}

/**
 * A claim the run decided not to try, and why.
 *
 * NOT `endRun`, because no run ever began: nothing was heartbeating, nothing
 * opened a browser, and the claim is exactly as fileable as it was an hour ago.
 * `Not Started` is the status that says so — the same one an interrupted run
 * reports — and `skipped` is what stops the backend charging an attempt for it.
 */
export const reportClaimSkipped = async (cmsId: string, reason: string): Promise<void> =>
  reportClaimStatus(cmsId, 'Not Started', { error: reason, skipped: true })

const stopBeating = (cmsId: string): void => {
  const timer = beating.get(cmsId)

  if (!timer) return

  clearInterval(timer)
  beating.delete(cmsId)
}

/**
 * Repairs claims this machine was working when it died.
 *
 * Run once at startup, BEFORE the auto-runner drains the queue — a claim left
 * on `running` would otherwise never be picked up again, and the backend row
 * would sit at Running for good with nothing watching it.
 *
 * Each one is reset to `Not Started` at the backend so it becomes claimable
 * again, and marked failed locally with a reason an operator can read.
 */
export const recoverInterruptedRuns = async (): Promise<number> => {
  const orphans = (await listClaims()).filter((claim: QueuedClaim) => claim.status === 'running')

  if (orphans.length === 0) return 0

  logger.warn(
    `[claim-liveness] ${orphans.length} claim(s) were still running when the app last stopped — recovering`
  )

  for (const orphan of orphans) {
    const reason =
      'The desktop app stopped before this claim finished. Retry, or check that it is running.'

    await setStatus(orphan.cmsId, 'failed', { error: reason })
    await reportClaimStatus(orphan.cmsId, 'Not Started', { error: reason })
  }

  return orphans.length
}
