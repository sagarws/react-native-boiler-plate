/**
 * Call it once the caller stops calling it.
 *
 * TrackVid-FE uses lodash's `debounce` here, for the AWB fields: every
 * keystroke would otherwise be a master-data lookup, and the answer to a
 * half-typed AWB is always "no such order". lodash is not a dependency of this
 * app and is not worth becoming one for the two properties this form uses —
 * the delay and `.cancel()`, which every one of those effects calls on unmount.
 *
 * Deliberately NOT lodash-complete: no leading edge, no `maxWait`, no `flush`.
 * Adding them would be writing lodash rather than avoiding it.
 */
export interface Debounced<A extends unknown[]> {
  (...args: A): void
  /** Drops a pending call. Always called from an effect's cleanup. */
  cancel: () => void
}

export const debounce = <A extends unknown[]>(fn: (...args: A) => void, waitMs: number): Debounced<A> => {
  let timer: ReturnType<typeof setTimeout> | null = null

  const debounced = (...args: A): void => {
    if (timer !== null) clearTimeout(timer)

    timer = setTimeout(() => {
      timer = null
      fn(...args)
    }, waitMs)
  }

  debounced.cancel = (): void => {
    if (timer === null) return

    clearTimeout(timer)
    timer = null
  }

  return debounced
}

/**
 * The same, for a callback that is asynchronous.
 *
 * Every debounced callback on this form is a lookup — an AWB settles and the
 * master row is fetched. Nothing awaits the result; the callback writes into
 * the form itself when it lands. Passing an `async` function to `debounce`
 * directly would be a floating promise at every call site, so the fire-and-
 * forget is stated once, here, along with what happens when one rejects.
 */
export const debounceAsync = <A extends unknown[]>(
  fn: (...args: A) => Promise<void>,
  waitMs: number
): Debounced<A> =>
  debounce((...args: A) => {
    // A rejection here is a lookup that failed after the operator moved on.
    // The callbacks all catch their own errors and report what matters; this is
    // the backstop, and an unhandled rejection in a renderer is otherwise
    // invisible.
    void fn(...args).catch((error: unknown) => {
      console.error('[claim form] a background lookup failed', error)
    })
  }, waitMs)
