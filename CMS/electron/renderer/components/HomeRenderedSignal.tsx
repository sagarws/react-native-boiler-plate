import { useEffect } from 'react'
import { reportHomeRendered } from '@renderer/services/startup.service'

/**
 * Renders nothing. Mounted inside the app shell, so its effect runs once the
 * signed-in home page is on screen — and that is what lets the main process
 * start its background work (claims, syncs, the schedule) only after the first
 * paint rather than racing it. See startupGate.service.
 */
export const HomeRenderedSignal = () => {
  useEffect(() => {
    // After the browser has painted this frame, not merely after React mounted.
    const frame = requestAnimationFrame(() => {
      void reportHomeRendered()
    })

    return () => cancelAnimationFrame(frame)
  }, [])

  return null
}
