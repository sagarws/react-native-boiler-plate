/**
 * Authentication types shared by main, preload and renderer.
 *
 * The TrackVid API returns a nested user document (name.firstName, phone.code,
 * feed.rtspURL, company.ecommercePlatform, ...). It is flattened into AuthUser
 * inside the main process only for renderer-friendly summary access. The full
 * nested payload is preserved as `raw` because feature code (feed selection,
 * marketplace CMS pages, camera preferences) needs the nested fields verbatim.
 */

import type { CompressionLevel } from '@shared/vms/compression'

export interface AuthUserName {
  firstName: string
  lastName: string
  fullName: string
}

export interface AuthUserPhone {
  code: string
  number: string
  countryCode: string
}

export interface AuthFeed {
  _id: string
  feedName: string
  isDisable: boolean
  isDeleted: boolean
  isSelectedFeed: boolean
  cameraType: string
  rtspURL: string
  companyId: string
  createdBy: string
  createdAt: string
  updatedAt: string
  onvif_username?: string
  onvif_password?: string
  onvif_ip?: string
  isAllowCameraDateChange?: boolean
}

export interface AuthCompanyEcommercePlatform {
  id: string
  name: string
  isActive: boolean
}

/**
 * Multi-step recording config, mirrored from
 * `Company.settings.multiStepRecording` on the backend.
 *
 * When `mode` is true, one AWB is recorded across several feeds ("steps").
 * Each feed uploads under `{AWB}_S{step}` and the backend merges them
 * once all `totalFeed` steps arrive. `feedIds[i].step` maps a feed to
 * its step number; the recorder looks up the CURRENT session's feedId
 * in this list to decide what suffix to apply.
 *
 * Absent = feature off (behaves exactly like a normal single-shot flow).
 */
export interface AuthCompanyMultiStepFeed {
  feedId: string
  step: number
}

export interface AuthCompanyMultiStepRecording {
  mode: boolean
  feedIds: AuthCompanyMultiStepFeed[]
  totalFeed: number
}

/**
 * Recording resolution the desktop app should ask getUserMedia for.
 * Mirrored from `Company.settings.desktopAppResolution` on the backend.
 *
 *   asPerCamera=true   → App asks for the camera's highest supported
 *                        resolution (ideal 4K constraint). `resolution`
 *                        is preserved for a later toggle-off but ignored.
 *   asPerCamera=false  → App pins to `resolution` (e.g. "1280x720"). If
 *                        `resolution` is missing/malformed, the recorder
 *                        falls back to 1280x720.
 *
 * Absent = the recorder uses its own 1280x720 default.
 */
export interface AuthCompanyDesktopAppResolution {
  asPerCamera: boolean
  resolution?: string
}

export interface AuthCompany {
  id: string
  name: string
  ecommercePlatform: AuthCompanyEcommercePlatform[]
  compressPercentage: CompressionLevel
  returnConditionPopup: {
    isShow: boolean
    isRedirectOnBad: boolean
  }
  multiStepRecording?: AuthCompanyMultiStepRecording
  desktopAppResolution?: AuthCompanyDesktopAppResolution
}

export interface AuthUser {
  id: string
  email: string
  name: AuthUserName
  phone: AuthUserPhone
  feedId: string
  feed: AuthFeed
  companyId: string
  company: AuthCompany
  /** Convenience field. Preserved from name.fullName, falls back to email. */
  displayName: string
  /**
   * Flipkart VMS mirror switched on for this desk — one boolean the server
   * resolves from the company setting and any per-feed override
   * (shared/vms/partnerVms.ts). Absent or false = off.
   */
  partnerVmsEnabled?: boolean
}

/**
 * The three fields the feed-login form collects. `companyEmail` identifies the
 * tenant, `userId` identifies the operator, `password` authenticates them.
 */
export interface LoginInput {
  companyEmail: string
  userId: string
  password: string
}

/** Payload for the pre-login liveness check. */
export interface CheckAlreadyLoginInput {
  userId: string
}

export interface CheckAlreadyLoginResult {
  /** true = safe to proceed, false = another packing station holds the feed. */
  safeToLogin: boolean
  /** Feed name of the current holder, when safeToLogin is false. */
  feedName: string | null
}

/**
 * The renderer's whole view of the session. The access token is deliberately
 * absent: it never leaves the main process.
 */
export interface SessionState {
  authenticated: boolean
  user: AuthUser | null
  /** ISO timestamp of the last successful login, or null when signed out. */
  loggedInAt: string | null
}

export const SIGNED_OUT: SessionState = { authenticated: false, user: null, loggedInAt: null }
