import { useSyncExternalStore } from 'react'

import type { AnyAction } from './slice'
import { orderReducer } from './order/order.slice'
import { screenshotsReducer } from './screenshots/screenshots.slice'
import { usageReducer } from './usage/usage.slice'

/**
 * The VMS renderer's state, ported from Argos Watch's redux store.
 *
 * SAME KEYS, SAME HOOK NAMES (`useAppSelector`, `useAppDispatch`), so the
 * ported components read `state.video.trackingId` and dispatch
 * `setOrderType(...)` exactly as they did — but on a ~40-line store over
 * `useSyncExternalStore` instead of redux + react-redux (no new dependency in
 * the CMS; VMS_MERGE_PLAN.md §2).
 *
 * Module-level, like Argos Watch's: the VMS half of the app has one recorder,
 * and its state outlives switching to the CMS and back.
 */
export interface RootState {
  video: ReturnType<typeof orderReducer>
  usage: ReturnType<typeof usageReducer>
  screenshots: ReturnType<typeof screenshotsReducer>
}

const init = (): RootState => ({
  video: orderReducer(undefined, { type: '@@init' }),
  usage: usageReducer(undefined, { type: '@@init' }),
  screenshots: screenshotsReducer(undefined, { type: '@@init' })
})

let state: RootState = init()
const listeners = new Set<() => void>()

const dispatch = (action: AnyAction): AnyAction => {
  const next: RootState = {
    video: orderReducer(state.video, action),
    usage: usageReducer(state.usage, action),
    screenshots: screenshotsReducer(state.screenshots, action)
  }

  if (next.video !== state.video || next.usage !== state.usage || next.screenshots !== state.screenshots) {
    state = next
    listeners.forEach((listener) => listener())
  }

  return action
}

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export const store = {
  getState: (): RootState => state,
  dispatch,
  subscribe,
  /** Back to a fresh recorder — on feed switch and CMS sign-out. */
  reset: (): void => {
    state = init()
    listeners.forEach((listener) => listener())
  }
}

export type AppDispatch = typeof dispatch

export const useAppDispatch = (): AppDispatch => dispatch

export const useAppSelector = <T>(selector: (root: RootState) => T): T =>
  useSyncExternalStore(subscribe, () => selector(state))
