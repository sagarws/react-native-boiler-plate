import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The translation between the desktop's `Result` and the shapes the ported
 * auto-fetch code reads.
 *
 * WHY THIS IS THE TEST WORTH HAVING. The auto-fetch hooks are TrackVid-FE's,
 * unchanged — they read `res.data.data`, `res.data.skus`, `res.data.records`
 * and `res.data.isSuccess`, because on the web those are axios responses. Here
 * every call is IPC, and one thin module reshapes the answers. If that module
 * drifts, nothing throws: the AWB simply stops filling in the forward AWB, or
 * the SKU picker stops appearing on a multi-line order, and the operator files
 * the claim against whichever line happened to be first.
 *
 * So these assert the CONTRACT the hooks depend on, endpoint by endpoint.
 */

const mocks = vi.hoisted(() => ({
  orderByAwb: vi.fn(),
  orderScreenshots: vi.fn(),
  masterOrderInfo: vi.fn(),
  accountByAwb: vi.fn(),
  findClaimByAwb: vi.fn()
}))

vi.mock('@renderer/services/claimCreate.service', () => mocks)

const api = await import('@renderer/pages/claims/create/api')

beforeEach(() => {
  for (const fn of Object.values(mocks)) fn.mockReset()
})

describe('/order/{awb} — the master rows behind an AWB', () => {
  /** What the backend actually answers: siblings BESIDE `data`, not inside it. */
  const envelope = {
    isSuccess: true,
    data: [
      {
        return_awb: 'AB10007C',
        forward_awb: '5263527367247',
        return_video_link: 'https://example.test/return.mp4',
        forward_video_link: 'https://example.test/forward.mp4',
        customerOrderNumber: 'ORD-1'
      }
    ],
    skus: ['SKU-A', 'SKU-B'],
    records: [
      { _id: 'r1', sku: 'SKU-A', returnAwb: 'AB10007C', pobId: 'POB-1' },
      { _id: 'r2', sku: 'SKU-B', returnAwb: 'AB10007C', pobId: 'POB-2' }
    ]
  }

  it('hands the caller the video links, the sibling AWB and the order number', async () => {
    mocks.orderByAwb.mockResolvedValue({ success: true, data: envelope })

    const res = await api.getOrderByAwb('AB10007C', 'Return')
    const row = res.data.data?.[0]

    expect(res.status).toBe(200)
    expect(row?.forward_awb).toBe('5263527367247')
    expect(row?.return_video_link).toBe('https://example.test/return.mp4')
    expect(row?.customerOrderNumber).toBe('ORD-1')
  })

  it('KEEPS `skus` and `records`, which sit beside `data`', async () => {
    // The multi-line SKU picker is built from `records`. An unwrap that returned
    // only `data` would drop them, and a two-line order would file silently
    // against the first line.
    mocks.orderByAwb.mockResolvedValue({ success: true, data: envelope })

    const res = await api.getOrderByAwb('AB10007C', 'Return')

    expect(res.data.skus).toEqual(['SKU-A', 'SKU-B'])
    expect(res.data.records).toHaveLength(2)
    expect(res.data.records?.[1]?.pobId).toBe('POB-2')
  })

  it('passes the order type through, because Return and Forward differ', async () => {
    mocks.orderByAwb.mockResolvedValue({ success: true, data: envelope })

    await api.getOrderByAwb('AB10007C', 'Forward')

    expect(mocks.orderByAwb).toHaveBeenCalledWith('AB10007C', 'Forward')
  })
})

describe('/order/screenshot/{awb} — the VMS shots', () => {
  it('answers a plain list of URLs under `data.data`', async () => {
    // `useVmsScreenshots` reads exactly this, then places them into slots and
    // opens the Rearrange modal.
    const shots = ['https://example.test/1.jpg', 'https://example.test/2.jpg']
    mocks.orderScreenshots.mockResolvedValue({ success: true, data: shots })

    const res = await api.getOrderScreenshots('AB10007C', 'Return')

    expect(res.data.data).toEqual(shots)
  })

  it('throws on failure rather than answering an empty list', async () => {
    // An empty list means "this AWB has no footage" and CLEARS the slots. A
    // failed request must not be read as that.
    mocks.orderScreenshots.mockResolvedValue({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'VMS unreachable' }
    })

    await expect(api.getOrderScreenshots('AB10007C', 'Return')).rejects.toThrow('VMS unreachable')
  })
})

describe('/master/*-order-info — the per-marketplace row', () => {
  it('routes Meesho to Meesho and reports `isSuccess` the caller checks', async () => {
    mocks.masterOrderInfo.mockResolvedValue({
      success: true,
      data: { subOrderNo: 'SUB-1', returnAwbNo: 'AB10007C', courierPartner: 'Delhivery' }
    })

    const res = await api.getMeeshoOrderInfo({ returnAwbNo: 'AB10007C' })
    const row = res.data.data as { subOrderNo?: string; courierPartner?: string } | null

    expect(mocks.masterOrderInfo).toHaveBeenCalledWith('meesho', { returnAwbNo: 'AB10007C' })
    expect(res.data.isSuccess).toBe(true)
    expect(row?.subOrderNo).toBe('SUB-1')
    expect(row?.courierPartner).toBe('Delhivery')
  })

  it('keeps the three marketplaces apart', async () => {
    mocks.masterOrderInfo.mockResolvedValue({ success: true, data: {} })

    await api.getSnapdealOrderInfo({ subOrderNo: 'S1' })
    await api.getMyntraOrderInfo({ returnTrackingNumber: 'M1' })

    expect(mocks.masterOrderInfo).toHaveBeenNthCalledWith(1, 'snapdeal', { subOrderNo: 'S1' })
    expect(mocks.masterOrderInfo).toHaveBeenNthCalledWith(2, 'myntra', { returnTrackingNumber: 'M1' })
  })
})

describe('/cms/account-by-awb — which seller account this AWB is filed under', () => {
  it('answers the account under `data.data.account`', async () => {
    mocks.accountByAwb.mockResolvedValue({ success: true, data: { account: 'ops@ajio.example' } })

    const res = await api.getAccountByAwb('AB10007C', 'ajio', 'Return')

    expect(res.data.data?.account).toBe('ops@ajio.example')
  })

  it('carries a null account through rather than throwing', async () => {
    // Not every platform has a master lookup; "no account" is a normal answer
    // and must leave the operator's own pick alone.
    mocks.accountByAwb.mockResolvedValue({ success: true, data: { account: null } })

    const res = await api.getAccountByAwb('AB10007C', 'shopify', 'Return')

    expect(res.data.data?.account).toBeNull()
  })
})

describe('failures reach the ported catch blocks in the shape they expect', () => {
  it('throws an axios-shaped error carrying the backend message', async () => {
    // Every ported handler reads `error.response.data.displayMessage`. An error
    // that does not carry one surfaces as "[object Object]" to the operator.
    mocks.findClaimByAwb.mockResolvedValue({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: 'That claim belongs to another company.' }
    })

    await expect(api.findCmsByAwb('AB10007C', 'ajio')).rejects.toMatchObject({
      response: { data: { displayMessage: 'That claim belongs to another company.' } }
    })
  })
})
