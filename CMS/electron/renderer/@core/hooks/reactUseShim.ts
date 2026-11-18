// React Imports
import { useEffect, useRef } from 'react'

// Hook Imports
import { useMedia } from '@core/hooks/useMedia'

/**
 * Stands in for `react-use`, which the ported components import.
 *
 * WHY NOT THE REAL PACKAGE. It reaches this app through exactly three hooks —
 * `useUpdateEffect`, `useMedia` and `useDebounce` — and drags in a `js-cookie`
 * with a high advisory to do it. A vulnerable transitive inside a signed
 * desktop installer is a bad trade for thirty lines of code.
 *
 * Aliased by module name so the ported files keep their original imports and
 * stay comparable with Monitor's. Only what is actually used is exported: an
 * import of anything else should fail at the build, loudly, rather than
 * silently resolve to nothing.
 */

/** An effect that skips the first render. */
export const useUpdateEffect = (effect: () => void, deps?: unknown[]): void => {
  const mounted = useRef(false)

  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true

      return
    }

    effect()
    // The caller owns the dependency list, exactly as react-use does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
}

/**
 * Runs `fn` once the dependencies have stopped changing for `ms`.
 *
 * react-use returns `[isReady, cancel]`; nothing here uses the return value, so
 * this returns nothing rather than pretending to implement it.
 */
export const useDebounce = (fn: () => void, ms: number, deps: unknown[] = []): void => {
  useEffect(() => {
    const timer = setTimeout(fn, ms)

    // Always cleared: a debounce that leaks its timer fires after the component
    // that wanted it has gone.
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
}

export { useMedia }
