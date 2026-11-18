import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Create Claim → Meesho → Return AWB: when TrackVid's master data has not
 * imported the return, Meesho's own Returns search names the sub-order number.
 *
 * Pinned: the saved session is used as-is (no sign-in while someone types), the
 * sub-order comes from the STRICT row the core matched, "not on this account"
 * is null (not an error), and no saved session is an error naming the fix.
 */

const mocks = vi.hoisted(() => ({
  storedSession: vi.fn(),
  searchReturns: vi.fn()
}))

vi.mock('@main/services/sessionReuse.service', () => ({ storedSession: mocks.storedSession }))
vi.mock('@main/automations/common/coreLoader', () => ({
  loadCore: () => ({ searchReturns: mocks.searchReturns })
}))

const { meeshoReturnAwbLookup } = await import(
  '@main/automations/platforms/meesho/claim-management/api-based-flow/returnAwbLookup'
)

beforeEach(() => {
  vi.clearAllMocks()
  mocks.storedSession.mockResolvedValue({ jar: { 'connect.sid': 'x' }, supplierId: 3438, supplierIdentifier: 'dg97w' })
})

describe('meeshoReturnAwbLookup', () => {
  it('answers the sub-order number, SKU and carrier from the matched row', async () => {
    mocks.searchReturns.mockResolvedValue({
      found: true,
      row: { subOrderNumber: '345023881081112704_1', sellerSku: 'JB672', carrier: 'Shadowfax' }
    })

    await expect(meeshoReturnAwbLookup({ awb: '13409648882686', username: 'a@b.com' })).resolves.toEqual({
      forwardAwb: null,
      sku: 'JB672',
      subOrderNumber: '345023881081112704_1',
      logisticsPartner: 'Shadowfax'
    })

    const [ctx, query] = mocks.searchReturns.mock.calls[0] as [Record<string, unknown>, string]

    expect(query).toBe('13409648882686')
    expect(ctx).toMatchObject({ supplierId: 3438, supplierIdentifier: 'dg97w' })
    expect(mocks.storedSession).toHaveBeenCalledWith('meesho', 'a@b.com')
  })

  it('reads supplier ids from `extra` when the capture stored them there', async () => {
    mocks.storedSession.mockResolvedValue({ jar: {}, extra: { supplierId: 7, supplierIdentifier: 'abc' } })
    mocks.searchReturns.mockResolvedValue({ found: false, row: null })

    await meeshoReturnAwbLookup({ awb: 'AWB1', username: 'a@b.com' })

    expect(mocks.searchReturns.mock.calls[0]?.[0]).toMatchObject({ supplierId: 7, supplierIdentifier: 'abc' })
  })

  it('is null when this account does not hold the AWB', async () => {
    mocks.searchReturns.mockResolvedValue({ found: false, row: null })

    await expect(meeshoReturnAwbLookup({ awb: 'AWB1', username: 'a@b.com' })).resolves.toBeNull()
  })

  it('refuses without a saved session, naming the fix', async () => {
    mocks.storedSession.mockResolvedValue(null)

    await expect(meeshoReturnAwbLookup({ awb: 'AWB1', username: 'a@b.com' })).rejects.toThrow(/capture it/)
    expect(mocks.searchReturns).not.toHaveBeenCalled()
  })
})
