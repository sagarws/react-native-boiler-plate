import { AsyncLocalStorage } from 'node:async_hooks'

/**
 * "Has the run I am part of been told to stop?" — answerable from anywhere.
 *
 * THE AUTOMATIONS SWITCH HAS TO REACH THE INNERMOST LOOP. Switching it off
 * stops the scheduler WAITING at once, and each runner is handed a predicate to
 * stop at its next safe step. But that predicate was only read where a runner
 * happened to thread it — between accounts, between marketplaces — so the AJIO
 * report sync, switched off on page 1, carried on reading every page of every
 * month in the background, minutes after the screen said "Stopped".
 *
 * Threading a parameter through every service and loop is how one gets
 * missed. So the scheduler runs each task inside a context carrying its own
 * stop predicate, and any loop at any depth asks `stopRequested()`. Outside a
 * scheduled run — a button, an IPC call — there is no context and the answer
 * is always no: those are stopped by the operator who started them.
 */

const current = new AsyncLocalStorage<() => boolean>()

/** Runs `work` so that `stopRequested()` anywhere inside it reads `shouldStop`. */
export const runStoppable = <T>(shouldStop: () => boolean, work: () => Promise<T>): Promise<T> =>
  current.run(shouldStop, work)

/** Has the scheduled run this code belongs to been told to stop? False outside one. */
export const stopRequested = (): boolean => {
  const shouldStop = current.getStore()

  return shouldStop ? shouldStop() : false
}

/** Thrown at a stop point when the loop has no tidier way to end. */
export class AutomationStopped extends Error {
  readonly code = 'AUTOMATION_STOPPED'

  constructor(where: string) {
    super(`Stopped — Automations switched off (${where})`)
    this.name = 'AutomationStopped'
  }
}

/** The one-line stop point: throws when the run has been told to stop. */
export const throwIfStopped = (where: string): void => {
  if (stopRequested()) throw new AutomationStopped(where)
}

/**
 * A wait that ends early when the run is told to stop — for the long polls
 * (a master import waits ten minutes for Myntra to build a report). Checks
 * once a second, and throws `AutomationStopped` instead of finishing the wait.
 */
export const stoppableSleep = async (ms: number, where: string): Promise<void> => {
  const until = Date.now() + ms

  for (;;) {
    throwIfStopped(where)

    const left = until - Date.now()

    if (left <= 0) return

    await new Promise(resolve => setTimeout(resolve, Math.min(1000, left)))
  }
}
