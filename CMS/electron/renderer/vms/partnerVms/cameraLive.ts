import type { CameraFormat } from '@shared/vms/partnerVms'
import { partnerVmsClient } from './partnerVmsClient'

/**
 * Whether the recorder's own camera is open yet, and which camera / format it
 * is — TrackVid-App's markCameraLive / whenCameraLive (53b8751, 9085246).
 *
 * The mirror waits for this before starting, so the app opens the device first
 * and their page joins the format already open (Windows gives every later
 * consumer of a webcam the format that is open), and so the camera label is
 * right the first time — a stale label meant reloading their page, costing the
 * seller the feed connection they had set up by hand.
 *
 * The wait is capped: a seller who goes straight to the Flipkart tab never
 * opens the packing camera, and nothing may gate the mirror for good.
 */

/** The last camera the recorder opened, remembered across restarts (label only). */
const CAMERA_LABEL_KEY = 'trackvid.vms.partnerVms.cameraLabel'

export const CAMERA_WAIT_MS = 12_000

export interface LiveCamera {
  label: string | null
  format: CameraFormat | null
}

export const readCameraLabel = (): string | null => {
  try {
    return localStorage.getItem(CAMERA_LABEL_KEY)
  } catch {
    return null
  }
}

const live: { ready: boolean } & LiveCamera = { ready: false, label: null, format: null }
const waiters = new Set<(cam: LiveCamera) => void>()
let lastSent: string | null = null

/**
 * Remember the camera and tell the mirror about it (their page reloads onto it
 * unless it is recording). Sent only when it actually changed.
 */
const rememberCamera = (label: string | null, format: CameraFormat | null): void => {
  if (!label) return
  try {
    localStorage.setItem(CAMERA_LABEL_KEY, label)
  } catch {
    /* storage unavailable — the shim falls back to its own pick */
  }
  const key = JSON.stringify([label, format])
  if (key === lastSent) return
  lastSent = key
  void partnerVmsClient.setCamera(label, format)
}

/** Called by the webcam recorder the moment its own stream is open. */
export const markCameraLive = (label: string | null, format: CameraFormat | null): void => {
  live.ready = true
  if (label) live.label = label
  if (format) live.format = format
  rememberCamera(live.label, live.format)
  const waiting = [...waiters]
  waiters.clear()
  waiting.forEach((fn) => fn({ label: live.label, format: live.format }))
}

/** Forget the live camera when the recorder goes away, so a later mount waits again. */
export const markCameraGone = (): void => {
  live.ready = false
}

/** The camera known right now, without waiting. */
export const currentCamera = (): LiveCamera => ({ label: live.label ?? readCameraLabel(), format: live.format })

/** Resolve once the recorder's camera is open — but never block forever. */
export const whenCameraLive = (timeoutMs: number = CAMERA_WAIT_MS): { promise: Promise<LiveCamera>; cancel: () => void } => {
  let settled = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let fire: (cam: LiveCamera) => void = () => undefined

  const promise = new Promise<LiveCamera>((resolve) => {
    fire = (cam: LiveCamera): void => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      waiters.delete(fire)
      resolve({ label: cam.label ?? readCameraLabel(), format: cam.format })
    }
    if (live.ready) {
      fire({ label: live.label, format: live.format })
      return
    }
    waiters.add(fire)
    timer = setTimeout(() => {
      if (!settled) {
        console.warn(`[partner-vms] the recorder's camera is still not open after ${timeoutMs}ms — starting the mirror anyway`)
      }
      fire(currentCamera())
    }, timeoutMs)
  })

  return {
    promise,
    cancel: () => {
      settled = true
      if (timer) clearTimeout(timer)
      waiters.delete(fire)
    }
  }
}
