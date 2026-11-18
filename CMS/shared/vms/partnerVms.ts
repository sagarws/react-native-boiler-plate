/**
 * The Flipkart VMS mirror ("partner VMS") — the parts main and renderer share.
 *
 * Ported from TrackVid-App @ c188745 (PR #182, src/main/partnerVms/types.ts and
 * flowConfig.ts). The seller keeps using Flipkart's own VMS page; it runs inside
 * the app as a main-owned WebContentsView, because Windows will not let two
 * separate processes share one webcam. The app drives four controls on that
 * page and reads one signal; login, feed connect and retries stay with the
 * seller.
 *
 * Switched on per feed session: the feed-login body carries one resolved
 * boolean, `user.partnerVmsEnabled` (see electron/main/vms/feedLogin.mapping.ts).
 */

/**
 * Derived by probing the page every few seconds — never remembered from what we
 * last did. If the page and our memory disagree, the page is right.
 */
export type MirrorState =
  | 'DISABLED' // company switch off, or no view
  | 'BOOTING' // view created, page not loaded / not settled yet
  | 'LOGGED_OUT' // seller needs to log in on the tab
  | 'WRONG_SCREEN' // logged in, but on another page of their app
  | 'NOT_CONNECTED' // logged in, but no feed connected
  | 'READY' // operator screen up, idle, safe to mirror
  | 'MIRRORING' // a recording is in flight on their side
  | 'DEGRADED' // page no longer matches the flow config — hands off

export const MIRROR_STATES: readonly MirrorState[] = [
  'DISABLED',
  'BOOTING',
  'LOGGED_OUT',
  'WRONG_SCREEN',
  'NOT_CONNECTED',
  'READY',
  'MIRRORING',
  'DEGRADED'
]

/**
 * The video format the app's own camera is running at, so their page can ask
 * for exactly the same one. Windows will not open one webcam twice at two
 * different formats, and asking for nothing gets the browser's 640x480 default,
 * which then drags every consumer of the device down to it.
 */
export interface CameraFormat {
  width?: number
  height?: number
  frameRate?: number
}

export interface MirrorStatus {
  state: MirrorState
  /** Which required selectors failed to resolve — populated when DEGRADED. */
  missing?: string[] | undefined
  configVersion: number
  lastError?: string | undefined
  lastProbeAt?: number | undefined
}

export const MIRROR_IDLE: MirrorStatus = { state: 'DISABLED', configVersion: 0 }

export interface MirrorRequest {
  awb: string
  /** 'Forward' | 'Return' (| 'RTO') as the recorder knows it. */
  orderType: string
  /** Normalised platform, already checked to be flipkart or myntra. */
  platform: string
}

export type MirrorFailureReason =
  | 'disabled'
  | 'not_ready'
  | 'wrong_route'
  | 'degraded'
  | 'selector_missing'
  | 'no_input_event'
  | 'record_not_started'
  /** Skipped on purpose: a later order arrived before this one reached the page. */
  | 'superseded'
  | 'error'

export interface MirrorOutcome {
  ok: boolean
  /** Set when ok is false — why the order was not mirrored. */
  reason?: MirrorFailureReason | undefined
  state: MirrorState
  /** True when the page began recording on AWB entry with no click needed. */
  autoStarted?: boolean | undefined
  detail?: string | undefined
}

export interface ViewRect {
  x: number
  y: number
  width: number
  height: number
}

/** `enable` / `setPreferredCamera` input. */
export interface MirrorCameraInput {
  cameraLabel?: string | null
  format?: CameraFormat | null
}

/** Platforms that trigger a mirror. Everything else records in TrackVid only. */
export const MIRRORED_PLATFORMS: ReadonlySet<string> = new Set(['flipkart', 'myntra'])

export const normalisePlatform = (value?: string | null): string => (value ?? '').trim().toLowerCase()

/**
 * Match on words, not on the whole string.
 *
 * The platform name is whatever the company configured on the backend, and it
 * is not always the bare brand: 'Myntra PPMP', 'Flipkart Forward' and
 * 'MYNTRA (M-Now)' are all real shapes. Splitting on non-letters and matching
 * any single word covers every variant without matching a platform that merely
 * contains the letters. One function for main and renderer, so the two cannot
 * drift (TrackVid-App kept two copies "in step" by comment).
 */
export const shouldMirror = (platform?: string | null): boolean =>
  normalisePlatform(platform)
    .split(/[^a-z]+/)
    .some((word) => MIRRORED_PLATFORMS.has(word))

/**
 * A renderer-sent rect, checked. Null for anything that is not four finite
 * numbers with a positive size — main never positions the view from junk.
 */
export const sanitiseRect = (input: unknown): ViewRect | null => {
  if (!input || typeof input !== 'object') return null
  const { x, y, width, height } = input as Record<string, unknown>
  const nums = [x, y, width, height]
  if (!nums.every((n) => typeof n === 'number' && Number.isFinite(n))) return null
  const rect = {
    x: Math.round(x as number),
    y: Math.round(y as number),
    width: Math.round(width as number),
    height: Math.round(height as number)
  }
  if (rect.width <= 0 || rect.height <= 0) return null
  return rect
}

/** Hidden means OFF-SCREEN AT FULL SIZE, never 0x0 (see the controller). */
export const OFFSCREEN_X = -20000

/**
 * Where the native view is drawn: the published rect while shown, the same
 * size pushed off-screen while hidden. A zero-area or removed view is an
 * occlusion signal that lets Chromium throttle their page — which stops their
 * recording while everything still looks fine.
 */
export const placeView = (rect: ViewRect, visible: boolean): ViewRect => ({
  x: visible ? rect.x : OFFSCREEN_X,
  y: rect.y,
  width: Math.max(1, rect.width),
  height: Math.max(1, rect.height)
})

/** A camera format from the renderer, checked; null when nothing usable. */
export const sanitiseFormat = (input: unknown): CameraFormat | null => {
  if (!input || typeof input !== 'object') return null
  const raw = input as Record<string, unknown>
  const pick = (v: unknown): number | undefined =>
    typeof v === 'number' && Number.isFinite(v) && v > 0 && v < 10_000 ? Math.round(v) : undefined
  const width = pick(raw.width)
  const height = pick(raw.height)
  const frameRate = pick(raw.frameRate)
  if (!width || !height) return null
  return { width, height, ...(frameRate ? { frameRate } : {}) }
}

/** A camera label from the renderer: a non-empty string, else null. */
export const sanitiseLabel = (input: unknown): string | null =>
  typeof input === 'string' && input.trim() ? input.trim().slice(0, 256) : null

/** A mirror request from the renderer, checked. */
export const sanitiseRequest = (input: unknown): MirrorRequest | null => {
  if (!input || typeof input !== 'object') return null
  const raw = input as Record<string, unknown>
  const awb = typeof raw.awb === 'string' ? raw.awb.trim() : ''
  if (!awb || awb.length > 128) return null
  const orderType = typeof raw.orderType === 'string' && raw.orderType.trim() ? raw.orderType.trim() : 'Forward'
  const platform = typeof raw.platform === 'string' ? normalisePlatform(raw.platform) : ''
  return { awb, orderType, platform }
}
