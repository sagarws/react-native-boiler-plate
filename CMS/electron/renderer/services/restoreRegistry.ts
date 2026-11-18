/**
 * Getting a minimised job's window back.
 *
 * The background panel in the corner is the only trace of a minimised run, and
 * some of those runs end with something an operator must still DO — a bulk SKU
 * sweep finishes holding a review nobody has saved. Without a way back to the
 * window, minimising it loses that work: the panel says "nothing saved yet" and
 * no button anywhere reopens the table.
 *
 * The panel lives in the app shell and the windows live on the Claims page, so
 * neither can hand the other a callback. The page registers what its windows can
 * reopen, keyed by the same string the panel keys its rows on; the panel shows a
 * maximise button on the rows that have one and nothing on the rows that do not
 * — a queued claim has no window to go back to.
 *
 * Registered on mount and withdrawn on unmount, exactly as the page refresher
 * is, so a panel row can never reopen a window belonging to a page that has
 * been navigated away from.
 */

type Restorer = () => void

const restorers = new Map<string, Restorer>()

/**
 * Registers the window a panel row reopens. Returns the unregister function for
 * a `useEffect` cleanup.
 */
export const registerRestore = (key: string, restore: Restorer): (() => void) => {
  restorers.set(key, restore)

  return () => {
    // Guarded: a slow unmount could otherwise withdraw a NEWER page's restorer
    // that has already registered under the same key.
    if (restorers.get(key) === restore) restorers.delete(key)
  }
}

export const canRestore = (key: string): boolean => restorers.has(key)

/** Reopens the window for this row, if the page that owns it is on screen. */
export const requestRestore = (key: string): void => {
  restorers.get(key)?.()
}
