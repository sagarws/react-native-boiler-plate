import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The feed session service against a stubbed backend: the 409 takeover
 * warning, a successful take, the switch that releases first, and a release.
 * Nothing here reaches a network.
 */

interface State {
  adminToken: string | null
  broadcasts: Array<{ channel: string; payload: unknown }>
}

const state = vi.hoisted<State>(() => ({ adminToken: 'admin-tok', broadcasts: [] }))

vi.mock('electron', () => ({ app: { getVersion: () => '9.9.9' } }))
vi.mock('@main/services/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))
vi.mock('@main/services/session.store', () => ({
  getAccessToken: () => state.adminToken,
  getSession: () => ({ user: { email: 'admin@example.com' } })
}))
vi.mock('@main/services/httpClient', () => ({ apiRequest: vi.fn() }))
vi.mock('@main/ipc/broadcast', () => ({
  broadcast: (channel: string, payload: unknown) => state.broadcasts.push({ channel, payload })
}))

const FEED_A = 'aaaaaaaaaaaaaaaaaaaaaaaa'
const FEED_B = 'bbbbbbbbbbbbbbbbbbbbbbbb'

const loginBody = (feedId: string): unknown => ({
  isSuccess: true,
  data: { accessToken: `feed-${feedId}`, user: { _id: `user-${feedId}`, feedId, feed: { _id: feedId, feedName: 'Desk' } } }
})

interface Call {
  url: string
  body: Record<string, unknown>
  auth: string | undefined
}

let calls: Call[] = []
let replies: Array<{ status: number; body: unknown }> = []

beforeEach(() => {
  vi.resetModules()
  calls = []
  replies = []
  state.adminToken = 'admin-tok'
  state.broadcasts = []
  vi.stubGlobal('fetch', (url: string, init: { body: string; headers: Record<string, string> }) => {
    calls.push({ url, body: JSON.parse(init.body) as Record<string, unknown>, auth: init.headers['Authorization'] })
    const reply = replies.shift() ?? { status: 200, body: { isSuccess: true, data: null } }
    // A string body is sent as-is (Express's plain-text 404 for an unknown route).
    const text = typeof reply.body === 'string' ? reply.body : JSON.stringify(reply.body)
    return Promise.resolve(new Response(text, { status: reply.status }))
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('selectFeed', () => {
  it('answers alreadyLoggedIn on a 409 and holds nothing', async () => {
    const service = await import('@main/vms/feedSession.service')
    replies.push({ status: 409, body: { isSuccess: false, data: { feedName: 'Desk 2', alreadyLoggedIn: true } } })

    const result = await service.selectFeed({ feedId: FEED_A })

    expect(result).toEqual({ success: true, data: { alreadyLoggedIn: true, feedName: 'Desk 2' } })
    expect(service.isFeedHeld()).toBe(false)
    expect(calls[0]?.url).toMatch(/\/auth\/feed-token$/)
    expect(calls[0]?.body).toEqual({ feedId: FEED_A, versionName: '9.9.9', force: false })
    expect(calls[0]?.auth).toBe('Bearer admin-tok')
    expect(state.broadcasts).toHaveLength(0)
  })

  it('takes the feed with force and maps the session; the token never reaches the state', async () => {
    const service = await import('@main/vms/feedSession.service')
    replies.push({ status: 200, body: loginBody(FEED_A) })

    const result = await service.selectFeed({ feedId: FEED_A, force: true })

    expect(calls[0]?.body['force']).toBe(true)
    expect(result.success && !result.data.alreadyLoggedIn && result.data.session.user?.feedId).toBe(FEED_A)
    expect(JSON.stringify(result)).not.toContain(`feed-${FEED_A}`)
    expect(service.getFeedSession()?.token).toBe(`feed-${FEED_A}`)
    expect(state.broadcasts.at(-1)?.channel).toBe('vms:feed-session-changed')
  })

  it('releases the held feed (feed-logout with the feed token) before taking another', async () => {
    const service = await import('@main/vms/feedSession.service')
    replies.push({ status: 200, body: loginBody(FEED_A) })
    await service.selectFeed({ feedId: FEED_A })
    replies.push({ status: 200, body: { isSuccess: true } }, { status: 200, body: loginBody(FEED_B) })

    await service.selectFeed({ feedId: FEED_B })

    expect(calls.map((call) => call.url.replace(/^.*\/api/, ''))).toEqual([
      '/auth/feed-token',
      '/auth/feed-logout',
      '/auth/feed-token'
    ])
    expect(calls[1]?.body).toEqual({ userId: `user-${FEED_A}` })
    expect(calls[1]?.auth).toBe(`Bearer feed-${FEED_A}`)
    expect(service.getFeedSession()?.feedId).toBe(FEED_B)
  })

  it('refuses a malformed feed id and a signed-out admin without calling out', async () => {
    const service = await import('@main/vms/feedSession.service')
    expect((await service.selectFeed({ feedId: '../x' })).success).toBe(false)
    state.adminToken = null
    expect((await service.selectFeed({ feedId: FEED_A })).success).toBe(false)
    expect(calls).toHaveLength(0)
  })

  it('drops the session on a 401 from a feed-token call', async () => {
    const service = await import('@main/vms/feedSession.service')
    replies.push({ status: 200, body: loginBody(FEED_A) })
    await service.selectFeed({ feedId: FEED_A })

    service.feedTokenRefused(`feed-${FEED_A}`)

    expect(service.isFeedHeld()).toBe(false)
    expect(state.broadcasts.at(-1)?.payload).toEqual({ authenticated: false, user: null, loggedInAt: null })
  })
})

describe('releaseFeed', () => {
  it('clears locally even when feed-logout fails', async () => {
    const service = await import('@main/vms/feedSession.service')
    replies.push({ status: 200, body: loginBody(FEED_A) }, { status: 500, body: {} })
    await service.selectFeed({ feedId: FEED_A })

    const result = await service.releaseFeed()

    expect(result).toEqual({ success: true, data: { authenticated: false, user: null, loggedInAt: null } })
    expect(service.isFeedHeld()).toBe(false)
  })
})

describe('selectFeed on a backend without POST /auth/feed-token (fallback)', () => {
  const missing = { status: 404, body: 'Cannot POST /api/auth/feed-token' }
  const feedList = {
    status: 200,
    body: { isSuccess: true, data: [{ feed: [{ _id: FEED_A, feedUser: { userId: 'desk-a', password: 'secret-a' } }] }] }
  }

  it('reads the feed login with the admin token, checks the desk lock, then feed-logins as the admin company', async () => {
    const service = await import('@main/vms/feedSession.service')
    replies.push(missing, feedList, { status: 200, body: { isSuccess: true, data: null } }, { status: 200, body: loginBody(FEED_A) })

    const result = await service.selectFeed({ feedId: FEED_A })

    expect(calls.map((call) => call.url.replace(/^.*\/api/, ''))).toEqual([
      '/auth/feed-token',
      '/feed',
      '/auth/check-already-login',
      '/auth/feed-login'
    ])
    expect(calls[3]?.body).toEqual({ companyEmail: 'admin@example.com', userId: 'desk-a', password: 'secret-a', versionName: '9.9.9' })
    expect(result.success && !result.data.alreadyLoggedIn && result.data.session.user?.feedId).toBe(FEED_A)
    // The feed password never leaves the main process.
    expect(JSON.stringify(result)).not.toContain('secret-a')
    expect(service.getFeedSession()?.token).toBe(`feed-${FEED_A}`)
  })

  it('answers the takeover question when the desk is signed in elsewhere', async () => {
    const service = await import('@main/vms/feedSession.service')
    replies.push(missing, feedList, { status: 200, body: { isSuccess: false, data: 'Packing Desk A' } })

    const result = await service.selectFeed({ feedId: FEED_A })

    expect(result).toEqual({ success: true, data: { alreadyLoggedIn: true, feedName: 'Packing Desk A' } })
    expect(service.isFeedHeld()).toBe(false)
  })

  it('skips the lock check when the operator confirmed the takeover', async () => {
    const service = await import('@main/vms/feedSession.service')
    replies.push(missing, feedList, { status: 200, body: loginBody(FEED_A) })

    await service.selectFeed({ feedId: FEED_A, force: true })

    expect(calls.map((call) => call.url.replace(/^.*\/api/, ''))).toEqual(['/auth/feed-token', '/feed', '/auth/feed-login'])
  })

  it('does not fall back when the endpoint exists and says the feed is not found', async () => {
    const service = await import('@main/vms/feedSession.service')
    replies.push({ status: 404, body: { isSuccess: false, displayMessage: 'That feed does not exist in your company.' } })

    const result = await service.selectFeed({ feedId: FEED_A })

    expect(result.success).toBe(false)
    expect(calls).toHaveLength(1)
  })

  it('explains a feed-login refusal (e.g. a sub-user email) instead of failing silently', async () => {
    const service = await import('@main/vms/feedSession.service')
    replies.push(missing, feedList, { status: 200, body: { isSuccess: true, data: null } }, { status: 400, body: { isSuccess: false, displayMessage: 'Invalid credentials' } })

    const result = await service.selectFeed({ feedId: FEED_A })

    expect(result.success).toBe(false)
    expect(!result.success && result.error.message).toMatch(/company admin login/)
  })
})
