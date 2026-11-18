import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Automatic sign-in is only ever ON because the company said so.
 *
 * Unreadable routing used to answer "on" — so a network hiccup turned a
 * scripted sign-in on for a platform set to manual. It now fails closed.
 */

const state = vi.hoisted<{ answer: unknown }>(() => ({
  answer: { success: false, error: { code: 'NETWORK', message: 'fetch failed' } }
}))

vi.mock('@main/services/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock('@main/services/session.store', () => ({ getAccessToken: () => 'token' }))
vi.mock('@main/services/company.service', () => ({ rememberAutoLogin: vi.fn() }))
vi.mock('@main/services/httpClient', () => ({ apiRequest: vi.fn() }))
vi.mock('@main/services/offlineCache', () => ({
  withOfflineCache: () => Promise.resolve(state.answer)
}))

const { autoLoginEnabled, clearRoutingCache } = await import('@main/services/automationRouting.service')

beforeEach(() => {
  clearRoutingCache()
})

describe('automatic sign-in', () => {
  it('is off when the routing cannot be read', async () => {
    state.answer = { success: false, error: { code: 'NETWORK', message: 'fetch failed' } }

    expect(await autoLoginEnabled('myntra')).toBe(false)
  })

  it('is off when the company set it off', async () => {
    state.answer = { success: true, data: { isAutoLoginOnActiveSession: { myntra: false } } }

    expect(await autoLoginEnabled('myntra')).toBe(false)
  })

  it('is on when the company set it on, or never set it', async () => {
    state.answer = { success: true, data: { isAutoLoginOnActiveSession: { myntra: true } } }
    expect(await autoLoginEnabled('myntra')).toBe(true)

    clearRoutingCache()
    state.answer = { success: true, data: {} }
    expect(await autoLoginEnabled('snapdeal')).toBe(true)
  })
})
