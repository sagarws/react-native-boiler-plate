/**
 * "Something changed about sessions" — a one-line pub/sub.
 *
 * The stale-session alert lives in the layout and the Sessions page lives
 * inside it, so a capture on that page has to reach a component that is not its
 * parent. Passing a callback down would couple the layout to a page it should
 * not know about; a store for one boolean would be more machinery than the
 * problem deserves.
 *
 * FED FROM BOTH SIDES, which it was not. This started as UI telling itself to
 * re-read — and a capture the UI did not start told nobody. The nightly Session
 * update runs in the main process, so it would fix every session the red banner
 * named and the banner would keep naming them until an operator pressed
 * Refresh, which is a person doing a notification by hand.
 *
 * So the main process's `platform-session:changed` is relayed into the same
 * set of listeners. One subscription for the whole window, taken out when this
 * module is first imported: every screen that cares is already calling
 * `onSessionsChanged`, and none of them needed changing.
 */

import { PLATFORM_SESSION_EVENTS, type SessionCapturingEvent } from '@shared/constants/channels'
import { subscribe } from './ipcClient'

type Listener = () => void

const listeners = new Set<Listener>()

type CapturingListener = (target: SessionCapturingEvent | null) => void

const capturingListeners = new Set<CapturingListener>()

/**
 * The account being signed in this instant, or null.
 *
 * REMEMBERED, not only pushed at listeners, because a card can mount midway
 * through a run — Settings opened while the nightly job is on its third account
 * — and an event-only channel would show nothing until the NEXT account
 * started. That is up to a minute of a live run looking like a stalled one.
 */
let capturing: SessionCapturingEvent | null = null

/** What is in flight right now, for a component's initial state. */
export const capturingNow = (): SessionCapturingEvent | null => capturing

/** Returns an unsubscribe function, for a useEffect cleanup. */
export const onSessionCapturing = (listener: CapturingListener): (() => void) => {
  capturingListeners.add(listener)

  return () => {
    capturingListeners.delete(listener)
  }
}

/** Call after anything that could change a session's health. */
export const notifySessionsChanged = (): void => {
  for (const listener of listeners) listener()
}

/** Returns an unsubscribe function, for a useEffect cleanup. */
export const onSessionsChanged = (listener: Listener): (() => void) => {
  listeners.add(listener)

  return () => {
    listeners.delete(listener)
  }
}

/**
 * The relay, wired once.
 *
 * `subscribe` returns an unsubscribe function that is deliberately dropped:
 * this lives for the lifetime of the window, and there is no moment at which
 * the app stops wanting to know that a session changed.
 */
subscribe(PLATFORM_SESSION_EVENTS.changed, () => {
  notifySessionsChanged()
})

/**
 * The same relay for "who is being signed in".
 *
 * The payload is trusted only as far as its shape: anything that is not a
 * `{ platform, username }` pair is read as "nothing in flight", so a malformed
 * event clears the spinner rather than leaving one turning forever.
 */
subscribe(PLATFORM_SESSION_EVENTS.capturing, payload => {
  const target = payload as Partial<SessionCapturingEvent> | null

  capturing =
    target && typeof target.platform === 'string' && typeof target.username === 'string'
      ? { platform: target.platform, username: target.username }
      : null

  for (const listener of capturingListeners) listener(capturing)
})
