import type { QueuedClaim } from '@shared/types/claimQueue'
import { listClaims } from './claimQueue.service'
import { runClaim } from './claimProcessor.service'
import { logger } from './logger'
import { automationsHalted } from './schedulerPause.store'
import { withAutomationLock } from './automationLock'
import { closeClaimLease, openClaimLease } from './browserLease.service'

/**
 * Files dispatched claims without waiting for anyone to press a button.
 *
 * MY_PLAN.md §6: "on recive this socket call should be save this claim in local
 * db and start process." The socket half was built and the second half was not,
 * so a claim arrived, sat in the queue and waited for an operator — which on an
 * unattended machine is forever.
 *
 * STRICTLY SERIAL. Every runner drives a real browser and uploads evidence;
 * two at once would compete for the screen, for the marketplace's rate limits,
 * and for the same session. So this is one worker with a queue, not a fan-out —
 * `draining` is the whole concurrency control.
 *
 * Re-entrant by design: `drain()` is called on every dispatch and on startup,
 * and a call that arrives mid-drain simply returns, because the loop below
 * re-reads the queue each pass and will pick up whatever was just added.
 */

/** One drain at a time, process-wide. */
let draining = false

/**
 * Claims that failed THIS session, so a permanent failure is not retried in a
 * tight loop.
 *
 * A failed claim keeps `status: 'failed'` in the store and is not re-selected,
 * but a re-dispatch of the same cmsId from the backend would otherwise walk
 * straight back in. Cleared on restart, deliberately: an operator restarting
 * the app is the usual way of saying "try again".
 */
const failedThisSession = new Set<string>()

/** The oldest claim waiting to be worked, or undefined. */
const nextClaim = (claims: QueuedClaim[]): QueuedClaim | undefined =>
  claims
    .filter(claim => claim.status === 'received' && !failedThisSession.has(claim.cmsId))
    .sort((a, b) => a.receivedAt.localeCompare(b.receivedAt))[0]

/**
 * Works the queue until nothing is left.
 *
 * Never throws and never rejects: it runs detached from a socket event, so a
 * rejection here would surface as an unhandled rejection rather than as
 * anything an operator could act on. Each claim's own failure is recorded
 * against that claim by `processClaim`.
 */
export const drainClaims = async (): Promise<void> => {
  if (draining) return
  // Automations switched off: claims stay queued, and are picked up when it
  // is switched back on.
  if (await automationsHalted()) return

  draining = true

  try {
    // The lock, not `draining`, is what keeps this away from the bulk claim.
    // `draining` only stops THIS function running twice; the bulk run is a
    // different function driving the same browser and the same AJIO session,
    // and the two of them interleaving is how a mid-claim run gets signed out
    // from under itself.
    //
    // Taken INSIDE the re-entrancy guard on purpose: a dispatch arriving during
    // a bulk run should wait for it, and the guard is what stops every later
    // dispatch piling up its own waiter behind the same lock.
    await withAutomationLock('claim-runner', async () => {
      // Claims in one drain share a browser. AJIO has to drive a real logged-in
      // page, and opening Chrome for each of eight queued claims — signing in
      // each time — was most of the wall-clock time of a queue.
      openClaimLease()

      try {
        for (;;) {
          // Between claims, never mid-claim: switched off, the one in hand is
          // finished and the rest wait.
          if (await automationsHalted()) return

          const claim = nextClaim(await listClaims())

          if (!claim) return

          logger.info(`[claim-runner] starting ${claim.platform} claim ${claim.cmsId} automatically`)

          const result = await runClaim(claim.cmsId)

          if (!result.success) {
            // Remembered so the loop moves on. `runClaim` has already written
            // the reason against the row, and re-selecting it would spin.
            failedThisSession.add(claim.cmsId)
            logger.warn(`[claim-runner] ${claim.cmsId} failed: ${result.error.message}`)
          }
        }
      } finally {
        // Every exit path, including the `return` that ends the loop: a browser
        // left open holds a profile lock and a marketplace session.
        await closeClaimLease()
      }
    })
  } catch (error) {
    logger.error('[claim-runner] stopped unexpectedly', error)
  } finally {
    draining = false
  }
}

/**
 * Kicks the drain without waiting for it.
 *
 * For callers on an event path — a socket message, app startup — that must not
 * block for the minutes a claim takes.
 */
export const startDraining = (): void => {
  void drainClaims()
}

/** Is a claim being filed right now? For the UI, and for tests. */
export const isDraining = (): boolean => draining
