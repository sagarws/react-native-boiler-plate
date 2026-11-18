import { normalisePlatform, shouldMirror } from '@shared/vms/partnerVms'
import { failureMessage, shouldShowFailureToast } from '@shared/vms/partnerVmsPresentation'
import { partnerVmsClient } from './partnerVmsClient'

/**
 * Fire-and-forget bridge to the Flipkart VMS mirror — TrackVid-App's
 * utlis/partnerVmsMirror.ts.
 *
 * The app's own recording is the source of truth and must never wait on, or be
 * gated by, the mirror. Every function here returns void, swallows its own
 * failures, and is never awaited on the recording path.
 */

/** Packer-facing failure toasts; the recorder hands in the CMS toast. */
export type MirrorNotify = (message: string) => void

const lastToastAt = new Map<string, number>()

/**
 * Ask the mirror to record the same order. Only fires for Flipkart and Myntra
 * (word match, shared with main) — every other platform records in TrackVid
 * alone, exactly as before.
 */
export const maybeStartMirror = (
  req: { awb?: string | null; orderType?: string | null; platform?: string | null },
  notify?: MirrorNotify
): void => {
  try {
    const awb = (req.awb ?? '').trim()
    if (!awb) return
    if (!shouldMirror(req.platform)) {
      // Say why: a platform named slightly differently on the backend used to
      // look identical to the feature being off.
      // eslint-disable-next-line no-console -- order diagnostics, as TrackVid-App logs them
      console.info(`[partner-vms] not mirroring ${awb}: platform "${req.platform ?? '(none)'}" is not Flipkart or Myntra`)
      return
    }

    void partnerVmsClient
      .startMirror({ awb, orderType: req.orderType || 'Forward', platform: normalisePlatform(req.platform) })
      .then((response) => {
        const outcome = response.success ? response.data : null
        if (outcome?.ok) return
        console.warn('[partner-vms] order not mirrored', awb, outcome?.reason, outcome?.detail)

        const message = failureMessage(outcome?.state, outcome?.reason)
        if (!message || !notify) return
        const key = outcome?.reason === 'superseded' ? 'superseded' : (outcome?.state ?? 'unknown')
        const now = Date.now()
        if (!shouldShowFailureToast(key, now, lastToastAt)) return
        lastToastAt.set(key, now)
        notify(message)
      })
      .catch((err: unknown) => console.warn('[partner-vms] mirror start failed', err))
  } catch (err) {
    console.warn('[partner-vms] mirror start threw', err)
  }
}

/**
 * End the mirrored recording. Called on EVERY stop, not only on a platform
 * change: their recorder is a running tap — a new AWB switches it and nothing
 * turns it off — so a following Meesho order would land inside the previous
 * Flipkart AWB's video. Main makes it a no-op on desks without the mirror.
 */
export const parkMirror = (): void => {
  try {
    void partnerVmsClient
      .park()
      .then((response) => {
        const outcome = response.success ? response.data : null
        if (outcome && !outcome.ok && outcome.reason !== 'disabled') {
          console.warn('[partner-vms] park incomplete', outcome.reason, outcome.detail)
        }
      })
      .catch((err: unknown) => console.warn('[partner-vms] park failed', err))
  } catch (err) {
    console.warn('[partner-vms] park threw', err)
  }
}
