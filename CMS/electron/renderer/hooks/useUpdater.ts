import { useCallback, useEffect, useState } from 'react'
import type { UpdateState } from '@shared/types/update'
import { initialUpdateState } from '@shared/types/update'
import { updateClient } from '@renderer/services/update.service'

export interface UseUpdater {
  state: UpdateState
  /** True while a manually triggered check is in flight. */
  checking: boolean
  check: () => void
  /** Quits and installs a staged update; the app relaunches itself. */
  install: () => void
}

/**
 * Subscribes to updater state.
 *
 * State is pushed from the main process, never polled: electron-updater already
 * emits an event on every transition, and a timer here would just duplicate it.
 * One status read on mount covers the gap where events fired before React had
 * mounted.
 */
export const useUpdater = (): UseUpdater => {
  const [state, setState] = useState<UpdateState>(() => initialUpdateState(''))
  const [checking, setChecking] = useState(false)

  useEffect(() => {
    let cancelled = false

    // Subscribe first, then read: the other order can drop a transition that
    // lands between the read and the subscription.
    const unsubscribe = updateClient.onStatusChange((next) => {
      if (!cancelled) setState(next)
    })

    void updateClient.status().then((response) => {
      if (!cancelled && response.success) setState(response.data)
    })

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])

  const check = useCallback((): void => {
    setChecking(true)
    void updateClient.check().then(() => setChecking(false))
  }, [])

  const install = useCallback((): void => {
    void updateClient.install()
  }, [])

  return { state, checking, check, install }
}
