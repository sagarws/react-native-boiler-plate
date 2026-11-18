import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Nykaa's status read: by ticket number through the portal search first,
 * falling back to the reverse-AWB index only when the search finds nothing.
 */

const byNumber = vi.fn<(ctx: unknown, n: string) => Promise<Record<string, unknown> | null>>()
const byAwb = vi.fn<(ctx: unknown, awb: string) => Promise<Record<string, unknown> | null>>()

vi.mock('@main/services/claimSession.service', () => ({
  claimCredentials: () => Promise.reject(new Error('no login in this test'))
}))
vi.mock('@main/automations/common/coreLoader', () => ({
  loadCore: () => ({
    findTicketByNumber: byNumber,
    findTicketByReverseAwb: byAwb,
    mapNaykaaStatus: (status: string | null) => (status === 'Open' ? 'Open' : status ? 'Closed' : null)
  })
}))

const { nykaaRefill } = await import('@main/automations/platforms/nykaa/refill/refillFields')

const ask = (ticketNumber: string | null) =>
  nykaaRefill({
    doc: {},
    awb: '28449706871383',
    username: 'jyothi@wrogn.com',
    ticketNumber,
    fields: ['statusChange'],
    contexts: new Map([['jyothi@wrogn.com', {}]])
  })

beforeEach(() => {
  byNumber.mockReset()
  byAwb.mockReset()
})

describe('Nykaa status refill', () => {
  it('reads the status from the ticket search', async () => {
    byNumber.mockResolvedValue({ ticketNumber: '7061852', status: 'Open' })

    expect(await ask('7061852')).toEqual({ marketplaceStatus: 'Open', status: 'Open' })
    expect(byNumber).toHaveBeenCalledWith({}, '7061852')
    expect(byAwb).not.toHaveBeenCalled()
  })

  it('falls back to the reverse AWB when the search finds nothing', async () => {
    byNumber.mockResolvedValue(null)
    byAwb.mockResolvedValue({ status: 'Closed' })

    expect(await ask('7061852')).toEqual({ marketplaceStatus: 'Closed', status: 'Closed' })
    expect(byAwb).toHaveBeenCalledWith({}, '28449706871383')
  })

  it('skips the search for a row with no ticket number', async () => {
    byAwb.mockResolvedValue(null)

    expect(await ask(null)).toEqual({})
    expect(byNumber).not.toHaveBeenCalled()
  })
})
