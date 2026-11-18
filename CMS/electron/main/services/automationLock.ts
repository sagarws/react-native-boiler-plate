import { logger } from './logger'

/**
 * One automation drives the browser at a time, process-wide.
 *
 * Everything in this app that files a claim opens a real Chrome, signs in to a
 * marketplace and uploads evidence. Two of those at once compete for the
 * screen, for the marketplace's rate limits, and — worst — for the same stored
 * session: one run re-authenticates while the other is mid-claim, and the
 * second one's next call comes back 401 for no reason it can report.
 *
 * The single-claim runner had this already, as a `draining` boolean private to
 * itself. That was enough while it was the only thing driving a browser. The
 * bulk claim is the second, and a boolean each is not mutual exclusion — so the
 * lock moved out here where both can take it.
 *
 * FIFO, and it queues rather than refuses: a claim dispatched during a two-hour
 * bulk run must not be dropped, it must wait. Callers that should not wait
 * (a re-entrant drain, say) check `isAutomationBusy()` first.
 */

/**
 * Every waiter chains onto this. Resolving it hands the lock to whoever chained
 * next, which is what makes the ordering fair rather than a scramble.
 */
let tail: Promise<void> = Promise.resolve()

let holder: string | null = null

/** What is running now, or null. Named so a log line can say what a caller is waiting for. */
export const automationHolder = (): string | null => holder

export const isAutomationBusy = (): boolean => holder !== null

/**
 * Resolves once everything holding or queued for the browser right now has
 * released it. Takes no place in the queue — it only waits.
 */
export const whenAutomationFree = (): Promise<void> => tail

/**
 * Runs `work` with the browser to itself.
 *
 * The lock is released whether `work` returns or throws — a runner that dies
 * mid-claim must not take the app's ability to run anything else with it.
 *
 * @param name what to call this in the logs
 */
export const withAutomationLock = async <T>(name: string, work: () => Promise<T>): Promise<T> => {
  if (holder) {
    logger.info(`[automation-lock] ${name} is waiting for ${holder} to finish`)
  }

  // Claim our place in the queue before awaiting anything, so two callers
  // arriving in the same tick cannot both chain onto the same predecessor.
  let release = (): void => undefined
  const ours = new Promise<void>(resolve => {
    release = resolve
  })
  const predecessor = tail

  tail = ours

  await predecessor

  holder = name

  try {
    return await work()
  } finally {
    holder = null
    release()
  }
}
