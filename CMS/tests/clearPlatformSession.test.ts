import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Removing a saved marketplace session.
 *
 * WHY IT EXISTS. Nine endpoints could WRITE a session and none could remove
 * one, so a jar the marketplace had started refusing could only be replaced —
 * and replacing it means a full sign-in, which is exactly what is impossible
 * when the account is locked, its password has changed, or it was captured
 * against the wrong company. The only remaining route was editing Mongo by
 * hand.
 *
 * THE RULE THAT MATTERS MOST: a session lives in FOUR places — the backend, an
 * encrypted store on this machine, the local copy of the company document, and
 * a rejection stamp that may sit beside it. Clearing only some of them is worse
 * than not offering the button, because the operator has now been told it
 * worked while the automations go on reading a jar from the local document.
 *
 * And the server goes FIRST. It is the copy the other three derive from, so
 * wiping the local ones against a server that still holds the jar would have
 * the next Sync put it straight back — a button that looks intermittent rather
 * than broken, which is far harder to diagnose.
 */

interface Cleared {
  local: string[]
  company: string[]
  rejections: string[]
  allLocal: number
  posted: { path: string; body: unknown }[]
}

const cleared = vi.hoisted<Cleared>(() => ({
  local: [],
  company: [],
  rejections: [],
  allLocal: 0,
  posted: []
}))

interface ServerState {
  ok: boolean
  token: string | null
}

const server = vi.hoisted<ServerState>(() => ({ ok: true, token: 'tok' }))

vi.mock('@main/services/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))
vi.mock('@main/services/httpClient', () => ({
  apiRequest: (path: string, options: { body?: unknown }) => {
    cleared.posted.push({ path, body: options.body })

    return Promise.resolve(
      server.ok
        ? { success: true, data: { removed: true } }
        : { success: false, error: { message: 'the server refused' } }
    )
  }
}))
vi.mock('@main/services/session.store', () => ({ getAccessToken: () => server.token }))
vi.mock('@main/services/localSession.store', () => ({
  forgetSession: (platform: string, username: string) => {
    cleared.local.push(`${platform}:${username}`)

    return Promise.resolve()
  },
  forgetAllSessions: () => {
    cleared.allLocal += 1

    return Promise.resolve()
  },
  rememberSession: () => Promise.resolve(),
  recallSession: () => Promise.resolve(null),
  initialiseLocalSessions: () => undefined
}))
vi.mock('@main/services/company.service', () => ({
  forgetCompanySession: (platform?: string, username?: string) => {
    cleared.company.push(`${platform ?? '*'}:${username ?? '*'}`)

    return Promise.resolve()
  },
  credentialsFor: () => Promise.resolve([]),
  rememberCompanySession: () => Promise.resolve(),
  rememberOtpMode: () => Promise.resolve()
}))
vi.mock('@main/services/sessionRejection.store', () => ({
  forgetSessionRejected: (platform: string, username: string) => {
    cleared.rejections.push(`${platform}:${username}`)

    return Promise.resolve()
  },
  sessionRejectionKey: (platform: string, username: string) => `${platform}:${username}`,
  sessionRejections: () => Promise.resolve({})
}))

const { clearPlatformSession, clearAllPlatformSessions } = await import(
  '@main/services/platformSession.service'
)

beforeEach(() => {
  cleared.local.length = 0
  cleared.company.length = 0
  cleared.rejections.length = 0
  cleared.posted.length = 0
  cleared.allLocal = 0
  server.ok = true
  server.token = 'tok'
})

describe('removing one credential’s session', () => {
  it('clears the server and every local copy', async () => {
    const result = await clearPlatformSession({
      platform: 'meesho',
      username: 'avi98259@gmail.com'
    })

    expect(result.success).toBe(true)
    expect(cleared.posted[0]?.path).toBe('/cms/clear-session')
    expect(cleared.posted[0]?.body).toEqual({
      platform: 'meesho',
      username: 'avi98259@gmail.com'
    })
    // All three local copies, or the automations keep using the jar.
    expect(cleared.local).toEqual(['meesho:avi98259@gmail.com'])
    expect(cleared.company).toEqual(['meesho:avi98259@gmail.com'])
    // A stamp outliving the session it described is a permanently red account
    // that re-capturing cannot clear.
    expect(cleared.rejections).toEqual(['meesho:avi98259@gmail.com'])
  })

  it('leaves everything alone when the server refuses', async () => {
    // The server is the copy the others derive from. Wiping them against a
    // server that still holds the jar means the next Sync restores it.
    server.ok = false

    const result = await clearPlatformSession({ platform: 'meesho', username: 'a@example.invalid' })

    expect(result.success).toBe(false)
    expect(cleared.local).toEqual([])
    expect(cleared.company).toEqual([])
    expect(cleared.rejections).toEqual([])
  })

  it('refuses without asking the server when the account is not named', async () => {
    for (const payload of [{}, { platform: 'meesho' }, { username: 'a@example.invalid' }]) {
      const result = await clearPlatformSession(payload)

      expect(result.success).toBe(false)
    }

    expect(cleared.posted).toEqual([])
  })

  it('normalises the platform before sending it', async () => {
    // The page passes what it displays; the backend matches on the key.
    await clearPlatformSession({ platform: 'Meesho', username: ' a@example.invalid ' })

    expect(cleared.posted[0]?.body).toMatchObject({ platform: 'meesho' })
  })

  it('does nothing at all when nobody is signed in', async () => {
    server.token = null

    const result = await clearPlatformSession({ platform: 'meesho', username: 'a@example.invalid' })

    expect(result.success).toBe(false)
    expect(cleared.posted).toEqual([])
  })
})

describe('removing every session', () => {
  it('asks its own endpoint, not the single delete with arguments left off', async () => {
    // The gap between the two is one account signing in again and all of them.
    // A wide operation reached through a dropped field is the shape of an
    // expensive mistake, so it has its own route on both sides of the wire.
    const result = await clearAllPlatformSessions()

    expect(result.success).toBe(true)
    expect(cleared.posted[0]?.path).toBe('/cms/clear-all-sessions')
  })

  it('wipes the local store wholesale rather than per account', async () => {
    // A machine can hold a jar the server has never heard of — captured while
    // it was offline — and a sweep over only what the server listed would leave
    // exactly those behind.
    await clearAllPlatformSessions()

    expect(cleared.allLocal).toBe(1)
    expect(cleared.company).toEqual(['*:*'])
  })

  it('leaves the local copies alone when the server refuses', async () => {
    server.ok = false

    const result = await clearAllPlatformSessions()

    expect(result.success).toBe(false)
    expect(cleared.allLocal).toBe(0)
    expect(cleared.company).toEqual([])
  })
})
