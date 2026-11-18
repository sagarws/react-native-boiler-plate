import { normalizeCompressionLevel } from '@shared/vms/compression'
import type { AuthCompany, AuthFeed, AuthUser, AuthUserName, AuthUserPhone } from '@shared/vms/auth'
import type { VmsFeedOption } from '@shared/vms/feeds'

/**
 * The feed-login body → the VMS `AuthUser`, ported verbatim from Argos Watch's
 * `electron/main/services/auth.service.ts`.
 *
 * `POST /auth/feed-token` answers with exactly the `feed-login` body
 * (`{ accessToken, user: { feedId, feed, company{…} } }`), so the mapping is
 * Argos' own — every renderer screen ported from Argos reads the same shape.
 * Pure (no Electron), so it is unit-tested directly.
 */

interface WireUserName {
  firstName?: string
  lastName?: string
  fullName?: string
}

interface WireUserPhone {
  code?: string
  number?: string
  countryCode?: string
}

interface WireFeed {
  _id?: string
  feedName?: string
  isDisable?: boolean
  isDeleted?: boolean
  isSelectedFeed?: boolean
  cameraType?: string
  rtspURL?: string
  companyId?: string
  createdBy?: string
  createdAt?: string
  updatedAt?: string
  onvif_username?: string
  onvif_password?: string
  onvif_ip?: string
  isAllowCameraDateChange?: boolean
}

interface WireCompanyPlatform {
  id?: string
  _id?: string
  name?: string
  isActive?: boolean
}

interface WireCompanyMultiStepFeed {
  feedId?: string
  _id?: string
  step?: number
  date?: string
}

interface WireCompanyMultiStepRecording {
  mode?: boolean
  feedIds?: WireCompanyMultiStepFeed[]
  totalFeed?: number
}

interface WireCompanyDesktopAppResolution {
  asPerCamera?: boolean
  resolution?: string
}

interface WireCompany {
  id?: string
  _id?: string
  name?: string
  ecommercePlatform?: WireCompanyPlatform[]
  compressPercentage?: string | number
  returnConditionPopup?: {
    isShow?: boolean
    isRedirectOnBad?: boolean
  }
  // Nested under `settings` on the canonical payload; a flat copy is tolerated.
  multiStepRecording?: WireCompanyMultiStepRecording
  desktopAppResolution?: WireCompanyDesktopAppResolution
  settings?: {
    multiStepRecording?: WireCompanyMultiStepRecording
    desktopAppResolution?: WireCompanyDesktopAppResolution
  }
}

export interface WireLoginUser {
  id?: string
  _id?: string
  email?: string
  name?: WireUserName
  phone?: WireUserPhone
  feedId?: string
  feed?: WireFeed
  companyId?: string
  company?: WireCompany
  /** Resolved server-side (company setting + feed override); TrackVid-App reads it off the user. */
  partnerVmsEnabled?: boolean
}

export interface WireLoginData {
  accessToken?: string
  user?: WireLoginUser
}

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

const toName = (name: WireUserName | undefined): AuthUserName => {
  const firstName = text(name?.firstName)
  const lastName = text(name?.lastName)
  const fullName = text(name?.fullName) || [firstName, lastName].filter(Boolean).join(' ')
  return { firstName, lastName, fullName }
}

const toPhone = (phone: WireUserPhone | undefined): AuthUserPhone => ({
  code: text(phone?.code),
  number: text(phone?.number),
  countryCode: text(phone?.countryCode)
})

const EMPTY_FEED: AuthFeed = {
  _id: '',
  feedName: '',
  isDisable: false,
  isDeleted: false,
  isSelectedFeed: false,
  cameraType: '',
  rtspURL: '',
  companyId: '',
  createdBy: '',
  createdAt: '',
  updatedAt: ''
}

const toFeed = (feed: WireFeed | undefined): AuthFeed => {
  if (!feed) return { ...EMPTY_FEED }
  return {
    _id: text(feed._id),
    feedName: text(feed.feedName),
    isDisable: feed.isDisable === true,
    isDeleted: feed.isDeleted === true,
    isSelectedFeed: feed.isSelectedFeed === true,
    cameraType: text(feed.cameraType),
    rtspURL: text(feed.rtspURL),
    companyId: text(feed.companyId),
    createdBy: text(feed.createdBy),
    createdAt: text(feed.createdAt),
    updatedAt: text(feed.updatedAt),
    ...(feed.onvif_username !== undefined && { onvif_username: text(feed.onvif_username) }),
    ...(feed.onvif_password !== undefined && { onvif_password: text(feed.onvif_password) }),
    ...(feed.onvif_ip !== undefined && { onvif_ip: text(feed.onvif_ip) }),
    ...(feed.isAllowCameraDateChange !== undefined && {
      isAllowCameraDateChange: feed.isAllowCameraDateChange === true
    })
  }
}

const EMPTY_COMPANY: AuthCompany = {
  id: '',
  name: '',
  ecommercePlatform: [],
  compressPercentage: 'similar',
  returnConditionPopup: { isShow: false, isRedirectOnBad: false }
}

const toCompany = (company: WireCompany | undefined): AuthCompany => {
  if (!company) return { ...EMPTY_COMPANY, ecommercePlatform: [] }
  // Mode-off / missing config resolves to undefined: the recorder treats that
  // as single-shot (no trackingId suffix).
  const rawMultiStep = company.settings?.multiStepRecording ?? company.multiStepRecording
  const multiStepRecording =
    rawMultiStep && rawMultiStep.mode === true
      ? {
          mode: true,
          totalFeed: typeof rawMultiStep.totalFeed === 'number' ? rawMultiStep.totalFeed : 0,
          feedIds: Array.isArray(rawMultiStep.feedIds)
            ? rawMultiStep.feedIds
                .map((f) => ({
                  feedId: text(f.feedId) || text(f._id),
                  step: typeof f.step === 'number' ? f.step : 0
                }))
                .filter((f) => f.feedId && f.step > 0)
            : []
        }
      : undefined

  // Same nested/flat fallback. Absent = the recorder's 1280x720 default.
  const rawResolution = company.settings?.desktopAppResolution ?? company.desktopAppResolution
  const resolution =
    rawResolution && typeof rawResolution.resolution === 'string' && rawResolution.resolution.trim() !== ''
      ? rawResolution.resolution.trim()
      : undefined

  return {
    id: text(company.id) || text(company._id),
    name: text(company.name),
    ecommercePlatform: Array.isArray(company.ecommercePlatform)
      ? company.ecommercePlatform.map((platform) => ({
          id: text(platform.id) || text(platform._id),
          name: text(platform.name),
          isActive: platform.isActive === true
        }))
      : [],
    compressPercentage: normalizeCompressionLevel(company.compressPercentage),
    returnConditionPopup: {
      isShow: company.returnConditionPopup?.isShow === true,
      isRedirectOnBad: company.returnConditionPopup?.isRedirectOnBad === true
    },
    ...(multiStepRecording ? { multiStepRecording } : {}),
    ...(rawResolution
      ? {
          desktopAppResolution: {
            asPerCamera: rawResolution.asPerCamera === true,
            ...(resolution ? { resolution } : {})
          }
        }
      : {})
  }
}

export const toAuthUser = (user: WireLoginUser): AuthUser => {
  const name = toName(user.name)
  const email = text(user.email)
  return {
    id: text(user.id) || text(user._id),
    email,
    name,
    phone: toPhone(user.phone),
    feedId: text(user.feedId),
    feed: toFeed(user.feed),
    companyId: text(user.companyId),
    company: toCompany(user.company),
    displayName: name.fullName || email,
    partnerVmsEnabled: user.partnerVmsEnabled === true
  }
}

/** The feed-login body → token + user, or null when either is missing. */
export const parseFeedLogin = (data: WireLoginData | null | undefined): { token: string; user: AuthUser } | null => {
  const token = text(data?.accessToken)
  const apiUser = data?.user
  if (!token || !apiUser || typeof apiUser !== 'object') return null
  return { token, user: toAuthUser(apiUser) }
}

interface WireCommonFeed {
  _id?: unknown
  feedName?: unknown
  isDisable?: unknown
  isDeleted?: unknown
}

/** `GET /feed/common-feed` rows → picker options. Deleted rows are dropped. */
export const toFeedOptions = (rows: unknown): VmsFeedOption[] => {
  if (!Array.isArray(rows)) return []
  return (rows as WireCommonFeed[])
    .filter((row) => row && typeof row === 'object' && row.isDeleted !== true)
    .map((row) => ({ id: text(row._id), name: text(row.feedName), disabled: row.isDisable === true }))
    .filter((row) => row.id.length > 0)
}

/**
 * The 409 station-lock answer of `/auth/feed-token`:
 * `{ data: { feedName, alreadyLoggedIn: true } }`. Null for anything else.
 */
export const readAlreadyLoggedIn = (status: number, body: unknown): { feedName: string } | null => {
  if (status !== 409 || !body || typeof body !== 'object') return null
  const data = (body as { data?: unknown }).data
  if (!data || typeof data !== 'object') return null
  const flagged = (data as { alreadyLoggedIn?: unknown }).alreadyLoggedIn === true
  if (!flagged) return null
  return { feedName: text((data as { feedName?: unknown }).feedName) }
}
