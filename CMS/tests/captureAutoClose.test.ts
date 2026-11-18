import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The sign-in window closing itself once the marketplace agrees.
 *
 * "Sign in, then close the window" put two things on the operator: knowing that
 * closing is what saves the session, and judging when they are far enough in.
 * Both went wrong on Flipkart — a capture that reached the Seller Dashboard was
 * rejected with "the window was closed before sign-in completed" — so the app
 * now asks the marketplace the same question it used to ask only afterwards,
 * while the window is still open, and closes it on a yes.
 *
 * The two failure modes are opposite and equally silent: close too early and a
 * real sign-in is thrown away; never close and the operator waits on a window
 * that will not finish. So what is pinned here is WHEN it closes.
 */

const coreShape = vi.hoisted(() => ({ pageProbe: true }))

const state = vi.hoisted(() => ({
  /** What the cookie jar answers, one entry per read. */
  jars: [] as { name: string; value: string; domain: string }[][],
  /** What the identity check says, one entry per ask. */
  verdicts: [] as (boolean | null)[],
  asked: [] as Record<string, unknown>[],
  closed: 0,
  /** The partition's cookie-change listener, so a test can fire it. */
  onCookie: null as null | (() => void)
}))

vi.mock('electron', () => ({
  BrowserWindow: class {},
  app: { getPath: () => '/tmp/trackvid-test', getVersion: () => '0.0.0' },
  session: {
    fromPartition: () => ({
      cookies: {
        get: () => Promise.resolve(state.jars.shift() ?? state.jars[0] ?? []),
        on: (_event: string, listener: () => void) => {
          state.onCookie = listener
        },
        removeListener: () => {
          state.onCookie = null
        }
      }
    })
  },
  dialog: {},
  safeStorage: { isEncryptionAvailable: () => false }
}))
vi.mock('@main/services/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))
vi.mock('@main/automations/common/coreLoader', () => ({
  loadCore: (module: string) => {
    // Flipkart answers from its jar and has no in-page check — the watcher asks
    // this module first for every platform, so the mock has to answer it.
    if (module === 'common/sessionPageProbe') {
      return coreShape.pageProbe
        ? { hasPageProbe: (platform: string) => platform === 'tatacliq' }
        : {}
    }

    return {
      checkSessionIdentity: (_platform: string, record: Record<string, unknown>) => {
        state.asked.push(record)

        return Promise.resolve({
          ok: state.verdicts.shift() ?? false,
          who: null,
          detail: 'test'
        })
      }
    }
  }
}))
vi.mock('@trackvid/automation-core/common/probeSession', () => ({
  probePlatformSession: () => Promise.resolve(null)
}))
vi.mock('@main/services/httpClient', () => ({ apiRequest: vi.fn() }))
vi.mock('@main/services/session.store', () => ({ getAccessToken: () => 'token' }))
vi.mock('@main/services/preferences.service', () => ({ getPreferences: () => ({}) }))

const { closeWhenSignedIn } = await import('@main/services/platformSession.service')

/** A window that records being closed, and reports itself gone afterwards. */
const fakeWindow = (): { isDestroyed: () => boolean; close: () => void } => {
  let destroyed = false

  return {
    isDestroyed: () => destroyed,
    close: () => {
      state.closed += 1
      destroyed = true
    }
  }
}

const FLIPKART = {
  key: 'flipkart',
  label: 'Flipkart',
  cookieDomains: ['.flipkart.com'] as const,
  jarFormat: 'cookie-map'
}

/** Enough cookies to be worth asking about, twice over so the count is stable. */
const signedInJar = [
  { name: 'sn', value: 'a', domain: '.flipkart.com' },
  { name: 'sc', value: 'b', domain: '.flipkart.com' },
  { name: 'XyZ7pQ9rS2T1uV8wA3bC6dE4fG0h', value: 'JzRq1dXU-xfSW3HQfPsbi6C8geegObhM', domain: '.flipkart.com' }
]

beforeEach(() => {
  vi.useFakeTimers()
  state.jars = []
  state.verdicts = []
  state.asked = []
  state.closed = 0
  state.onCookie = null
  coreShape.pageProbe = true
})

/** Runs the watcher's timers until it has had `rounds` chances to ask. */
const tick = async (rounds: number): Promise<void> => {
  await vi.advanceTimersByTimeAsync(10_000)

  for (let i = 0; i < rounds; i += 1) await vi.advanceTimersByTimeAsync(5_000)
}

describe('closeWhenSignedIn', () => {
  it('closes the window once the marketplace names the seller', async () => {
    state.jars = [signedInJar, signedInJar, signedInJar]
    state.verdicts = [true]

    const window = fakeWindow()
    closeWhenSignedIn(window as never, FLIPKART, 'persist:flipkart', () => ({}))
    await tick(3)

    expect(state.closed).toBe(1)
  })

  it('leaves the window alone while the answer is no', async () => {
    // The operator is still typing. Closing here throws away the attempt.
    state.jars = [signedInJar, signedInJar, signedInJar, signedInJar]
    state.verdicts = [false, false, false]

    const window = fakeWindow()
    closeWhenSignedIn(window as never, FLIPKART, 'persist:flipkart', () => ({}))
    await tick(3)

    expect(state.closed).toBe(0)
  })

  it('does not ask about a jar that is still filling', async () => {
    // Signing in is not one navigation — the cookies arrive across a redirect
    // chain, and asking mid-chain spends a request on half a session.
    state.jars = [
      signedInJar.slice(0, 3),
      [...signedInJar, { name: 'more', value: 'c', domain: '.flipkart.com' }]
    ]
    state.verdicts = [true]

    const window = fakeWindow()
    closeWhenSignedIn(window as never, FLIPKART, 'persist:flipkart', () => ({}))
    await vi.advanceTimersByTimeAsync(10_000)

    expect(state.asked).toHaveLength(0)
  })

  it('carries the extras the check needs, which is the whole Flipkart bug', async () => {
    // Flipkart's probe signs its request with fk-csrf-token off the RECORD.
    // Asked with the jar alone it answers 403 EBADCSRFTOKEN, which reads as
    // "not signed in" — and that rejected sign-ins that had plainly worked.
    state.jars = [signedInJar, signedInJar, signedInJar]
    state.verdicts = [true]

    const window = fakeWindow()
    closeWhenSignedIn(window as never, FLIPKART, 'persist:flipkart', () => ({ sellerId: '42' }))
    await tick(2)

    expect(state.asked[0]).toMatchObject({
      csrfToken: 'JzRq1dXU-xfSW3HQfPsbi6C8geegObhM',
      sellerId: '42'
    })
  })

  it('survives a core that has no in-page check at all', async () => {
    // The app runs against whatever core commit it pins. An older one without
    // that module must cost the page check, not the whole watcher — otherwise
    // no window on any platform ever closes itself again.
    state.jars = [signedInJar, signedInJar, signedInJar]
    state.verdicts = [true]
    coreShape.pageProbe = false

    const window = fakeWindow()
    closeWhenSignedIn(window as never, FLIPKART, 'persist:flipkart', () => ({}))
    await tick(3)

    expect(state.closed).toBe(1)
  })

  it('stops asking once it is told to', async () => {
    state.jars = [signedInJar, signedInJar, signedInJar]
    state.verdicts = [false, false]

    const window = fakeWindow()
    const watch = closeWhenSignedIn(window as never, FLIPKART, 'persist:flipkart', () => ({}))

    await tick(1)
    watch.stop()
    const askedBefore = state.asked.length
    await tick(3)

    expect(state.asked.length).toBe(askedBefore)
  })
})

describe('closing within ten seconds of the sign-in', () => {
  it('closes on the cookies the sign-in writes, without waiting for the timer', async () => {
    // Past the grace period, the operator finishes signing in: the marketplace
    // writes its session cookies. The window must be gone well inside 10s.
    state.jars = [signedInJar]
    state.verdicts = [false]

    const window = fakeWindow()
    closeWhenSignedIn(window as never, FLIPKART, 'persist:flipkart', () => ({}))
    await vi.advanceTimersByTimeAsync(10_000)

    state.jars = [signedInJar]
    state.verdicts = [true]
    state.onCookie?.()
    await vi.advanceTimersByTimeAsync(2_000)

    expect(state.closed).toBe(1)
  })

  it('ignores cookie writes during the grace period', async () => {
    state.jars = [signedInJar]
    state.verdicts = [true]

    const window = fakeWindow()
    closeWhenSignedIn(window as never, FLIPKART, 'persist:flipkart', () => ({}))
    state.onCookie?.()
    await vi.advanceTimersByTimeAsync(5_000)

    expect(state.asked).toHaveLength(0)
    expect(state.closed).toBe(0)
  })

  it('stops listening once stopped', () => {
    const window = fakeWindow()
    const watch = closeWhenSignedIn(window as never, FLIPKART, 'persist:flipkart', () => ({}))

    watch.stop()

    expect(state.onCookie).toBeNull()
  })
})
