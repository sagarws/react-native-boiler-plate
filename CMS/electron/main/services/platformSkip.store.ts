/**
 * "Leave this marketplace and move to the next one" — per task, while it runs.
 *
 * WHY IT IS NOT THE TASK-LEVEL SKIP. That one abandons the whole run: Skip on
 * Refill Data gives up on all seven marketplaces because one of them is slow.
 * The thing an operator actually wants at 02:00 is narrower and commoner —
 * Myntra is crawling through 580 rows, or one marketplace is timing out on
 * every claim, and the other six should not wait for it.
 *
 * IN MEMORY, DELIBERATELY, like the stop signal it sits beside. A skip is a
 * statement about the run in front of you; surviving a restart would mean a
 * marketplace quietly passed over tomorrow night because somebody pressed a
 * button tonight. It is also read inside tight loops, where a file read per
 * row would be the slowest thing in the loop.
 *
 * HONOURED AT THE NEXT ITEM, not mid-item. A claim half-filed on a marketplace
 * is how a ticket gets created with nothing here recording it, and a browser
 * killed mid-login leaves a session that looks captured and is not. Every loop
 * that reads this checks it between rows, so the wait is one row, not one
 * marketplace.
 *
 * CLEARED WHEN THE TASK ENDS, so a skip cannot leak into the next run.
 */
import { logger } from './logger'

/** taskId → the platform keys to pass over on this run. */
const requested = new Map<string, Set<string>>()

/**
 * `taskId:platform` → callbacks waiting for that skip.
 *
 * WHY A SIGNAL AS WELL AS A FLAG. The flag is read between rows, which is
 * right for a claim and wrong for a sign-in stuck waiting on an OTP mail that
 * never comes — that "row" is twenty minutes long, and the button sat on
 * "Skipping" for all of it. A sign-in is safe to abandon (nothing is
 * half-written at the marketplace), so the loop running one listens for this
 * and moves on the moment it fires.
 */
const waiters = new Map<string, Set<() => void>>()

/*
 * ONE SPELLING. The button sends a platform key, the loops hold keys of their
 * own, and a stray "Tata CliQ" against a stored "tatacliq" would be a skip
 * that silently did nothing — the worst failure this can have, because the
 * operator watches the marketplace they just skipped carry on working.
 */
const normalise = (platform: string): string => platform.trim().toLowerCase()

const waitKey = (taskId: string, platform: string): string => `${taskId}:${normalise(platform)}`

export const requestPlatformSkip = (taskId: string, platform: string): void => {
  const current = requested.get(taskId) ?? new Set<string>()

  current.add(normalise(platform))
  requested.set(taskId, current)

  logger.info(`[skip] ${taskId}: passing over ${platform} for the rest of this run`)

  const key = waitKey(taskId, platform)

  for (const wake of waiters.get(key) ?? []) wake()
  waiters.delete(key)
}

/**
 * Resolves when this marketplace is skipped on this task — immediately if it
 * already was. `cancel` MUST be called when the work it guards ends, or the
 * callback outlives it.
 */
export const whenPlatformSkipped = (
  taskId: string,
  platform: string
): { promise: Promise<void>; cancel: () => void } => {
  if (platformSkipped(taskId, platform)) return { promise: Promise.resolve(), cancel: () => {} }

  const key = waitKey(taskId, platform)
  let wake: () => void = () => {}
  const promise = new Promise<void>(resolve => {
    wake = resolve
  })
  const set = waiters.get(key) ?? new Set<() => void>()

  set.add(wake)
  waiters.set(key, set)

  return {
    promise,
    cancel: () => {
      const current = waiters.get(key)

      current?.delete(wake)
      if (current?.size === 0) waiters.delete(key)
    }
  }
}

/** Should this loop leave this marketplace alone? */
export const platformSkipped = (taskId: string, platform: string): boolean =>
  requested.get(taskId)?.has(normalise(platform)) === true

/** Everything asked for on this task, for a runner that reports what it passed over. */
export const skippedPlatforms = (taskId: string): string[] => [
  ...(requested.get(taskId) ?? [])
]

/** Called when a task starts and when it ends — a skip belongs to one run. */
export const clearPlatformSkips = (taskId: string): void => {
  requested.delete(taskId)
}
