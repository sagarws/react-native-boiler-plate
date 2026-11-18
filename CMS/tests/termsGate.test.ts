import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The responsible-use notice: asked once per company, and never assumed.
 *
 * What is pinned here is the direction it fails in. An agreement is a thing
 * somebody did — so anything that is not an explicit yes on record means ask
 * again, including an unreadable answer. Accepting a second time costs a
 * moment; recording an agreement nobody made cannot be undone.
 *
 * And that BOTH answers are written. "Declined" and "never asked" are
 * indistinguishable if only a yes is stored, and one of them is a company that
 * read the notice and closed the app.
 */

const calls = vi.hoisted(() => ({ writes: [] as unknown[], quits: 0 }))

interface Routing {
  success: boolean
  data?: Record<string, unknown>
  error?: { message: string; sessionEnded?: true }
}

interface State {
  token: string | null
  routing: Routing
  writeSucceeds: boolean
  cacheCleared: number
}

const state = vi.hoisted<State>(() => ({
  token: 'tok',
  routing: { success: true, data: {} },
  writeSucceeds: true,
  cacheCleared: 0
}))

vi.mock('electron', () => ({
  app: {
    quit: () => {
      calls.quits += 1
    }
  }
}))
vi.mock('@main/services/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))
vi.mock('@main/services/session.store', () => ({ getAccessToken: () => state.token }))
vi.mock('@main/services/automationRouting.service', () => ({
  routing: () => Promise.resolve(state.routing),
  clearRoutingCache: () => {
    state.cacheCleared += 1
  }
}))
vi.mock('@main/services/httpClient', () => ({
  apiRequest: (_path: string, options: { body?: unknown }) => {
    calls.writes.push(options.body)

    return Promise.resolve(
      state.writeSucceeds
        ? { success: true, data: {} }
        : { success: false, error: { message: 'offline' } }
    )
  }
}))

const { acceptTerms, declineTerms, termsStatus } = await import('@main/services/terms.service')

const reset = (): void => {
  calls.writes.length = 0
  calls.quits = 0
  state.token = 'tok'
  state.routing = { success: true, data: {} }
  state.writeSucceeds = true
  state.cacheCleared = 0
}

beforeEach(reset)

describe('the responsible-use notice', () => {
  it('lets a company that has accepted it straight through', async () => {
    state.routing = { success: true, data: { cmsTermsAgreed: true } }

    const status = await termsStatus()

    expect(status.success && status.data.agreed).toBe(true)
  })

  it('asks when the answer is anything other than an explicit yes', async () => {
    for (const stored of [undefined, false, null, 'true', 1]) {
      reset()
      state.routing = { success: true, data: { cmsTermsAgreed: stored } }

      const status = await termsStatus()

      expect(status.success && status.data.agreed, String(stored)).toBe(false)
    }
  })

  it('says nothing to ask when nobody is signed in', async () => {
    // The answer lives on the COMPANY record, so there is nothing to read
    // before a token exists. Asking anyway is how the notice ended up sitting
    // over the app for a whole session regardless of what the database said.
    state.token = null

    const status = await termsStatus()

    expect(status.success).toBe(false)
    expect(calls.writes).toEqual([])
  })

  it('asks when the answer cannot be read at all', async () => {
    // Offline, or a backend that will not answer. Showing the notice again is
    // a small annoyance; assuming agreement because a request timed out is not.
    state.routing = { success: false, error: { message: 'offline' } }

    const status = await termsStatus()

    expect(status.success && status.data.agreed).toBe(false)
  })

  it('reports a refused token as a dead session, not as "ask again"', async () => {
    // The stored token was revoked (logout elsewhere, password change). The
    // gate must be able to tell this apart from offline, or it shows a notice
    // whose Agree is refused forever — the stored token survives a restart.
    state.routing = {
      success: false,
      error: { message: 'Your session has ended. Please log in again.', sessionEnded: true }
    }

    const status = await termsStatus()

    expect(status.success).toBe(false)
    expect(!status.success && status.error.sessionEnded).toBe(true)
  })

  it('records the acceptance, and stops the next read showing it again', async () => {
    const accepted = await acceptTerms()

    expect(accepted.success).toBe(true)
    expect(calls.writes).toEqual([{ agreed: true }])
    // Or the cached routing would still say "not agreed" to the next caller.
    expect(state.cacheCleared).toBe(1)
  })

  it('reports a failed acceptance instead of letting it through quietly', async () => {
    // Otherwise the operator is asked again tomorrow with no explanation.
    state.writeSucceeds = false

    const accepted = await acceptTerms()

    expect(accepted.success).toBe(false)
  })

  it('records a refusal too, and closes the app', async () => {
    const declined = await declineTerms()

    expect(calls.writes).toEqual([{ agreed: false }])
    expect(declined.success && declined.data.agreed).toBe(false)
    expect(calls.quits).toBe(1)
  })

  it('still closes when the refusal cannot be saved', async () => {
    // Somebody who has decided to leave is not held at a dialog by a failing
    // network. They are simply asked again next time, which is correct.
    state.writeSucceeds = false

    await declineTerms()

    expect(calls.quits).toBe(1)
  })
})
