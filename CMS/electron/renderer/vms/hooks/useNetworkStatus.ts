import { useEffect, useRef, useState } from 'react'

import { vmsClient } from '../services/vmsClient'

/**
 * Whether the backend is reachable, for the rail's network row. Ported from
 * Argos Watch, unchanged in behaviour:
 *
 *   1. `navigator.onLine` as the fast local baseline (online/offline events);
 *   2. a probe RUN IN MAIN (`vms:probe-api`) — a renderer fetch is bound by the
 *      CSP and by CORS, and flipped a healthy link to red;
 *   3. 30 s between probes while online, 10 s while offline (recover fast,
 *      probe rarely at rest).
 *
 * Mounted only in VMS mode, so the CMS half runs no timer for it.
 */
export type NetworkState = 'online' | 'offline' | 'probing'

const ONLINE_INTERVAL_MS = 30_000
const OFFLINE_INTERVAL_MS = 10_000

export const useNetworkStatus = (): NetworkState => {
  const [state, setState] = useState<NetworkState>(() => (navigator.onLine ? 'probing' : 'offline'))
  const stateRef = useRef<NetworkState>(state)

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null

    const apply = (next: NetworkState): void => {
      stateRef.current = next
      if (!cancelled) setState(next)
    }

    const schedule = (): void => {
      if (cancelled) return
      const delay = stateRef.current === 'offline' ? OFFLINE_INTERVAL_MS : ONLINE_INTERVAL_MS
      timer = setTimeout(() => void probe(), delay)
    }

    const probe = async (): Promise<void> => {
      if (cancelled) return
      if (!navigator.onLine) {
        apply('offline')
        schedule()
        return
      }
      if (stateRef.current !== 'online') apply('probing')
      const response = await vmsClient.probeApi()
      if (cancelled) return
      apply(response.success && response.data.reachable ? 'online' : 'offline')
      schedule()
    }

    // The link came back: probe now rather than at the next tick.
    const onOnline = (): void => {
      if (timer) clearTimeout(timer)
      void probe()
    }
    const onOffline = (): void => {
      if (timer) clearTimeout(timer)
      apply('offline')
      schedule()
    }

    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    void probe()

    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
    }
  }, [])

  return state
}
