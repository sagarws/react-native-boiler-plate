/**
 * What the Sync button refreshes.
 *
 * Two tiers, because "refresh" means two different things:
 *
 *   GLOBAL — company info, credentials, schedule, session health. Every page
 *            depends on some of it, and it is what the app falls back to when
 *            the network goes. Re-read on every Sync, wherever you are.
 *
 *   PAGE   — the list this screen is showing. Only worth fetching while the
 *            screen is open, and pointless once it is not: a Claims page that
 *            re-fetched page 3 of a filter nobody is looking at would spend a
 *            round trip to fill a cache entry that will be stale before it is
 *            read.
 *
 * A page registers its own refresher on mount and withdraws it on unmount, so
 * Sync always acts on what is actually on screen. Without that, the button
 * either refreshes nothing useful or refreshes everything the app has ever
 * loaded.
 */

type Refresher = () => Promise<void> | void

let pageRefresher: Refresher | null = null

/**
 * Registers the current page's refresher. Returns the unregister function, so
 * a `useEffect` cleanup withdraws it and a page that has been navigated away
 * from can never be refreshed.
 */
export const registerPageRefresh = (refresher: Refresher): (() => void) => {
  pageRefresher = refresher

  return () => {
    // Guarded: a slow unmount could otherwise clear a NEWER page's refresher
    // that has already registered.
    if (pageRefresher === refresher) pageRefresher = null
  }
}

/** Runs the current page's refresher, if a page registered one. */
export const refreshCurrentPage = async (): Promise<void> => {
  await pageRefresher?.()
}

export const hasPageRefresh = (): boolean => pageRefresher !== null
