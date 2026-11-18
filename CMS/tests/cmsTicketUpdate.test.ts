import { beforeEach, describe, expect, it, vi } from 'vitest'
import { canEditTicket } from '@shared/constants/claims'

/**
 * A ticket number typed in by hand on the Claims page.
 *
 * `/cms/update-ticket` moves the claim to In Review whatever it was, so the
 * rule pinned here is where that write is allowed: Pending and Failed to
 * Proceed (the point of it) and In Review (only the number changes) — never a
 * settled claim, which it would drag back to In Review.
 */

const state = vi.hoisted<{
  token: string | null
  calls: { path: string; method: string | undefined; body: unknown }[]
  succeed: boolean
}>(() => ({
  token: 'tok',
  calls: [],
  succeed: true
}))

vi.mock('@main/services/session.store', () => ({ getAccessToken: () => state.token }))
vi.mock('@main/services/httpClient', () => ({
  apiRequest: (path: string, options: { method?: string; body?: unknown }) => {
    state.calls.push({ path, method: options.method, body: options.body })

    return Promise.resolve(
      state.succeed
        ? { success: true, data: {} }
        : { success: false, error: { code: 'INTERNAL_ERROR', message: 'CMS Not Found.' } }
    )
  }
}))

const { updateClaimTicket } = await import('@main/services/cmsTicket.service')

beforeEach(() => {
  state.token = 'tok'
  state.calls = []
  state.succeed = true
})

describe('canEditTicket', () => {
  it.each(['Pending', 'Failed to Proceed', 'In Review'])('allows %s', status => {
    expect(canEditTicket(status)).toBe(true)
  })

  it.each(['Approved', 'Rejected', 'Paid', 'Awaiting Seller Response', ''])('refuses %s', status => {
    expect(canEditTicket(status)).toBe(false)
  })
})

describe('updateClaimTicket', () => {
  it('writes the trimmed ticket as a manual entry and reports In Review', async () => {
    const result = await updateClaimTicket({ cmsId: 'c1', ticket: '  9998553 ', status: 'Pending' })

    expect(result).toEqual({ success: true, data: { cmsId: 'c1', ticket: '9998553', status: 'In Review' } })
    // No `source`: the server records a hand-typed ticket as manual.
    expect(state.calls).toEqual([{ path: '/cms/update-ticket', method: 'PUT', body: { _id: 'c1', ticket: '9998553' } }])
  })

  it('refuses a settled claim without calling the server', async () => {
    const result = await updateClaimTicket({ cmsId: 'c1', ticket: '1', status: 'Approved' })

    expect(result.success).toBe(false)
    expect(state.calls).toHaveLength(0)
  })

  it('refuses an empty or oversized ticket', async () => {
    expect((await updateClaimTicket({ cmsId: 'c1', ticket: '   ', status: 'Pending' })).success).toBe(false)
    expect((await updateClaimTicket({ cmsId: 'c1', ticket: 'x'.repeat(101), status: 'Pending' })).success).toBe(false)
    expect((await updateClaimTicket({ ticket: '1', status: 'Pending' })).success).toBe(false)
    expect(state.calls).toHaveLength(0)
  })

  it('needs a TrackVid sign-in', async () => {
    state.token = null

    expect((await updateClaimTicket({ cmsId: 'c1', ticket: '1', status: 'Pending' })).success).toBe(false)
    expect(state.calls).toHaveLength(0)
  })

  it("passes the server's refusal through", async () => {
    state.succeed = false

    const result = await updateClaimTicket({ cmsId: 'c1', ticket: '1', status: 'Failed to Proceed' })

    expect(result).toEqual({ success: false, error: { code: 'INTERNAL_ERROR', message: 'CMS Not Found.' } })
  })
})
