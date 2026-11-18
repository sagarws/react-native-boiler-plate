import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BulkSpfResultRow, BulkSpfRun } from '@shared/types/bulkSpf'

const apiRequest = vi.fn()

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/trackvid-test' },
  dialog: {},
  shell: {},
  BrowserWindow: { getAllWindows: () => [] }
}))
vi.mock('@main/services/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock('@main/services/httpClient', () => ({ apiRequest }))
vi.mock('@main/services/session.store', () => ({ getAccessToken: () => 'token', getSession: () => null }))
vi.mock('@main/services/bulkSpfArchive.store', async importOriginal => ({
  ...(await importOriginal<object>()),
  readJobArchive: vi.fn(() => Promise.resolve(null)),
  writeJobArchive: vi.fn(() => Promise.resolve())
}))

const { createBulkJob, reopenBulkJob, reportBulkJob } = await import('@main/services/bulkSpfJob.service')
const { firstPassRows, keepSelected, planKey, resetForRetry, retryableKeys, retrySelection, settlePending } = await import(
  '@main/services/bulkSpf.service'
)

/**
 * The bulk claim's job record in TrackVid's `scriptjobs`: created when the run
 * starts, heart-beaten while it files, and closed with every AWB it did not file.
 */

const result = (over: Partial<BulkSpfResultRow>): BulkSpfResultRow => ({
  awb: 'R1',
  sku: 'S1',
  claimType: 'NDR',
  pobid: 'DV1',
  orderStatus: '',
  result: 'Success',
  reason: '',
  ticketNumber: '',
  error: '',
  timestamp: '2026-09-14T00:00:00.000Z',
  ...over
})

const run = (over: Partial<BulkSpfRun> = {}): BulkSpfRun => ({
  id: '0b6f2c7e-1111-4222-8333-944455556666',
  jobRecorded: true,
  status: 'done',
  startedAt: '2026-09-14T00:00:00.000Z',
  finishedAt: '2026-09-14T00:10:00.000Z',
  uploads: [{ claimType: 'NDR', filePath: '/x.xlsx', fileName: 'x.xlsx', rowCount: 4 }],
  buckets: { claimable: 3, alreadyClaimed: 0, missingPob: 1, unknownType: 0, noAccount: 0, notSelected: 0, duplicate: 0, noReturnNumber: 0 },
  claimable: 3,
  done: 3,
  summary: { total: 4, success: 1, failed: 1, helpCenterFailed: 0, notClaimable: 1, dryRun: 0, skipped: 1, pending: 0 },
  rows: [
    result({ awb: 'R1', result: 'Success', ticketNumber: 'T1' }),
    result({ awb: 'R2', result: 'Failed', error: 'AJIO said no', pobid: 'DV2' }),
    result({ awb: 'R3', result: 'Not Claimable', reason: 'old return' }),
    result({ awb: 'R4', result: 'Skipped', reason: 'No POB ID in the sheet', pobid: '' })
  ],
  reportPath: null,
  accounts: ['a@x.com'],
  error: null,
  ...over
})

beforeEach(() => {
  apiRequest.mockReset()
  apiRequest.mockResolvedValue({ success: true, data: {} })
})

describe('bulk claim job record', () => {
  it('creates the job under the run id with its files and counts', async () => {
    expect(await createBulkJob(run({ status: 'running' }))).toBe(true)

    const [path, options] = apiRequest.mock.calls[0] as [string, { method: string; body: Record<string, unknown> }]

    expect(path).toBe('/cms/desktop-bulk-jobs')
    expect(options.method).toBe('POST')
    expect(options.body).toMatchObject({
      jobId: '0b6f2c7e-1111-4222-8333-944455556666',
      totalAwbs: 4,
      fileNames: ['NDR: x.xlsx'],
      accounts: ['a@x.com']
    })
  })

  it('reports a heartbeat with counts only, and never the AWB list', async () => {
    await reportBulkJob(run({ status: 'running' }))

    const [path, options] = apiRequest.mock.calls[0] as [string, { method: string; body: Record<string, unknown> }]

    expect(path).toBe('/cms/desktop-bulk-jobs/0b6f2c7e-1111-4222-8333-944455556666')
    expect(options.method).toBe('PATCH')
    expect(options.body).toMatchObject({ processedAwbs: 3, successCount: 1, failedCount: 2, skippedCount: 1 })
    expect(options.body).not.toHaveProperty('status')
    expect(options.body).not.toHaveProperty('failedAwbs')
  })

  it('closes the job with every AWB that was not filed', async () => {
    await reportBulkJob(run(), true)

    const body = (apiRequest.mock.calls[0] as [string, { body: Record<string, unknown> }])[1].body

    expect(body.status).toBe('COMPLETED')
    expect(body.failedAwbs).toEqual([
      { awb: 'R2', sku: 'S1', claimType: 'NDR', pobid: 'DV2', result: 'Failed', error: 'AJIO said no', ticketNumber: '', attempt: 1 },
      { awb: 'R3', sku: 'S1', claimType: 'NDR', pobid: 'DV1', result: 'Not Claimable', error: 'old return', ticketNumber: '', attempt: 1 },
      { awb: 'R4', sku: 'S1', claimType: 'NDR', pobid: '', result: 'Skipped', error: 'No POB ID in the sheet', ticketNumber: '', attempt: 1 }
    ])
  })

  it('marks a stopped run FAILED, and says nothing for a job TrackVid never recorded', async () => {
    await reportBulkJob(run({ status: 'failed', error: 'browser crashed' }), true)
    expect((apiRequest.mock.calls[0] as [string, { body: Record<string, unknown> }])[1].body).toMatchObject({
      status: 'FAILED',
      error: 'browser crashed'
    })

    apiRequest.mockClear()
    await reportBulkJob(run({ jobRecorded: false }), true)
    expect(apiRequest).not.toHaveBeenCalled()
  })
})

describe('Selected Proceed', () => {
  const entry = (claimType: string, awb: string, sku: string) => ({
    awbNumber: awb,
    return_order_no: '',
    sku,
    pobid: 'DV1',
    claimType,
    masterImportId: ''
  })

  const groups = () => [
    {
      credentials: { username: 'a@x.com', password: 'p' },
      companyId: 'c',
      accountEmail: 'a@x.com',
      configArr: [entry('NDR', 'R1', 'S1'), entry('DDR', 'R1', 'S1')]
    },
    { credentials: { username: 'b@x.com', password: 'p' }, companyId: 'c', accountEmail: 'b@x.com', configArr: [entry('NDR', 'R2', '')] }
  ]

  it('files only the ticked keys — claim type is part of the key', () => {
    const { groups: kept, notSelected } = keepSelected(groups(), [planKey('DDR', 'R1', 'S1')])

    expect(kept.map(g => [g.accountEmail, g.configArr.map(e => `${e.claimType}:${e.awbNumber}`)])).toEqual([
      ['a@x.com', ['DDR:R1']]
    ])
    expect(notSelected.map(e => `${e.claimType}:${e.awbNumber}`)).toEqual(['NDR:R1', 'NDR:R2'])
  })
})

describe('Retry failed', () => {
  const entry = (awb: string) => ({
    awbNumber: awb,
    return_order_no: '',
    sku: 'S1',
    pobid: 'DV2',
    claimType: 'NDR',
    masterImportId: ''
  })

  const scoped = () => [
    ...run().rows,
    result({ awb: 'R5', result: 'Help Center Failed' }),
    result({ awb: 'R6', result: 'Pending' }),
    // A repeat of a sheet row: no retry can change it.
    result({ awb: 'R1', result: 'Skipped', reason: 'Duplicate of sheet row 2', final: true })
  ]

  it('Failed retries every refusal — Failed, Help Center Failed, never-attempted, and Not Claimable', () => {
    expect(retryableKeys(scoped(), 'failed')).toEqual([
      planKey('NDR', 'R2', 'S1'),
      planKey('NDR', 'R3', 'S1'),
      planKey('NDR', 'R5', 'S1'),
      planKey('NDR', 'R6', 'S1')
    ])
  })

  it('Skipped retries every skipped row, final ones included', () => {
    expect(retryableKeys(scoped(), 'skipped')).toEqual([planKey('NDR', 'R4', 'S1'), planKey('NDR', 'R1', 'S1')])
  })

  it('Both retries every row that was not filed — never a Success', () => {
    expect(retryableKeys(scoped(), 'both')).toEqual([
      planKey('NDR', 'R2', 'S1'),
      planKey('NDR', 'R3', 'S1'),
      planKey('NDR', 'R4', 'S1'),
      planKey('NDR', 'R5', 'S1'),
      planKey('NDR', 'R6', 'S1'),
      planKey('NDR', 'R1', 'S1')
    ])
  })

  const group = (configArr: ReturnType<typeof entry>[]) => [
    { credentials: { username: 'b@x.com', password: 'p' }, companyId: 'c', accountEmail: 'b@x.com', configArr }
  ]

  it('files only the scope picked', () => {
    const groups = group([entry('R2'), entry('R4'), entry('R1')])
    const files = (scope: 'failed' | 'skipped' | 'both') =>
      retrySelection(groups, run().rows, scope).flatMap(g => g.configArr.map(e => e.awbNumber))

    expect(files('failed')).toEqual(['R2'])
    expect(files('skipped')).toEqual(['R4'])
    expect(files('both')).toEqual(['R2', 'R4'])
  })

  it('splits a return filed without its article into one row per article, in its place', () => {
    // The first pass did not read the EAN column: RT9 was one article-less row.
    const first = run({
      rows: [result({ awb: 'R1', result: 'Success', ticketNumber: 'T1' }), result({ awb: 'RT9', sku: '', result: 'Failed' })]
    })
    const articles = [
      { ...entry('RT9'), sku: 'E1' },
      { ...entry('RT9'), sku: 'E2' }
    ]

    expect(retrySelection(group(articles), first.rows, 'failed').flatMap(g => g.configArr.map(e => e.sku))).toEqual([
      'E1',
      'E2'
    ])

    const next = resetForRetry(first, articles, [])

    expect(next.rows.map(row => `${row.awb}/${row.sku}:${row.result}`)).toEqual([
      'R1/S1:Success',
      'RT9/E1:Pending',
      'RT9/E2:Pending'
    ])
    expect(next.claimable).toBe(3)
  })

  it('counts the attempt: a re-filed row is one more than it was, the rest keep theirs', () => {
    const first = run()
    const once = resetForRetry(first, [entry('R2')], [])

    // R2 was re-filed: its first filing was attempt 1, this is attempt 2.
    expect(once.rows.find(row => row.awb === 'R2')?.attempt).toBe(2)
    // R1 succeeded and was not touched — still its first, and still unnumbered.
    expect(once.rows.find(row => row.awb === 'R1')?.attempt ?? 1).toBe(1)

    // A second retry of the same row is its third attempt.
    const twice = resetForRetry({ ...once, status: 'done' }, [entry('R2')], [])

    expect(twice.rows.find(row => row.awb === 'R2')?.attempt).toBe(3)
  })

  /*
   * THE BUG THESE PIN: `configArr.map(pendingRow)` handed Array.map's INDEX to
   * pendingRow's `attempt` parameter, so a first Submit of 400 claims reported
   * "Attempt 16 … 57" with no Retry ever pressed — each row's position in its
   * account group. One-row tests could not see it: index 0 reads as attempt 1.
   */
  it('a first Submit puts every row on attempt 1, however many there are', () => {
    const many = Array.from({ length: 60 }, (_, i) => entry(`RT${i}`))
    const rows = firstPassRows([...group(many), ...group(many.slice(0, 5))])

    expect(rows).toHaveLength(65)
    expect(new Set(rows.map(row => row.attempt))).toEqual(new Set([1]))
  })

  it('a retry re-files many rows, each exactly one more than it was', () => {
    const first = run({
      rows: Array.from({ length: 30 }, (_, i) => result({ awb: `RT${i}`, result: 'Failed', attempt: 1 }))
    })
    const next = resetForRetry(
      first,
      first.rows.map(row => entry(row.awb)),
      []
    )

    expect(new Set(next.rows.map(row => row.attempt))).toEqual(new Set([2]))
  })

  it('a retried article with no row of its own starts on attempt 1, not its position', () => {
    const next = resetForRetry(run(), [entry('RX1'), entry('RX2'), entry('RX3'), entry('RX4')], [])

    expect(next.rows.filter(row => row.awb.startsWith('RX')).map(row => row.attempt)).toEqual([1, 1, 1, 1])
  })

  it('leaves a final row alone even when it shares a retried key', () => {
    const first = run({
      rows: [
        result({ awb: 'R2', result: 'Failed' }),
        result({ awb: 'R2', result: 'Skipped', reason: 'Duplicate of sheet row 2', final: true })
      ]
    })

    expect(resetForRetry(first, [entry('R2')], []).rows.map(row => row.result)).toEqual(['Pending', 'Skipped'])
  })

  it('settles a finished run: nothing is left Pending, each says why it was not filed', () => {
    const settled = settlePending(
      run({ rows: [result({ awb: 'R1', result: 'Success' }), result({ awb: 'R2', result: 'Pending' })] }),
      'Not filed — Stopped'
    )

    expect(settled.rows.map(row => `${row.result}:${row.reason}`)).toEqual(['Success:', 'Skipped:Not filed — Stopped'])
    expect(retryableKeys(settled.rows, 'skipped')).toEqual([planKey('NDR', 'R2', 'S1')])
  })

  it('resets only the retried rows, so the run stays one combined result', () => {
    const next = resetForRetry(run(), [entry('R2')], ['b@x.com'])

    expect(next.id).toBe(run().id)
    expect(next.status).toBe('running')
    expect(next.finishedAt).toBeNull()
    expect(next.rows.map(row => `${row.awb}:${row.result}`)).toEqual([
      'R1:Success',
      'R2:Pending',
      'R3:Not Claimable',
      'R4:Skipped'
    ])
    // The success from the first attempt is kept, ticket and all.
    expect(next.rows[0]?.ticketNumber).toBe('T1')
    expect(next.rows[1]?.pobid).toBe('DV2')
    expect(next.done).toBe(2)
    expect(next.attempts).toBe(2)
    expect(next.retrying).toBe(1)
    expect(next.accounts).toEqual(['a@x.com', 'b@x.com'])
    expect(resetForRetry(next, [entry('R2')], []).attempts).toBe(3)
  })

  it('reopens the same TrackVid job as RUNNING rather than creating another', async () => {
    await reopenBulkJob(run())

    const [path, options] = apiRequest.mock.calls[0] as [string, { method: string; body: Record<string, unknown> }]

    expect(path).toBe('/cms/desktop-bulk-jobs/0b6f2c7e-1111-4222-8333-944455556666')
    expect(options.method).toBe('PATCH')
    expect(options.body).toMatchObject({ status: 'RUNNING' })

    apiRequest.mockClear()
    await reopenBulkJob(run({ jobRecorded: false }))
    expect(apiRequest).not.toHaveBeenCalled()
  })
})
