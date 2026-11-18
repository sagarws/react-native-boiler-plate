import { createRequire } from 'node:module'
import { describe, expect, it, vi } from 'vitest'

/**
 * AJIO's dropship reports, read a page at a time.
 *
 * Two endpoints behind one shape. What matters is the request they need, and
 * one detail of it is the difference between a working report and a silently
 * empty one: the places of business go in a form-urlencoded BODY, not the query
 * string. Sent as a query parameter AJIO answers 200 with an empty list — which
 * reads as "this seller had no orders" rather than as a malformed request.
 */

const require_ = createRequire(import.meta.url)

interface ReportView {
  REPORT_TYPES: string[]
  MAX_PAGE_SIZE: number
  reportDescriptor: (type: string) => { label: string; path: string; listKey: string } | null
  fetchDropshipReport: (
    page: unknown,
    input: Record<string, unknown>
  ) => Promise<{ rows: unknown[]; pageNumber: number; totalPages: number; columns: unknown[] }>
}

const view = (): ReportView =>
  require_(
    '@trackvid/automation-core/platforms/ajio/master-import/api-based-flow/reportView'
  ) as ReportView

/** A page whose `evaluate` records what it was asked and answers with a body. */
const pageAnswering = (body: unknown, status = 200) => {
  const seen: { url: string; payload: string; model: string }[] = []

  return {
    seen,
    page: {
      evaluate: (_fn: unknown, url: string, payload: string, model: string) => {
        seen.push({ url, payload, model })

        return Promise.resolve({ status, text: JSON.stringify(body) })
      }
    }
  }
}

const ok = (listKey: string, rows: unknown[], totalPages = 1) => ({
  success: true,
  statusCode: 200,
  result: { [listKey]: rows, pageNumber: 0, totalPages }
})

describe('reportDescriptor', () => {
  it('knows both reports and where each keeps its rows', () => {
    const { reportDescriptor } = view()

    expect(reportDescriptor('forward')).toMatchObject({
      path: '/malekith/vision/v1/dropship/order/report',
      listKey: 'orderList'
    })
    expect(reportDescriptor('return')).toMatchObject({
      path: '/malekith/vision/v1/dropship/rtv/report',
      listKey: 'rtvList'
    })
  })

  it('is case-insensitive and refuses anything else', () => {
    const { reportDescriptor } = view()

    expect(reportDescriptor(' Forward ')).not.toBeNull()
    expect(reportDescriptor('sales')).toBeNull()
    expect(reportDescriptor('')).toBeNull()
  })
})

describe('fetchDropshipReport', () => {
  const args = {
    pobIds: ['DV00332654', 'DV00337096'],
    from: '2026-08-01',
    to: '2026-08-31'
  }

  it('sends the POBs in the body, not the query string', async () => {
    const { fetchDropshipReport } = view()
    const { page, seen } = pageAnswering(ok('orderList', [{ orderNo: 'FN1' }]))

    await fetchDropshipReport(page, { reportType: 'forward', ...args })

    // The detail that decides whether the report works at all.
    expect(seen[0]?.payload).toBe('pobIds=DV00332654%2CDV00337096')
    expect(seen[0]?.url).not.toContain('pobIds')
    expect(seen[0]?.url).toContain('/dropship/order/report?page=0&size=50')
    expect(seen[0]?.url).toContain('from=2026-08-01&to=2026-08-31')
  })

  it('reads the rows out of the key that report uses', async () => {
    const { fetchDropshipReport } = view()
    const { page } = pageAnswering(ok('rtvList', [{ returnOrderNo: 'RT1' }], 7))

    const answer = await fetchDropshipReport(page, { reportType: 'return', ...args })

    expect(answer.rows).toEqual([{ returnOrderNo: 'RT1' }])
    expect(answer.totalPages).toBe(7)
    // Columns travel with the rows: the marketplace knowledge of which fields
    // are worth showing belongs beside the endpoint, not in the window.
    expect(answer.columns.length).toBeGreaterThan(5)
  })

  it('refuses to ask when the account has no POBs', async () => {
    const { fetchDropshipReport } = view()
    const { page, seen } = pageAnswering(ok('orderList', []))

    // AJIO answers an empty POB list with an empty report, which reads as "this
    // seller had nothing" — a wrong answer is worse than a refusal.
    await expect(
      fetchDropshipReport(page, { reportType: 'forward', ...args, pobIds: [] })
    ).rejects.toThrow(/Sync POBs/i)
    expect(seen).toEqual([])
  })

  it('caps the page size at what AJIO’s own screen asks for', async () => {
    const { fetchDropshipReport, MAX_PAGE_SIZE } = view()
    const { page, seen } = pageAnswering(ok('orderList', []))

    await fetchDropshipReport(page, { reportType: 'forward', ...args, size: 5000 })

    expect(seen[0]?.url).toContain(`size=${MAX_PAGE_SIZE}`)
  })

  it('reports a refusal rather than returning an empty page', async () => {
    const { fetchDropshipReport } = view()
    const { page } = pageAnswering({ message: 'nope' }, 401)

    // A 401 turned into "no rows" would read as a seller with no orders, and
    // send someone looking at master data instead of at their session.
    await expect(fetchDropshipReport(page, { reportType: 'forward', ...args })).rejects.toThrow(
      /HTTP 401/
    )
  })

  it('needs a date window', async () => {
    const { fetchDropshipReport } = view()
    const { page } = pageAnswering(ok('orderList', []))

    await expect(
      fetchDropshipReport(page, { reportType: 'forward', pobIds: args.pobIds, from: '', to: '' })
    ).rejects.toThrow(/from and to/)
  })

  it('survives a body that is not JSON', async () => {
    const { fetchDropshipReport } = view()
    const page = {
      evaluate: vi.fn().mockResolvedValue({ status: 200, text: '<html>gateway timeout</html>' })
    }

    await expect(fetchDropshipReport(page, { reportType: 'forward', ...args })).rejects.toThrow(
      /non-JSON/
    )
  })
})
