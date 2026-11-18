import { useCallback, useEffect, useState } from 'react'

import type { IstDate } from '@shared/vms/system'

import { vmsClient } from '../services/vmsClient'

/**
 * This machine's date against the server's IST date. Ported from Argos
 * Watch's DateCheckProvider + DateMismatchPage.
 *
 * Runs when a feed is taken. Skipped for a feed allowed to run on another
 * date (`vms:camera-date-permission`), and FAIL-OPEN: if either call cannot
 * reach the server the operator is not stranded.
 */
const sameDay = (ist: IstDate): boolean => {
  const now = new Date()
  return now.getDate() === ist.day && now.getMonth() + 1 === ist.month && now.getFullYear() === ist.year
}

export const useDateCheck = (
  feedId: string | null
): { mismatch: boolean; busy: boolean; recheck: () => Promise<'ok' | 'mismatch' | 'unreachable'> } => {
  const [mismatchFor, setMismatchFor] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!feedId) return
    let cancelled = false

    const run = async (): Promise<void> => {
      const permission = await vmsClient.cameraDatePermission(feedId)
      if (cancelled || !permission.success || permission.data) return

      const ist = await vmsClient.istDate()
      if (cancelled || !ist.success) return

      if (!sameDay(ist.data)) setMismatchFor(feedId)
    }

    void run()

    return () => {
      cancelled = true
    }
  }, [feedId])

  const recheck = useCallback(async (): Promise<'ok' | 'mismatch' | 'unreachable'> => {
    if (!feedId) return 'ok'
    setBusy(true)
    try {
      const permission = await vmsClient.cameraDatePermission(feedId)
      if (permission.success && permission.data) {
        setMismatchFor(null)
        return 'ok'
      }
      const ist = await vmsClient.istDate()
      if (!ist.success) return 'unreachable'
      if (sameDay(ist.data)) {
        setMismatchFor(null)
        return 'ok'
      }
      return 'mismatch'
    } finally {
      setBusy(false)
    }
  }, [feedId])

  return { mismatch: feedId !== null && mismatchFor === feedId, busy, recheck }
}
