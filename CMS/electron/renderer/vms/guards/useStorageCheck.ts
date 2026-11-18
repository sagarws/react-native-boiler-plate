import { useCallback, useEffect, useState } from 'react'

import { vmsClient } from '../services/vmsClient'
import { useAppDispatch, useAppSelector } from '../store/store'
import { setStorageWarningAppeared, setSystemStorageInfo } from '../store/usage/usage.slice'

/**
 * Disk space under the recordings. Ported from Argos Watch's
 * StorageCheckProvider, same thresholds and cadence:
 *
 *   ≤ 10 GB free  warn ONCE per session (`isStorageWarningAppeared` latches,
 *                 so the operator is not bounced back every hour)
 *   ≤ 5 GB free   block, every time — below this the recorder cannot write
 *                 reliably
 *
 * Polled hourly (`vms:disk-info`), as Argos did. Returns whether the storage
 * screen is up, and what its button does.
 */
export const STORAGE_WARN_GB = 10
export const STORAGE_CRITICAL_GB = 5
const POLL_MS = 60 * 60 * 1000

export const useStorageCheck = (): { open: boolean; critical: boolean; busy: boolean; acknowledge: () => Promise<void> } => {
  const dispatch = useAppDispatch()
  const { isStorageWarningAppeared, systemStorageInfo } = useAppSelector((state) => state.usage)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false

    const runCheck = async (): Promise<void> => {
      const response = await vmsClient.diskInfo()
      if (cancelled || !response.success) return

      const info = response.data
      dispatch(setSystemStorageInfo(info))

      const shouldWarn =
        (!isStorageWarningAppeared && info.availableGB <= STORAGE_WARN_GB && info.availableGB > STORAGE_CRITICAL_GB) ||
        info.availableGB <= STORAGE_CRITICAL_GB

      if (shouldWarn) {
        dispatch(setStorageWarningAppeared(true))
        setOpen(true)
      }
    }

    void runCheck()
    const timer = setInterval(() => void runCheck(), POLL_MS)

    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [dispatch, isStorageWarningAppeared])

  const critical = Boolean(systemStorageInfo && systemStorageInfo.availableGB <= STORAGE_CRITICAL_GB)

  /** The screen's Ok: a warning is dismissed; a block re-measures first. */
  const acknowledge = useCallback(async (): Promise<void> => {
    if (!critical) {
      dispatch(setStorageWarningAppeared(true))
      setOpen(false)
      return
    }

    setBusy(true)
    try {
      const response = await vmsClient.diskInfo()
      if (response.success) {
        dispatch(setSystemStorageInfo(response.data))
        if (response.data.availableGB > STORAGE_CRITICAL_GB) {
          dispatch(setStorageWarningAppeared(false))
          setOpen(false)
        }
      }
    } finally {
      setBusy(false)
    }
  }, [critical, dispatch])

  return { open, critical, busy, acknowledge }
}
