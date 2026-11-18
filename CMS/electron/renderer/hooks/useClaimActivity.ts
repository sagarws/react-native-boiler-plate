import { useEffect } from 'react'
import type { QueuedClaim } from '@shared/types/claimQueue'
import { onClaimReceived, onClaimStatusChanged } from '@renderer/services/claimQueue.service'
import { refreshCurrentPage } from '@renderer/services/refreshRegistry'
import { useToast } from '@renderer/hooks/useToast'
import { platformLabel } from '@shared/utils/platformKey'

/**
 * Says out loud what the claim runner is doing.
 *
 * Claims arrive over a socket and are filed automatically — nobody presses
 * anything — so without this the app worked in complete silence: a claim could
 * arrive, run for two minutes and fail, and the only trace was a log file.
 *
 * Mounted once at the app root rather than on the claims page, because the
 * operator is usually looking at something else when a dispatch lands. That is
 * exactly when they need to be told.
 */

/*
 * The platform by its display name ("Myntra", not the stored "myntra"), and
 * plain English — "filed", not "Succeed". A toast is read in a glance, so the
 * outcome leads and the reference follows.
 */
const STATUS_MESSAGE: Record<string, (claim: QueuedClaim) => string> = {
  running: claim => `Filing ${platformLabel(claim.platform)} claim ${claim.awbNumber ?? claim.cmsId}…`,
  succeeded: claim =>
    claim.ticketId
      ? `${platformLabel(claim.platform)} claim filed — ticket ${claim.ticketId}`
      : `${platformLabel(claim.platform)} claim filed`,
  failed: claim => `${platformLabel(claim.platform)} claim failed: ${claim.error ?? 'no reason given'}`
}

export const useClaimActivity = (): void => {
  const toast = useToast()

  useEffect(() => {
    const stopReceived = onClaimReceived(dispatch => {
      toast.info(
        `New ${platformLabel(dispatch.platform)} claim received${dispatch.awbNumber ? ` — ${dispatch.awbNumber}` : ''}`
      )
      void refreshCurrentPage()
    })

    const stopChanged = onClaimStatusChanged(claim => {
      const message = STATUS_MESSAGE[claim.status]?.(claim)

      // 'received' has no line: the arrival toast above already covered it, and
      // saying it twice for one claim is noise.
      if (!message) return

      if (claim.status === 'failed') toast.error(message)
      else if (claim.status === 'succeeded') toast.success(message)
      else toast.info(message)

      void refreshCurrentPage()
    })

    return () => {
      stopReceived()
      stopChanged()
    }
  }, [toast])
}
