import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * "Get OTP" rides through a slow mailbox login the way a sign-in does.
 *
 * Gmail sometimes takes longer than the IMAP client's fixed 5s to accept a
 * login. A sign-in never noticed: its poller reads again 15–20s later. "Get
 * OTP" is one press with nothing behind it, so a single slow login surfaced
 * as "Could not read the mailbox — Timed out while authenticating with server".
 */

const timeout = (source: string, message: string): Error =>
  Object.assign(new Error(message), { source })

const state = vi.hoisted(() => ({
  /** What each successive reader call does: an error to throw, or the code. */
  reader: [] as (Error | string | null)[],
  fetch: [] as (Error | { subject: string; date: Date })[],
  readerCalls: 0,
  fetchCalls: 0
}))

vi.mock('@main/config/env', () => ({
  env: { gmailImapUser: 'shared@example.com', gmailImapPassword: 'app-password' }
}))
vi.mock('@main/services/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}))
vi.mock('@main/services/company.service', () => ({
  credentialFor: () => Promise.resolve({ otpEmail: '' })
}))
vi.mock('@main/automations/common/coreLoader', () => ({
  loadCore: (subpath: string) => {
    if (subpath === 'common/gmailReader') {
      return {
        fetchEmails: () => {
          const next = state.fetch[state.fetchCalls++]

          if (next instanceof Error) return Promise.reject(next)

          return Promise.resolve(next ? [next] : [])
        }
      }
    }

    return {
      GetSnapdealOTP: () => {
        const next = state.reader[state.readerCalls++]

        return next instanceof Error ? Promise.reject(next) : Promise.resolve(next ?? null)
      }
    }
  }
}))

const { peekLatestOtp } = await import('@main/services/otpSource')

const peek = async () => {
  const pending = peekLatestOtp({ platform: 'snapdeal', username: 'seller@example.com' })

  await vi.runAllTimersAsync()

  return pending
}

beforeEach(() => {
  vi.useFakeTimers()
  state.reader = []
  state.fetch = []
  state.readerCalls = 0
  state.fetchCalls = 0
})

afterEach(() => {
  vi.useRealTimers()
})

describe('Get OTP against a slow mailbox', () => {
  it('tries again after a login timeout, and returns the code', async () => {
    const arrived = new Date('2026-10-15T07:16:00.000Z')

    state.reader = [timeout('timeout-auth', 'Timed out while authenticating with server'), '482913']
    state.fetch = [{ subject: 'Your code is 482913', date: arrived }]

    const result = await peek()

    expect(result).toEqual({
      success: true,
      data: { otp: '482913', receivedAt: arrived.toISOString(), address: 'seller@example.com' }
    })
    expect(state.readerCalls).toBe(2)
  })

  it('also retries a connect timeout', async () => {
    state.reader = [timeout('timeout', 'Timed out while connecting to server'), null]

    const result = await peek()

    expect(result.success).toBe(true)
    expect(state.readerCalls).toBe(2)
  })

  it('gives up after three timeouts and says why', async () => {
    const slow = timeout('timeout-auth', 'Timed out while authenticating with server')

    state.reader = [slow, slow, slow, '111111']

    const result = await peek()

    expect(result.success).toBe(false)
    expect(state.readerCalls).toBe(3)
    expect(JSON.stringify(result)).toContain('Timed out while authenticating with server')
  })

  it('does not retry an error that will fail the same way again', async () => {
    state.reader = [timeout('authentication', 'Invalid credentials (Failure)'), '111111']

    const result = await peek()

    expect(result.success).toBe(false)
    expect(state.readerCalls).toBe(1)
  })

  it('keeps a code already read when only the arrival-time lookup fails', async () => {
    const slow = timeout('timeout-auth', 'Timed out while authenticating with server')

    state.reader = ['482913']
    state.fetch = [slow, slow, slow]

    const result = await peek()

    expect(result).toEqual({
      success: true,
      data: { otp: '482913', receivedAt: null, address: 'seller@example.com' }
    })
  })
})
