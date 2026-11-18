import { useEffect, useState } from 'react'

import type { QueueCounts } from '@shared/vms/queue'

import { vmsClient } from '../services/vmsClient'

const EMPTY: QueueCounts = { unsynced: 0, syncing: 0, synced: 0, failed: 0 }

/**
 * Live snapshot of the upload queue's tally. Ported from Argos Watch.
 *
 * Subscribes to every push from main first, then reads once to cover a write
 * that landed between mount and subscription. Never polls: main publishes the
 * counts on every queue write (`vms:queue-counts-changed`).
 */
export const useQueueCounts = (): QueueCounts => {
  const [counts, setCounts] = useState<QueueCounts>(EMPTY)

  useEffect(() => {
    let cancelled = false

    const unsubscribe = vmsClient.onQueueCountsChange((next) => {
      if (!cancelled) setCounts(next)
    })

    void vmsClient.queueCounts().then((response) => {
      if (!cancelled && response.success) setCounts(response.data)
    })

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])

  return counts
}
