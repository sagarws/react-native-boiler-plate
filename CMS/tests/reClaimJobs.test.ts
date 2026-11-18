import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/trackvid-test' },
  dialog: {},
  shell: {},
  BrowserWindow: { getAllWindows: () => [] }
}))
vi.mock('@main/services/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}))

/**
 * The stores, stubbed at module scope.
 *
 * `vi.mock` is hoisted above the imports, which `vi.doMock` is not — and
 * jobs.service is imported below, so a mock registered inside a test would
 * arrive after it had already bound the real stores.
 */
vi.mock('@main/services/reClaimArchive.store', () => ({
  clearReClaimJobs: () => Promise.resolve(0),
  initialiseReClaimArchive: vi.fn(),
  readReClaimJobs: () =>
    Promise.resolve([
      {
        jobId: 'job-1',
        status: 'done',
        startedAt: '2026-09-15T09:00:00.000Z',
        finishedAt: '2026-09-15T09:40:00.000Z',
        error: null,
        username: 'seller@example.com',
        source: 'file',
        fileName: 'rejections.xlsx',
        total: 3,
        raised: 2,
        refused: 1,
        tickets: [
          { ticketId: '9160818', status: 'AWAITING_AGENT_RESPONSE' },
          { ticketId: '9160819', status: null }
        ],
        failures: [{ ticketId: '9160820', reason: 'Ticket is not in a disputable state' }]
      }
    ])
}))
vi.mock('@main/services/bulkSpfArchive.store', () => ({
  clearBulkJobArchives: () => Promise.resolve(0),
  initialiseBulkJobArchive: vi.fn(),
  readJobArchives: () => Promise.resolve([])
}))
// Offline, so the list falls back to what this machine holds — which is also
// the case worth covering: the local archive is a real answer on its own.
vi.mock('@main/services/bulkSpfJob.service', () => ({
  listBulkJobs: () =>
    Promise.resolve({ success: false, error: { code: 'VALIDATION_ERROR', message: 'offline' } })
}))

const { manualReClaimRows } = await import('@main/services/reClaim.service')
// Pure; the handler around it opens a save dialog, this half does not.
const { reportSheets } = await import('@main/services/jobs.service')

/**
 * Rows typed into the app instead of uploaded.
 *
 * The rules are the sheet's: a ticket id and remarks, category optional. They
 * are enforced in the main process because that is the boundary — the window
 * can be wrong about what a valid row is, but this cannot be bypassed.
 */
describe('manualReClaimRows', () => {
  const row = (over: Partial<{ ticketId: string; description: string; issueCategory: string }>) => ({
    ticketId: '9160818',
    description: 'Please reconsider — the proofs match the SOP.',
    issueCategory: '',
    ...over
  })

  it('accepts a row with a ticket and remarks, and no category', () => {
    const result = manualReClaimRows({ rows: [row({})] })

    expect(result.success).toBe(true)

    if (!result.success) return

    expect(result.data.source).toBe('manual')
    expect(result.data.path).toBeNull()
    expect(result.data.rows).toHaveLength(1)
    expect(result.data.rows[0]?.issueCategory).toBe('')
  })

  it('keys `raw` the way the sheet does, so the table reads both the same', () => {
    const result = manualReClaimRows({ rows: [row({ description: 'Argued.' })] })

    expect(result.success).toBe(true)

    if (!result.success) return

    // The table renders `raw[column.key]`, and the remarks column is the
    // sheet's own header — a manual row keyed any other way would render blank.
    expect(result.data.rows[0]?.raw['RR Remarks']).toBe('Argued.')
  })

  it('drops a row that is entirely blank — that is somebody still typing', () => {
    const result = manualReClaimRows({
      rows: [row({}), { ticketId: '', description: '', issueCategory: '' }]
    })

    expect(result.success).toBe(true)

    if (!result.success) return

    expect(result.data.rows).toHaveLength(1)
  })

  it('refuses a half-filled row, and says which one', () => {
    const result = manualReClaimRows({ rows: [row({}), row({ description: '  ' })] })

    expect(result.success).toBe(false)

    if (result.success) return

    expect(result.error.message).toContain('Row 2')
  })

  it('refuses when nothing usable was typed at all', () => {
    expect(manualReClaimRows({ rows: [] }).success).toBe(false)
    expect(manualReClaimRows({}).success).toBe(false)
  })

  it('numbers the rows it keeps, not the ones it was given', () => {
    const result = manualReClaimRows({
      rows: [{ ticketId: '', description: '', issueCategory: '' }, row({ ticketId: '42' })]
    })

    expect(result.success).toBe(true)

    if (!result.success) return

    // The blank was dropped, so the surviving row is #1 — the `#` column means
    // one thing whether the rows came from a file or a form.
    expect(result.data.rows[0]?.rowNumber).toBe(1)
    expect(result.data.rows[0]?.ticketId).toBe('42')
  })
})

/**
 * A finished re-claim, as the Jobs page shows it.
 *
 * The mapping matters more than it looks: this is the ONLY record a dispute
 * leaves — TrackVid never hears about a re-claim — so a field dropped here is
 * a question with no answer anywhere.
 */
describe('the re-claim job archive, as a job row', () => {
  it('lists what was raised and what Myntra refused, with its reason', async () => {
    const { jobDetail, listJobs } = await import('@main/services/jobs.service')

    const list = await listJobs()

    expect(list.success).toBe(true)

    if (!list.success) return

    expect(list.data).toHaveLength(1)
    expect(list.data[0]?.platform).toBe('Myntra')
    expect(list.data[0]?.succeeded).toBe(2)
    expect(list.data[0]?.failed).toBe(1)
    // The account and the file, so a row is recognisable without opening it.
    expect(list.data[0]?.detail).toContain('seller@example.com')

    const detail = await jobDetail({ jobId: 'job-1', kind: 'myntra-re-claim' })

    expect(detail.success).toBe(true)

    if (!detail.success) return

    expect(detail.data.refLabel).toBe('Ticket')
    expect(detail.data.succeededRows.map(row => row.ref)).toEqual(['9160818', '9160819'])
    // Myntra's word for the ticket afterwards, where the read-back got one.
    expect(detail.data.succeededRows[0]?.note).toBe('AWAITING_AGENT_RESPONSE')
    expect(detail.data.failedRows[0]).toEqual({
      ref: '9160820',
      reason: 'Ticket is not in a disputable state',
      result: 'Refused'
    })
    // A run that finished is not partial, however many tickets it refused.
    expect(detail.data.partial).toBe(false)
  })

  it('answers for a job this machine has never seen', async () => {
    const { jobDetail } = await import('@main/services/jobs.service')
    const missing = await jobDetail({ jobId: 'nope', kind: 'myntra-re-claim' })

    expect(missing.success).toBe(false)

    if (missing.success) return

    expect(missing.error.code).toBe('NOT_FOUND')
  })
})

/**
 * A job's report, as a workbook.
 *
 * The page shows both lists already; the file is for what a page cannot do —
 * sending the refusals on, or sorting three hundred of them by reason. It is
 * built from the same JobDetail the page renders, so the two cannot disagree.
 */
describe('reportSheets', () => {

  const job = {
    jobId: 'job-1',
    kind: 'myntra-re-claim' as const,
    platform: 'Myntra',
    label: 'Re-claim',
    status: 'done' as const,
    startedAt: '2026-09-15T09:00:00.000Z',
    finishedAt: '2026-09-15T09:40:00.000Z',
    total: 2,
    succeeded: 1,
    failed: 1,
    error: null,
    detail: 'seller@example.com',
    refLabel: 'Ticket',
    partial: false,
    succeededRows: [{ ref: '9160818', ticketId: null, note: 'AWAITING_AGENT_RESPONSE' }],
    failedRows: [{ ref: '9160820', reason: 'Not disputable', result: 'Refused' }]
  }

  it('names the article on a failed row when one return fails per article', () => {
    const sheets = reportSheets({
      ...job,
      failedRows: [
        { ref: 'RT1', sku: '8900000000001', reason: 'SKU validation failed', result: 'Failed' },
        { ref: 'RT1', sku: '8900000000002', reason: 'SKU validation failed', result: 'Failed' }
      ]
    })

    expect(sheets[1]?.columns).toEqual(['Ticket', 'SKU', 'Result', 'Reason'])
    expect(sheets[1]?.rows[1]).toEqual(['RT1', '8900000000002', 'Failed', 'SKU validation failed'])
  })

  it('leaves the SKU column off a failed sheet that has none', () => {
    expect(reportSheets(job)[1]?.columns).toEqual(['Ticket', 'Result', 'Reason'])
  })

  it('writes both sheets, even when one of them is empty', () => {
    const sheets = reportSheets({ ...job, failedRows: [] })

    expect(sheets.map(sheet => sheet.name)).toEqual(['Successful', 'Failed'])
    // "Nothing failed" is an answer; a missing sheet reads like a cut-off file.
    expect(sheets[1]?.rows).toEqual([])
  })

  it('leaves out a column the job never fills', () => {
    const sheets = reportSheets(job)

    // A re-claim reopens the ticket it was given, so there is no second id and
    // no column for one.
    expect(sheets[0]?.columns).toEqual(['Ticket', 'Myntra status'])
    expect(sheets[0]?.rows).toEqual([['9160818', 'AWAITING_AGENT_RESPONSE']])
  })

  it('names the note column after the job it came from', () => {
    const bulk = reportSheets({
      ...job,
      kind: 'ajio-bulk-claim' as const,
      refLabel: 'Return AWB',
      succeededRows: [{ ref: 'AWB1', ticketId: 'T1', note: 'SKU1' }]
    })

    expect(bulk[0]?.columns).toEqual(['Return AWB', 'Ticket', 'SKU'])
  })

  it("keeps the marketplace's own reason, and what the job called it", () => {
    const sheets = reportSheets(job)

    expect(sheets[1]?.columns).toEqual(['Ticket', 'Result', 'Reason'])
    expect(sheets[1]?.rows).toEqual([['9160820', 'Refused', 'Not disputable']])
  })
})
