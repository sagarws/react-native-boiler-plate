import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * True after `timeoutMs` with no activity — the part of react-idle-timer
 * Argos Watch used (`events: ['mousemove', 'keydown']`, `onIdle`), without
 * the dependency.
 *
 * Cheap on purpose: an event only stamps the time. One timer checks the stamp
 * when it fires and re-arms for the remainder, so a moving mouse does not clear
 * and set a timer per pixel.
 */
const EVENTS = ['mousemove', 'keydown'] as const

export const useIdle = (timeoutMs: number, enabled: boolean): { idle: boolean; reset: () => void } => {
  const [idle, setIdle] = useState(false)
  const lastActivity = useRef(0)

  useEffect(() => {
    if (!enabled || idle) return
    let timer: ReturnType<typeof setTimeout> | null = null

    const stamp = (): void => {
      lastActivity.current = Date.now()
    }

    const check = (): void => {
      const remaining = lastActivity.current + timeoutMs - Date.now()
      if (remaining <= 0) setIdle(true)
      else timer = setTimeout(check, remaining)
    }

    stamp()
    EVENTS.forEach((name) => window.addEventListener(name, stamp, { passive: true }))
    timer = setTimeout(check, timeoutMs)

    return () => {
      if (timer) clearTimeout(timer)
      EVENTS.forEach((name) => window.removeEventListener(name, stamp))
    }
  }, [enabled, idle, timeoutMs])

  const reset = useCallback((): void => {
    lastActivity.current = Date.now()
    setIdle(false)
  }, [])

  return { idle: enabled && idle, reset }
}
