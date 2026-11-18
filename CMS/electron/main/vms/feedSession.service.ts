import { app } from 'electron'
import { VMS_EVENTS } from '@shared/constants/channels'
import { fail, ok, type Result } from '@shared/types/result'
import type { AuthUser, SessionState } from '@shared/vms/auth'
import { SIGNED_OUT } from '@shared/vms/auth'
import type { SelectFeedResult, VmsFeedOption } from '@shared/vms/feeds'
import { env } from '../config/env'
import { broadcast } from '../ipc/broadcast'
import { apiRequest } from '../services/httpClient'
import { logger } from '../services/logger'
import { getAccessToken, getSession } from '../services/session.store'
import { parseFeedLogin, readAlreadyLoggedIn, toFeedOptions, type WireLoginData } from './feedLogin.mapping'

/**
 * The VMS feed session (VMS_MERGE_PLAN.md §1–2).
 *
 * The CMS login is the only login. An admin picks a feed; this service asks
 * `POST /auth/feed-token` (admin token) for that feed's session and holds the
 * returned FeedUser token IN MEMORY ONLY — never persisted, never sent to the
 * renderer. It is given back (`/auth/feed-logout`) on feed switch, on CMS
 * sign-out and on quit.
 */

interface FeedSession {
  token: string
  user: AuthUser
  feedId: string
  loggedInAt: string
}

let current: FeedSession | null = null

/** Serialises select / release so two clicks cannot interleave a switch. */
let chain: Promise<unknown> = Promise.resolve()
const serial = <T>(work: () => Promise<T>): Promise<T> => {
  const run = chain.then(work)
  chain = run.catch(() => undefined)
  return run
}

const listeners = new Set<(held: boolean) => void>()

/** Main-process subscribers (the upload driver) learn when a feed is taken or dropped. */
export const onFeedSessionChange = (listener: (held: boolean) => void): (() => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

const toState = (): SessionState =>
  current ? { authenticated: true, user: current.user, loggedInAt: current.loggedInAt } : SIGNED_OUT

const publish = (): void => {
  broadcast(VMS_EVENTS.feedSessionChanged, toState())
  for (const listener of listeners) {
    try {
      listener(current !== null)
    } catch (error) {
      logger.warn('[vms] feed-session listener failed', error)
    }
  }
}

/** Token + user for the upload driver and the read-only VMS calls. Never crosses IPC. */
export const getFeedSession = (): Readonly<FeedSession> | null => current

export const currentFeedSession = (): Promise<Result<SessionState>> => Promise.resolve(ok(toState()))

/**
 * A feed-token call came back 401: the backend no longer honours this feed
 * session (taken over at another desk, expired). Dropped here and announced,
 * so the header picker shows "choose a feed" instead of failing every call.
 */
export const feedTokenRefused = (token: string): void => {
  if (!current || current.token !== token) return
  logger.warn('[vms] feed token refused by the backend; dropping the feed session', { feedId: current.feedId })
  current = null
  publish()
}

/** Feed token if one is held, else the admin token — for read-only calls Argos made with its token. */
export const readToken = (): { token: string; isFeed: boolean } | null => {
  if (current) return { token: current.token, isFeed: true }
  const admin = getAccessToken()
  return admin ? { token: admin, isFeed: false } : null
}

/** Picker list: names and ids only (`GET /feed/common-feed`), never `POST /feed`. */
export const listFeeds = async (): Promise<Result<VmsFeedOption[]>> => {
  const token = getAccessToken()
  if (!token) return fail('VALIDATION_ERROR', 'Sign in to TrackVid first.')
  const response = await apiRequest<unknown>('/feed/common-feed', { token })
  if (!response.success) return response
  return ok(toFeedOptions(response.data))
}

interface RawResponse {
  status: number
  body: unknown
}

/**
 * A JSON POST that hands back the status and the body as they are. `apiRequest`
 * reduces a 409 to its message, and the station-lock answer lives in its
 * `data` — so this one call reads the response itself.
 */
const postRaw = async (path: string, body: unknown, token: string, timeoutMs: number): Promise<RawResponse | null> => {
  try {
    const response = await fetch(`${env.apiUrl}${path}`, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs)
    })
    let parsed: unknown = null
    try {
      parsed = await response.json()
    } catch {
      // Non-JSON body: handled by the status checks of the caller.
    }
    return { status: response.status, body: parsed }
  } catch (error) {
    logger.warn('[vms] request failed', { path, error: error instanceof Error ? error.message : String(error) })
    return null
  }
}

const messageOf = (body: unknown, fallback: string): string => {
  if (body && typeof body === 'object') {
    const envelope = body as { displayMessage?: unknown; message?: unknown }
    if (typeof envelope.displayMessage === 'string' && envelope.displayMessage) return envelope.displayMessage
    if (typeof envelope.message === 'string' && envelope.message) return envelope.message
  }
  return fallback
}

/** Feed-logout, best effort: a failure never blocks dropping the session locally. */
const releaseHeld = async (timeoutMs: number): Promise<void> => {
  const held = current
  if (!held) return
  current = null
  logger.info('[vms] releasing feed', { feedId: held.feedId, userId: held.user.id })
  const response = await postRaw('/auth/feed-logout', { userId: held.user.id }, held.token, timeoutMs)
  if (!response || response.status >= 400) {
    logger.warn('[vms] feed-logout did not succeed; the server falls back to its timeout', {
      status: response?.status ?? null
    })
  }
  publish()
}

const parseSelect = (payload: unknown): { feedId: string; force: boolean } | null => {
  const input = payload as { feedId?: unknown; force?: unknown } | null
  const feedId = typeof input?.feedId === 'string' ? input.feedId.trim() : ''
  if (!/^[a-f0-9]{24}$/i.test(feedId)) return null
  return { feedId, force: input?.force === true }
}

/**
 * Is this answer "the backend has no such route" (as opposed to the route
 * itself refusing)? The feed-token endpoint always answers JSON; a backend
 * without it answers Express's plain-text `Cannot POST …` 404, which parses to
 * no body at all.
 */
const routeMissing = (response: RawResponse): boolean =>
  (response.status === 404 || response.status === 405) &&
  !(response.body && typeof response.body === 'object' && 'isSuccess' in response.body)

type FallbackOutcome =
  | { kind: 'session'; body: unknown }
  | { kind: 'locked'; feedName: string }
  | { kind: 'error'; result: Result<never> }

/**
 * THE FALLBACK — for a backend not yet deployed with `POST /auth/feed-token`
 * (VMS_MERGE_PLAN.md §1; user chose "both": endpoint first, this otherwise).
 *
 * It uses what such a backend already allows an admin: `POST /feed` returns
 * each feed's login (userId + password — a known weakness of that route, see
 * the report), and `feed-login` signs in with it under the admin's own company
 * email. The password is held in this function's locals only: never logged,
 * never stored, never sent to the renderer. Once the endpoint is deployed this
 * path is never taken again.
 *
 * The station lock is kept: `check-already-login` first, unless the operator
 * already confirmed the takeover (`force`).
 */
const takeFeedViaLogin = async (feedId: string, force: boolean, adminToken: string): Promise<FallbackOutcome> => {
  const unreachable: FallbackOutcome = {
    kind: 'error',
    result: fail('INTERNAL_ERROR', 'Cannot reach the TrackVid server. Check your internet connection.')
  }

  const list = await postRaw('/feed', { page: 1, limit: 1000 }, adminToken, env.apiTimeoutMs)
  if (!list) return unreachable
  if (list.status === 401) {
    return { kind: 'error', result: { success: false, error: { code: 'VALIDATION_ERROR', message: messageOf(list.body, 'Your session has ended.'), sessionEnded: true } } }
  }
  if (list.status === 403) {
    return { kind: 'error', result: fail('VALIDATION_ERROR', 'Your account may not open feeds. Ask an admin for the feed permission.') }
  }

  const data = (list.body as { data?: unknown } | null)?.data
  const groups = Array.isArray(data) ? data : data ? [data] : []
  type FeedRow = { _id?: unknown; feedUser?: { userId?: unknown; password?: unknown } | null }
  const feeds: FeedRow[] = groups.flatMap((group): FeedRow[] => {
    const items: unknown = (group as { feed?: unknown } | null)?.feed
    return Array.isArray(items) ? (items as FeedRow[]) : []
  })
  const entry = feeds.find((feed) => typeof feed._id === 'string' && feed._id === feedId)
  const userId = typeof entry?.feedUser?.userId === 'string' ? entry.feedUser.userId : ''
  const password = typeof entry?.feedUser?.password === 'string' ? entry.feedUser.password : ''

  if (!entry) return { kind: 'error', result: fail('NOT_FOUND', 'That feed does not exist in your company.') }
  if (!userId || !password) {
    return { kind: 'error', result: fail('NOT_FOUND', 'This feed has no login yet. Add one in TrackVid first.') }
  }

  if (!force) {
    const check = await postRaw('/auth/check-already-login', { userId }, adminToken, env.apiTimeoutMs)
    if (!check) return unreachable
    const body = check.body as { isSuccess?: unknown; data?: unknown } | null
    if (check.status === 200 && body?.isSuccess === false && typeof body.data === 'string') {
      return { kind: 'locked', feedName: body.data }
    }
  }

  const companyEmail = getSession()?.user.email ?? ''
  const login = await postRaw(
    '/auth/feed-login',
    { companyEmail, userId, password, versionName: app.getVersion() },
    adminToken,
    env.apiTimeoutMs
  )
  if (!login) return unreachable
  const envelope = login.body as { isSuccess?: unknown } | null
  if (login.status < 200 || login.status >= 300 || envelope?.isSuccess === false) {
    const message = messageOf(login.body, 'The feed could not be opened.')
    logger.warn('[vms] feed-login fallback refused', { status: login.status, message })
    return {
      kind: 'error',
      result: fail(
        'VALIDATION_ERROR',
        login.status === 400
          ? 'This feed could not be opened with your account. Feeds can only be opened from the company admin login until the backend is updated.'
          : message
      )
    }
  }

  return { kind: 'session', body: login.body }
}

export const selectFeed = (payload: unknown): Promise<Result<SelectFeedResult>> =>
  serial(async () => {
    const input = parseSelect(payload)
    if (!input) return fail('VALIDATION_ERROR', 'Choose a feed.')

    const adminToken = getAccessToken()
    if (!adminToken) return fail('VALIDATION_ERROR', 'Sign in to TrackVid first.')

    if (current && current.feedId === input.feedId) {
      return ok<SelectFeedResult>({ alreadyLoggedIn: false, session: toState() })
    }

    // Give the current feed back first, so its desk lock is not left behind.
    if (current) await releaseHeld(env.apiTimeoutMs)

    const response = await postRaw(
      '/auth/feed-token',
      { feedId: input.feedId, versionName: app.getVersion(), force: input.force },
      adminToken,
      env.apiTimeoutMs
    )
    if (!response) return fail('INTERNAL_ERROR', 'Cannot reach the TrackVid server. Check your internet connection.')

    // A backend without the endpoint yet: take the feed the older way.
    let sessionBody: unknown = response.body
    if (routeMissing(response)) {
      logger.info('[vms] feed-token not on this backend; using the feed-login fallback', { feedId: input.feedId })
      const outcome = await takeFeedViaLogin(input.feedId, input.force, adminToken)
      if (outcome.kind === 'error') return outcome.result
      if (outcome.kind === 'locked') return ok<SelectFeedResult>({ alreadyLoggedIn: true, feedName: outcome.feedName })
      sessionBody = outcome.body
    }

    const locked = sessionBody === response.body ? readAlreadyLoggedIn(response.status, response.body) : null
    if (locked) return ok<SelectFeedResult>({ alreadyLoggedIn: true, feedName: locked.feedName })

    const envelope = sessionBody as { isSuccess?: unknown; data?: unknown } | null
    const viaEndpoint = sessionBody === response.body
    if (viaEndpoint && (response.status < 200 || response.status >= 300 || envelope?.isSuccess === false)) {
      const message = messageOf(response.body, 'The feed could not be opened.')
      logger.warn('[vms] feed-token refused', { status: response.status, message })
      if (response.status === 401) {
        return { success: false, error: { code: 'VALIDATION_ERROR', message, sessionEnded: true } }
      }
      if (response.status === 404) return fail('NOT_FOUND', message)
      if (response.status >= 400 && response.status < 500) return fail('VALIDATION_ERROR', message)
      return fail('INTERNAL_ERROR', message)
    }

    const parsed = parseFeedLogin(envelope?.data as WireLoginData | undefined)
    if (!parsed) {
      logger.error('[vms] feed-token succeeded but carried no token or user')
      return fail('INTERNAL_ERROR', 'The feed could not be opened. Please try again.')
    }

    current = {
      token: parsed.token,
      user: parsed.user,
      feedId: parsed.user.feedId || input.feedId,
      loggedInAt: new Date().toISOString()
    }
    logger.info('[vms] feed taken', { feedId: current.feedId, userId: parsed.user.id, forced: input.force })
    publish()
    return ok<SelectFeedResult>({ alreadyLoggedIn: false, session: toState() })
  })

export const releaseFeed = (): Promise<Result<SessionState>> =>
  serial(async () => {
    await releaseHeld(env.apiTimeoutMs)
    return ok(SIGNED_OUT)
  })

/** CMS sign-out and quit: same release, with a short budget so neither waits on a slow server. */
export const releaseFeedQuickly = (timeoutMs = 2_000): Promise<void> =>
  serial(() => releaseHeld(timeoutMs)).catch((error) => {
    logger.warn('[vms] feed release failed', error)
  })

export const isFeedHeld = (): boolean => current !== null
