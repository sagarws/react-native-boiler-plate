import { useCallback, useEffect, useState } from 'react'
import { MIRROR_IDLE, type MirrorStatus } from '@shared/vms/partnerVms'
import { useVmsSession } from '../VmsSessionContext'
import { currentCamera, whenCameraLive } from './cameraLive'
import { partnerVmsClient } from './partnerVmsClient'

/**
 * Is the Flipkart VMS mirror on for this desk?
 *
 * One boolean, resolved by the server from the company setting and any
 * per-feed override, carried on the held FEED session (the feed-token body is
 * the feed-login body, which has `user.partnerVmsEnabled`). A plain read — it
 * has no side effects, so a gate may call it freely (TrackVid-App 00a8d5b).
 */
export const usePartnerVmsEnabled = (): boolean => {
  const { session } = useVmsSession()
  return session.authenticated && session.user?.partnerVmsEnabled === true
}

/** The feed the session belongs to, so a feed switch re-runs the lifecycle. */
const useHeldFeedId = (): string | null => {
  const { session } = useVmsSession()
  return session.authenticated && session.user ? session.user.feedId : null
}

/**
 * Subscribe to mirror status without bringing the mirror up — for components
 * that only display state (the chips). `usePartnerVms` owns the lifecycle.
 */
export const usePartnerVmsStatus = (): { enabled: boolean; status: MirrorStatus } => {
  const enabled = usePartnerVmsEnabled()
  const [status, setStatus] = useState<MirrorStatus>(MIRROR_IDLE)

  useEffect(() => {
    let cancelled = false
    const off = partnerVmsClient.onStatus((next) => {
      if (!cancelled) setStatus(next)
    })
    void partnerVmsClient.status().then((response) => {
      if (!cancelled && response.success) setStatus(response.data)
    })
    return () => {
      cancelled = true
      off()
    }
  }, [])

  return { enabled, status: enabled ? status : MIRROR_IDLE }
}

/**
 * Brings the mirror up once a feed with the mirror is held, and keeps the
 * latest status. The view is created hidden, so the status is accurate before
 * the packer ever opens the tab.
 *
 * Switching it OFF is main's job, not this hook's: main tears the view down
 * when the feed session stops carrying the flag (release, switch, sign-out,
 * 401). A renderer-side "disable when not enabled" would fire during the
 * moment after a remount when the session has not been read yet, and throw
 * away a seller's live Flipkart login for nothing.
 */
export const usePartnerVms = (opts?: {
  /**
   * Hold the mirror back until the recorder's own camera is open (the
   * background boot), so the app sets the camera format and their page joins
   * it. False when the seller has opened the Flipkart page: they want it now.
   */
  waitForCamera?: boolean
}): { enabled: boolean; status: MirrorStatus; show: () => void; hide: () => void } => {
  const { enabled, status } = usePartnerVmsStatus()
  const feedId = useHeldFeedId()
  const waitForCamera = opts?.waitForCamera ?? true

  useEffect(() => {
    if (!enabled || !feedId) return undefined

    // Cancelled on unmount so a mirror still waiting for the camera cannot come
    // up after the component that asked for it has gone.
    let cancelled = false
    const wait = waitForCamera ? whenCameraLive() : null

    void (async () => {
      const cam = wait ? await wait.promise : currentCamera()
      if (cancelled) return
      await partnerVmsClient.enable(cam.label, cam.format)
    })()

    return () => {
      cancelled = true
      wait?.cancel()
    }
  }, [enabled, feedId, waitForCamera])

  const show = useCallback(() => void partnerVmsClient.show(), [])
  const hide = useCallback(() => void partnerVmsClient.hide(), [])

  return { enabled, status, show, hide }
}
