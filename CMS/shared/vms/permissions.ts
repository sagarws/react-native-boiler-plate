/**
 * OS-level camera and microphone access.
 *
 * Distinct from Electron's own permission handler (main.ts allows `media` for
 * every window): that only decides whether Chromium asks the OS at all. When
 * macOS or Windows has the app blocked in its privacy settings, getUserMedia
 * still rejects with NotAllowedError and nothing in the app can override it -
 * the operator has to grant it, so the app has to ask.
 */

export type MediaPermissionKind = 'camera' | 'microphone'

/**
 * Mirrors Electron's systemPreferences.getMediaAccessStatus, plus 'unknown'
 * for platforms with no such API (Linux) where the app must not block.
 */
export type MediaPermissionStatus =
  | 'granted'
  | 'denied'
  | 'restricted'
  | 'not-determined'
  | 'unknown'

export interface MediaPermissionSnapshot {
  camera: MediaPermissionStatus
  microphone: MediaPermissionStatus
  /**
   * The OS can show an in-app consent prompt (macOS). Where it cannot
   * (Windows), the only route is the system settings deep link below.
   */
  canPrompt: boolean
  /** A privacy-settings deep link exists for this OS. */
  canOpenSettings: boolean
}
