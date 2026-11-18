import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Accepted AJIO NDR/DDR claims and re-opened Myntra tickets are counted per day
 * on the Accounts page. The desktop app reports them once per finished pass.
 *
 * What this pins: only real, positive counts are sent; nothing is sent when a
 * pass accepted nothing or nobody is signed in; and a report that fails never
 * throws — the claims are already filed by then.
 */

const state = vi.hoisted(() => ({
  token: null as string | null,
  calls: [] as { path: string; body: unknown }[],
  respond: (): unknown => ({ success: true, data: {} })
}))

vi.mock('@main/services/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))
vi.mock('@main/services/session.store', () => ({ getAccessToken: () => state.token }))
vi.mock('@main/services/httpClient', () => ({
  apiRequest: vi.fn((path: string, options: { body: unknown }) => {
    state.calls.push({ path, body: options.body })

    return Promise.resolve(state.respond())
  })
}))

const { reportClaimActivity } = await import('@main/services/claimActivity.service')

beforeEach(() => {
  state.token = 'token'
  state.calls = []
  state.respond = () => ({ success: true, data: {} })
})

describe('reportClaimActivity', () => {
  it('sends the accepted NDR/DDR count, with zero re-opens', async () => {
    await reportClaimActivity({ ndrDdrClaims: 47 })

    expect(state.calls).toEqual([{ path: '/cms/claim-activity', body: { ndrDdrClaims: 47, reOpenClaims: 0 } }])
  })

  it('sends the re-open count', async () => {
    await reportClaimActivity({ reOpenClaims: 1 })

    expect(state.calls[0]?.body).toEqual({ ndrDdrClaims: 0, reOpenClaims: 1 })
  })

  it('sends nothing for a pass that got nothing accepted', async () => {
    await reportClaimActivity({ ndrDdrClaims: 0, reOpenClaims: 0 })
    await reportClaimActivity({})

    expect(state.calls).toHaveLength(0)
  })

  it('never sends a negative count — a retry pass whose total did not grow', async () => {
    await reportClaimActivity({ ndrDdrClaims: -3 })

    expect(state.calls).toHaveLength(0)
  })

  it('sends nothing when nobody is signed in', async () => {
    state.token = null

    await reportClaimActivity({ ndrDdrClaims: 5 })

    expect(state.calls).toHaveLength(0)
  })

  it('does not throw when the server refuses or the network fails', async () => {
    state.respond = () => ({ success: false, error: { code: 'INTERNAL_ERROR', message: 'down' } })
    await expect(reportClaimActivity({ ndrDdrClaims: 2 })).resolves.toBeUndefined()

    state.respond = () => {
      throw new Error('socket hang up')
    }
    await expect(reportClaimActivity({ reOpenClaims: 2 })).resolves.toBeUndefined()
  })
})
