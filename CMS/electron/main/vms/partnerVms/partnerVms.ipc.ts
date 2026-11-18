import type { BrowserWindow } from 'electron'
import { PARTNER_VMS_CHANNELS, PARTNER_VMS_EVENTS } from '@shared/constants/channels'
import { ok } from '@shared/types/result'
import {
  sanitiseFormat,
  sanitiseLabel,
  sanitiseRect,
  sanitiseRequest,
  shouldMirror,
  type MirrorCameraInput,
  type MirrorOutcome,
  type MirrorStatus
} from '@shared/vms/partnerVms'
import { broadcast } from '../../ipc/broadcast'
import { registerHandler } from '../../ipc/handler'
import { logger } from '../../services/logger'
import { getFeedSession, onFeedSessionChange } from '../feedSession.service'
import { PartnerVmsController } from './controller'
import { notMirroredLine } from './messages'

/**
 * The Flipkart VMS mirror's wiring — TrackVid-App's `partner-vms:*` handlers
 * from src/main/index.ts, on the CMS's channel list and `registerHandler`.
 *
 * Every handler is best effort and answers a status or an outcome; the
 * renderer never awaits these on the recording path.
 *
 * GATED IN MAIN TOO. The mirror is on only while the held FEED session says
 * `partnerVmsEnabled` (TrackVid-App re-read it from the feed user). The view is
 * torn down when that stops being true: the feed released (switch, CMS
 * sign-out — auth.service releases the feed — or a 401), the feed changed, or
 * the flag went off. Quit and window close are handled in main.ts / the
 * controller.
 */

const controller = new PartnerVmsController((status) => broadcast(PARTNER_VMS_EVENTS.statusChanged, status))

/** The feed the running view was brought up under. */
let enabledForFeed: string | null = null

const entitledFeed = (): string | null => {
  const held = getFeedSession()
  return held && held.user.partnerVmsEnabled === true ? held.feedId : null
}

/** Called by main.ts for every main window it creates. */
export const attachPartnerVmsWindow = (win: BrowserWindow): void => controller.attachWindow(win)

/** Quit / sign-out: tear the view down. Synchronous, safe to call any time. */
export const disablePartnerVms = (): void => {
  enabledForFeed = null
  controller.disable()
}

const readCamera = (payload: unknown): { label: string | null; format: ReturnType<typeof sanitiseFormat> } => {
  const input = (payload && typeof payload === 'object' ? payload : {}) as MirrorCameraInput
  return { label: sanitiseLabel(input.cameraLabel), format: sanitiseFormat(input.format) }
}

export const registerPartnerVmsIpc = (): void => {
  onFeedSessionChange(() => {
    const feed = entitledFeed()
    if (controller.isEnabled() || enabledForFeed !== null) {
      if (feed === null || feed !== enabledForFeed) {
        logger.info('[partner-vms] feed session changed — switching the mirror off', {
          from: enabledForFeed,
          to: feed
        })
        disablePartnerVms()
      }
    }
  })

  registerHandler<MirrorStatus>(PARTNER_VMS_CHANNELS.enable, async (payload) => {
    const feed = entitledFeed()
    if (!feed) {
      if (controller.isEnabled()) disablePartnerVms()
      return ok(controller.getStatus())
    }
    const { label, format } = readCamera(payload)
    enabledForFeed = feed
    return ok(await controller.enable(label, format))
  })

  registerHandler<MirrorStatus>(PARTNER_VMS_CHANNELS.disable, () => {
    disablePartnerVms()
    return Promise.resolve(ok(controller.getStatus()))
  })

  registerHandler<MirrorStatus>(PARTNER_VMS_CHANNELS.status, () => Promise.resolve(ok(controller.getStatus())))

  // Keep their page on the same physical camera the recorder uses. Advisory:
  // the shim picks an external webcam on its own regardless.
  registerHandler<{ applied: boolean }>(PARTNER_VMS_CHANNELS.setPreferredCamera, async (payload) => {
    const { label, format } = readCamera(payload)
    try {
      return ok(await controller.setPreferredCamera(label, format))
    } catch (err) {
      logger.warn('[partner-vms] set-camera failed', { detail: err instanceof Error ? err.message : String(err) })
      return ok({ applied: false })
    }
  })

  registerHandler<null>(PARTNER_VMS_CHANNELS.setBounds, (payload) => {
    const rect = sanitiseRect(payload)
    if (rect) controller.setBounds(rect)
    return Promise.resolve(ok(null))
  })

  registerHandler<null>(PARTNER_VMS_CHANNELS.show, () => {
    controller.show()
    return Promise.resolve(ok(null))
  })

  registerHandler<null>(PARTNER_VMS_CHANNELS.hide, () => {
    controller.hide()
    return Promise.resolve(ok(null))
  })

  registerHandler<MirrorOutcome>(PARTNER_VMS_CHANNELS.startMirror, async (payload) => {
    const req = sanitiseRequest(payload)
    if (!req) return ok<MirrorOutcome>({ ok: false, reason: 'error', state: controller.getStatus().state })
    if (!shouldMirror(req.platform) || !entitledFeed()) {
      return ok<MirrorOutcome>({ ok: false, reason: 'disabled', state: controller.getStatus().state })
    }
    const outcome = await controller.startMirror(req)

    if (outcome.ok) {
      logger.info(
        `[${req.awb}] Flipkart VMS is now recording this ${req.orderType} order too, ` +
          `${outcome.autoStarted ? 'started automatically on entry' : 'started by pressing Record'}.`
      )
    } else {
      logger.warn(notMirroredLine(req.awb, outcome))
    }
    return ok(outcome)
  })

  registerHandler<MirrorOutcome>(PARTNER_VMS_CHANNELS.park, async () => {
    const outcome = await controller.park()
    if (!outcome.ok && outcome.reason !== 'disabled') {
      logger.warn(
        `Flipkart VMS is still recording after stop (${outcome.detail ?? outcome.reason ?? 'unknown'}) — ` +
          'press Stop on the Flipkart VMS tab or the next order will be added to this video.'
      )
    }
    return ok(outcome)
  })
}
