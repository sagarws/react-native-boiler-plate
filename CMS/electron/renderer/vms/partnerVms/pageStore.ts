import { useSyncExternalStore } from 'react'

/**
 * Which VMS screen is showing: the recorder, or the Flipkart VMS page. A tiny
 * external store so the rail (App's useVmsNavigation), the bar title and the
 * content (VmsApp) read one value. Not persisted, like the CMS's own screen.
 */
export type VmsPage = 'recorder' | 'flipkart'

let page: VmsPage = 'recorder'
const listeners = new Set<() => void>()

export const getVmsPage = (): VmsPage => page

export const setVmsPage = (next: VmsPage): void => {
  if (next === page) return
  page = next
  listeners.forEach((fn) => fn())
}

const subscribe = (fn: () => void): (() => void) => {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export const useVmsPage = (): VmsPage => useSyncExternalStore(subscribe, getVmsPage, getVmsPage)

export const FLIPKART_VMS_NAV_ID = 'vms-flipkart'
export const FLIPKART_VMS_LABEL = 'Flipkart VMS'
