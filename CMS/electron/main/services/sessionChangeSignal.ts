/**
 * "A session just changed" — inside the main process, for the main process.
 *
 * WHY A MODULE OF ITS OWN, rather than the scheduler simply calling the
 * session service or the other way round. Both already need each other: the
 * scheduler runs the tasks that capture sessions, and a capture is the event
 * that can lift the schedule's hold. Importing either from the other closes a
 * cycle, and in a bundled main process a cycle is how a function arrives
 * `undefined` at the one moment it is called — at 02:00, with nobody watching.
 *
 * So the dependency points at this file from both sides: the session service
 * announces, the scheduler listens, and neither knows the other exists.
 *
 * NOT the renderer broadcast. That one tells open windows to re-read; this one
 * tells code in this process that the answer to "are the logins usable" may
 * have changed. The renderer's copy cannot be used for it — the main process
 * is the sender, not a listener, and a window need not even be open.
 */
import { logger } from './logger'

type Listener = () => void

const listeners = new Set<Listener>()

/** Register interest. Returns the unsubscribe, for tests and for teardown. */
export const onSessionChanged = (listener: Listener): (() => void) => {
  listeners.add(listener)

  return () => listeners.delete(listener)
}

/**
 * Tell the process a session changed.
 *
 * Each listener is isolated: one that throws must not stop the others, and
 * must never fail the capture that announced it — the session was still
 * captured, whatever a listener made of the news.
 */
export const sessionChanged = (): void => {
  for (const listener of listeners) {
    try {
      listener()
    } catch (error) {
      logger.warn('[sessions] a listener failed on a session change', error)
    }
  }
}
