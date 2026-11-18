import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Flipkart's return-AWB autofill: the order id and order item id Create Claim
 * fills while the AWB is typed, and saves with the claim.
 *
 * Pinned: the first return gives its order id and its first item (one call,
 * both ids); no rows means "not on this account"; a missing session is a
 * failure, never a sign-in.
 */

const mocks = vi.hoisted(() => ({
  storedSession: vi.fn(),
  searchReturnItem: vi.fn(),
  claimContextFromSession: vi.fn()
}))

vi.mock('@main/services/sessionReuse.service', () => ({ storedSession: mocks.storedSession }))
vi.mock('@main/automations/common/coreLoader', () => ({
  loadCore: (path: string) =>
    path === 'common/claimContext'
      ? { claimContextFromSession: mocks.claimContextFromSession }
      : { searchReturnItem: mocks.searchReturnItem }
}))

const { pickOrderIds, flipkartReturnAwbLookup } = await import(
  '@main/automations/platforms/flipkart/claim-management/api-based-flow/returnAwbLookup'
)

const row = (orderId: string | null, orderItemIds: string[]) => ({ orderId, orderItemIds })

describe('pickOrderIds', () => {
  it('takes the order id and the single item of one return', () => {
    expect(pickOrderIds([row('OD439015019313617100', ['439015019313617100'])])).toEqual({
      orderId: 'OD439015019313617100',
      orderItemId: '439015019313617100'
    })
  })

  it('returns null when the search found nothing', () => {
    expect(pickOrderIds([])).toBeNull()
  })

  it('takes the first return when two different orders answer', () => {
    expect(pickOrderIds([row('OD1', ['I1']), row('OD2', ['I2'])])).toEqual({
      orderId: 'OD1',
      orderItemId: 'I1'
    })
  })

  it('takes the first item when one order has several', () => {
    expect(pickOrderIds([row('OD1', ['I1', 'I2'])])).toEqual({ orderId: 'OD1', orderItemId: 'I1' })
  })

  it('skips an empty leading row', () => {
    expect(pickOrderIds([row(null, []), row('OD2', ['I2'])])).toEqual({ orderId: 'OD2', orderItemId: 'I2' })
  })
})

describe('flipkartReturnAwbLookup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.storedSession.mockResolvedValue({ jar: { cookies: [] } })
    mocks.claimContextFromSession.mockReturnValue({ jar: {} })
  })

  it('answers the order id as orderId and the item id as subOrderNumber', async () => {
    mocks.searchReturnItem.mockResolvedValue({ found: true, returns: [row('OD9', ['I9'])] })

    await expect(flipkartReturnAwbLookup({ awb: 'FMPC123456', username: 'a@b.in' })).resolves.toEqual({
      forwardAwb: null,
      sku: null,
      orderId: 'OD9',
      subOrderNumber: 'I9'
    })
    expect(mocks.searchReturnItem).toHaveBeenCalledWith(expect.anything(), 'FMPC123456', {
      searchBy: 'tracking_id'
    })
  })

  it('answers null when this account does not hold the AWB', async () => {
    mocks.searchReturnItem.mockResolvedValue({ found: false, returns: [] })

    await expect(flipkartReturnAwbLookup({ awb: 'FMPC123456', username: 'a@b.in' })).resolves.toBeNull()
  })

  it('throws, without searching, when the account has no saved session', async () => {
    mocks.storedSession.mockResolvedValue(null)

    await expect(flipkartReturnAwbLookup({ awb: 'FMPC123456', username: 'a@b.in' })).rejects.toThrow(
      /no saved session/
    )
    expect(mocks.searchReturnItem).not.toHaveBeenCalled()
  })
})
