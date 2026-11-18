import { logger } from './logger'

/**
 * Background work waits for the home page.
 *
 * WHY. At launch the app restored the session, connected the claim socket,
 * started the import queue and switched Automations on — Login update, report
 * syncs, claims — all before the window had painted anything but its spinner.
 * The first screen an operator saw was "Starting TrackVid CMS…" over a log
 * already busy re-capturing sessions, and the renderer competed with all of it
 * for the main process.
 *
 * THE RULE. Anything that starts background work is queued here — at launch
 * and at sign-in — and the queue runs `HOME_SETTLE_MS` after the renderer says
 * the home page has rendered (`homeRendered`, from the app shell). If the
 * screen never says so — the login screen left open, a renderer that crashed —
 * the queue runs anyway after `FALLBACK_MS`, so an unattended machine still
 * keeps its schedule.
 */

/** After the home page has rendered, before anything starts. */
export const HOME_SETTLE_MS = 5_000

/** The longest anything waits for the home page before it starts regardless. */
export const FALLBACK_MS = 60_000

interface Waiting {
  label: string
  run: () => void
}

let queue: Waiting[] = []
let settleTimer: ReturnType<typeof setTimeout> | null = null
let fallbackTimer: ReturnType<typeof setTimeout> | null = null

const flush = (why: string): void => {
  if (settleTimer) clearTimeout(settleTimer)
  if (fallbackTimer) clearTimeout(fallbackTimer)
  settleTimer = null
  fallbackTimer = null

  const due = queue

  queue = []

  if (due.length === 0) return

  logger.info(`[startup] ${why} — starting ${due.map(entry => entry.label).join(', ')}`)

  for (const entry of due) {
    try {
      entry.run()
    } catch (error) {
      // One starter failing must not stop the rest.
      logger.error(`[startup] ${entry.label} failed to start`, error)
    }
  }
}

/**
 * Runs `run` once the home page has rendered and settled — or after
 * `FALLBACK_MS` if it never does. Queued work runs in the order it was queued.
 */
export const afterHomePage = (label: string, run: () => void): void => {
  queue.push({ label, run })

  if (!fallbackTimer) {
    fallbackTimer = setTimeout(
      () => flush(`the home page did not report in within ${FALLBACK_MS / 1000}s`),
      FALLBACK_MS
    )
    fallbackTimer.unref?.()
  }
}

/** The renderer's app shell has rendered: start what is waiting, `HOME_SETTLE_MS` from now. */
export const homeRendered = (): void => {
  if (queue.length === 0 || settleTimer) return

  logger.info(`[startup] home page rendered — background work starts in ${HOME_SETTLE_MS / 1000}s`)
  settleTimer = setTimeout(() => flush('home page settled'), HOME_SETTLE_MS)
}
