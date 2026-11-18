import { useEffect } from 'react'

import type { UsageSnapshot } from '@shared/vms/usage'

import { vmsClient } from '../services/vmsClient'
import { useAppDispatch, useAppSelector } from '../store/store'
import { setUsage } from '../store/usage/usage.slice'
import { useVmsSession } from '../VmsSessionContext'

/**
 * The company's recording credits. Ported from Argos Watch: read when a feed is
 * taken, and again whenever an upload lands (`synced` moves) — the backend
 * spends a credit when create-order succeeds, so that is the moment the number
 * changes. No poll.
 */
export const useUsage = (synced: number): UsageSnapshot | null => {
  const dispatch = useAppDispatch()
  const usage = useAppSelector((state) => state.usage.usage)
  const { session } = useVmsSession()
  const feedId = session.authenticated ? (session.user?.feedId ?? null) : null

  useEffect(() => {
    if (!feedId) return
    let cancelled = false

    void vmsClient.usage().then((response) => {
      if (!cancelled && response.success) dispatch(setUsage(response.data))
    })

    return () => {
      cancelled = true
    }
  }, [feedId, synced, dispatch])

  return usage
}
