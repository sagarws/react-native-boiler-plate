import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Which build the operator is actually running, on record without asking them.
 *
 * Support's first question about a desktop fault is "what version are you on",
 * and the answer was whatever they remembered. What is pinned here is the rule
 * that keeps the recorded answer true:
 *
 *   - reported when nothing is on record (a machine's first run), and
 *   - reported when it DIFFERS, which is every run after an update — a version
 *     written once would go on describing a build nobody runs,
 *   - not reported when it already matches, so an app opened daily does not
 *     write the same string for ever.
 *
 * And never fatal. Nothing reads this value, so failing to send it must not
 * disturb a sign-in.
 */

const calls = vi.hoisted(() => ({ puts: [] as { path: string; body: unknown }[] }))

type Routing =
  | { success: true; data: Record<string, unknown> }
  | { success: false; error: { message: string } }

interface State {
  version: string
  token: string | null
  routing: Routing
  putSucceeds: boolean
  cacheCleared: number
}

const state = vi.hoisted<State>(() => ({
  version: '0.1.16',
  token: 'tok',
  routing: { success: true, data: {} },
  putSucceeds: true,
  cacheCleared: 0
}))

vi.mock('electron', () => ({ app: { getVersion: () => state.version } }))
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
  apiRequest: (path: string, options: { body?: unknown }) => {
    calls.puts.push({ path, body: options.body })

    return Promise.resolve(
      state.putSucceeds
        ? { success: true, data: {} }
        : { success: false, error: { message: 'offline' } }
    )
  }
}))

const { reportAppVersion } = await import('@main/services/appVersion.service')

const reset = (): void => {
  calls.puts.length = 0
  state.version = '0.1.16'
  state.token = 'tok'
  state.routing = { success: true, data: {} }
  state.putSucceeds = true
  state.cacheCleared = 0
}

beforeEach(reset)

describe('reporting this app’s version', () => {
  it('reports when the company has none on record', async () => {
    state.routing = { success: true, data: { cmsAppVersion: '' } }

    await reportAppVersion()

    expect(calls.puts).toHaveLength(1)
    expect(calls.puts[0]).toMatchObject({
      path: '/cms/app-version',
      body: { cmsAppVersion: '0.1.16' }
    })
  })

  it('reports again after an update, which is the case that matters', async () => {
    state.routing = { success: true, data: { cmsAppVersion: '0.1.15' } }

    await reportAppVersion()

    expect(calls.puts[0]?.body).toEqual({ cmsAppVersion: '0.1.16' })
    // Or the next caller would compare against the stale cached value and
    // report the same change over again.
    expect(state.cacheCleared).toBe(1)
  })

  it('says nothing when the record already matches', async () => {
    state.routing = { success: true, data: { cmsAppVersion: '0.1.16' } }

    await reportAppVersion()

    expect(calls.puts).toEqual([])
  })

  it('does nothing at all when nobody is signed in', async () => {
    state.token = null

    await reportAppVersion()

    expect(calls.puts).toEqual([])
  })

  it('stays quiet, and does not throw, when the version cannot be read or sent', async () => {
    state.routing = { success: false, error: { message: 'offline' } }
    await expect(reportAppVersion()).resolves.toBeUndefined()
    expect(calls.puts).toEqual([])

    reset()
    state.routing = { success: true, data: { cmsAppVersion: '0.1.15' } }
    state.putSucceeds = false
    await expect(reportAppVersion()).resolves.toBeUndefined()
    // The failed write must not be cached away as though it had landed.
    expect(state.cacheCleared).toBe(0)
  })
})
