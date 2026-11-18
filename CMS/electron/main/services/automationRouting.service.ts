import type { Result } from '@shared/types/result'
import { fail, ok } from '@shared/types/result'
import { apiRequest } from './httpClient'
import { getAccessToken } from './session.store'
import { logger } from './logger'
import { withOfflineCache } from './offlineCache'
import { platformKey } from '@shared/utils/platformKey'
import { rememberAutoLogin } from './company.service'
import { rememberAutoLoginSettings } from './signInPolicy'

/**
 * Which automations this company runs on THIS machine.
 *
 * `settings.desktopExecution.<platform>.<automation>` is the switch. When it is
 * on, the desktop app owns that automation end to end — it captures the session
 * in its own browser and runs the flow from @trackvid/automation-core locally,
 * with no involvement from the Automated-Scripts server.
 *
 * When it is off, this app does not automate that platform at all. The server
 * does, and the desktop app is only a window onto the result. Offering an action
 * here for an automation routed to the server would mean two machines filing the
 * same claim.
 *
 * Cached briefly: several screens ask the same question while rendering, and the
 * answer cannot change without someone editing it in Monitor.
 */

const CACHE_TTL_MS = 60_000

export type AutomationType = 'claim' | 'masterImport' | 'ticketDownload'

type RoutingMap = Record<string, Record<string, boolean>>

interface RoutingResponse {
  desktopExecution?: RoutingMap
  apiBasedAutomation?: RoutingMap
  masterImportSyncTime?: unknown
  /** Flat `{ <platform>: boolean }` — one flag per platform, not per automation. */
  isAutoLoginOnActiveSession?: Record<string, boolean>
  platformAutomations?: Record<string, string[]>
  /** The build this company last reported. "" until an app has reported one. */
  cmsAppVersion?: string
  /**
   * Whether this company has accepted the responsible-use notice. Anything
   * other than an explicit true means it is still asked — see terms.service.
   */
  cmsTermsAgreed?: boolean
}

let cache: { at: number; data: RoutingResponse } | null = null

export const clearRoutingCache = (): void => {
  cache = null
}

const load = async (): Promise<Result<RoutingResponse>> => {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return ok(cache.data)

  const token = getAccessToken()

  if (!token) return fail('VALIDATION_ERROR', 'Sign in to read automation routing')

  // The company-scoped read, NOT the system-admin one of the same name. That
  // one is adminOnly, so an operator's token got a 403 and every routing
  // question fell back to its default — desktop execution read as "the server
  // owns it" and no claim was ever processed here, silently. This endpoint
  // returns the identical DTO for the caller's own company.
  // Cached: this decides which platforms auto-login and when imports run, and
  // an operator offline should keep the answer they had rather than fall back
  // to defaults that quietly change behaviour.
  const response = await withOfflineCache('automation-routing', () =>
    apiRequest<RoutingResponse>('/cms/automation-routing', { token })
  )

  if (!response.success) return response

  cache = { at: Date.now(), data: response.data ?? {} }
  // The synchronous copy the sign-in gates read — see signInPolicy.
  rememberAutoLoginSettings(cache.data.isAutoLoginOnActiveSession)

  return ok(cache.data)
}

export const routing = load

/**
 * Does this machine own this automation?
 *
 * Defaults to **false** on any doubt — an unset flag, an unreachable server, a
 * platform the response did not mention. The server is the default owner, so a
 * wrong `false` means the work still happens; a wrong `true` means two machines
 * do it at once.
 */
/**
 * Platforms whose claim has no server runner at all.
 *
 * MIRRORS TrackVid-BE's `DESKTOP_ONLY_CLAIM_PLATFORMS`, which is the source of
 * truth — the two decide the same thing from opposite ends, and a platform on
 * one list and not the other is a claim dispatched here and refused here.
 *
 * Tata CliQ is the one: its portal is behind Cloudflare, every call has to come
 * from inside a logged-in page, and the server has no runner for it.
 */
const DESKTOP_ONLY_CLAIM_PLATFORMS = new Set(['tatacliq'])

export const runsHere = async (platform: string, automation: AutomationType): Promise<boolean> => {
  const response = await load()

  if (!response.success) {
    logger.warn(`Could not read automation routing; treating ${platform}.${automation} as server-run`)

    return false
  }

  const value = response.data.desktopExecution?.[platformKey(platform)]?.[automation]

  if (typeof value === 'boolean') return value

  // NOTHING STORED. For almost everything that means the server — it has run
  // those claims since before this app existed. For a platform whose claim
  // exists ONLY here it means the opposite: the server has no runner to fall
  // back to, so "not set" cannot be read as "not here" without the claim going
  // nowhere. The dispatch defaults the same way (TrackVid-BE's
  // DESKTOP_ONLY_CLAIM_PLATFORMS), and the two have to agree or a claim is
  // handed over by one side and declined by the other.
  return DESKTOP_ONLY_CLAIM_PLATFORMS.has(platformKey(platform)) && automation === 'claim'
}

/**
 * Platforms whose named automation this machine owns, AND whether we actually
 * know.
 *
 * `platformsRunningHere` below answers `[]` both when the company has routed
 * nothing here and when the lookup failed, and the caller cannot tell those
 * apart. For deciding whether to run something that is the right answer — on
 * any doubt, the server owns it. For telling an OPERATOR why a button is
 * disabled it is not: "your administrator routed this to the server" and "we
 * could not reach TrackVid to find out" need different actions from them.
 */
export const claimRoutingSnapshot = async (
  automation: AutomationType
): Promise<{ known: boolean; platforms: string[] }> => {
  const response = await load()

  if (!response.success) return { known: false, platforms: [] }

  return {
    known: true,
    platforms: Object.entries(response.data.desktopExecution ?? {})
      .filter(([, automations]) => automations?.[automation] === true)
      .map(([platform]) => platform)
  }
}

/** Platforms whose named automation this machine owns. */
export const platformsRunningHere = async (automation: AutomationType): Promise<string[]> => {
  const response = await load()

  if (!response.success) return []

  return Object.entries(response.data.desktopExecution ?? {})
    .filter(([, automations]) => automations?.[automation] === true)
    .map(([platform]) => platform)
}

/**
 * Should re-capturing this platform's session sign in by script?
 *
 * Defaults to **true** on any doubt, the opposite of `runsHere`. The stakes are
 * reversed: a wrong `false` here just shows the operator the manual sign-in
 * window they used to get anyway, while a wrong `false` for desktop execution
 * would leave a claim unfiled. And a scripted attempt that cannot proceed falls
 * back to that same window, so there is no outcome worse than today's.
 *
 * The backend gates the password endpoint on the same flag, so this is a hint
 * about which path to take, never the security boundary.
 */
export const autoLoginEnabled = async (platform: string): Promise<boolean> => {
  const response = await load()

  // FAILS CLOSED. Unreadable settings used to answer "on", so a network hiccup
  // was enough to turn a scripted sign-in on for a platform the company had
  // set to manual. Off is the safe reading: a person signs in instead.
  if (!response.success) {
    logger.warn(`Could not read automatic sign-in for ${platform}; treating it as off`)

    return false
  }

  const value = response.data.isAutoLoginOnActiveSession?.[platformKey(platform)]

  return value !== false
}

/**
 * The flow a platform uses when nothing has been configured.
 *
 * MUST MATCH `DEFAULT_API_FLOW` in @trackvid/automation-core. The two runners
 * disagreeing about an unset company is exactly the Snapdeal bug described
 * below — the desktop on one flow, the server on the other, same settings.
 */
const DEFAULT_API_FLOW: Record<string, boolean> = {
  ajio: true
}

/**
 * Which flow a platform's automation uses — API, or driving the portal's UI.
 *
 * Defaults PER PLATFORM when the company has not set it, matching
 * `DEFAULT_API_FLOW` in @trackvid/automation-core. That function reads the
 * company setting, then a legacy `<PLATFORM>_APIBASE_AUTOMATION` env var, then
 * the platform's own default.
 *
 * Script for everything except AJIO. AJIO's script flow drives a portal it
 * rebuilt as the "Seller Central" SPA and no longer completes — a run dies on
 * `button.MuiButton-containedPrimary` after ten seconds — so defaulting it to
 * script is defaulting it to a known failure.
 *
 * THE MAP IS DUPLICATED HERE, and the duplication is stated rather than hidden:
 * this service cannot load the core (it answers from the routing endpoint, not
 * from Mongo). Changing one means changing both, and the pair is asserted in
 * tests/automationRoutingDefault.test.ts.
 *
 * This defaulted to TRUE and that was a real bug: a company with the setting
 * unset had its Snapdeal master import run on the API flow here and the script
 * flow on the server. The two are not interchangeable —
 * `/report/generateReport` answers 500 for accounts whose reports the portal UI
 * produces perfectly well — so the desktop failed while the server succeeded,
 * on identical configuration.
 *
 * The legacy env var is deliberately NOT consulted here. It is a server
 * operational control; a desktop app must not pick up a flow from an
 * environment variable an operator cannot see. Where it matters, the company
 * setting should be set explicitly — which is also what makes both consumers
 * agree.
 */
export const usesApiFlow = async (platform: string, automation: AutomationType): Promise<boolean> => {
  const response = await load()

  // A routing read that failed says nothing about the company's intent, so it
  // must not be read as "script". The platform's default is the same answer an
  // unset company gets, which is the behaviour this whole function describes.
  if (!response.success) return DEFAULT_API_FLOW[platformKey(platform)] === true

  const set = response.data.apiBasedAutomation?.[platformKey(platform)]?.[automation]

  if (typeof set === 'boolean') return set

  return DEFAULT_API_FLOW[platformKey(platform)] === true
}

/**
 * Turn automatic sign-in on or off for one platform of this company —
 * `settings.isAutoLoginOnActiveSession.<platform>`, the same flag Monitor sets.
 *
 * The operator's way out when a platform's scripted sign-in keeps failing (an
 * OTP that never arrives, a captcha): switch it to Manual, sign in by hand.
 * The cache is dropped so the next read — the Login page, the nightly run —
 * sees the new value at once rather than up to a minute later.
 */
export const setAutoLogin = async (payload: unknown): Promise<Result<{ platform: string; enabled: boolean }>> => {
  const input = (payload ?? {}) as { platform?: unknown; enabled?: unknown }
  const platform = typeof input.platform === 'string' ? platformKey(input.platform) : ''

  if (!platform) return fail('VALIDATION_ERROR', 'Choose a platform')
  if (typeof input.enabled !== 'boolean') return fail('VALIDATION_ERROR', 'Choose on or off')

  const token = getAccessToken()

  if (!token) return fail('VALIDATION_ERROR', 'Sign in to change automatic sign-in')

  const response = await apiRequest<{ platform: string; enabled: boolean }>(
    '/cms/automation-routing/auto-login',
    { method: 'PUT', token, body: { platform, enabled: input.enabled } }
  )

  clearRoutingCache()

  if (!response.success) return response

  // The company record this machine keeps (Settings → Company data) carries
  // the same flag; without this it showed the old value until a full refresh.
  await rememberAutoLogin(platform, input.enabled)

  return ok({ platform, enabled: input.enabled })
}
