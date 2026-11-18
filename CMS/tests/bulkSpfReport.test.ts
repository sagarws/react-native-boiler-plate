import { describe, expect, it, vi } from 'vitest'
import type { BulkJobDetail, BulkSpfResultRow, BulkSpfRun } from '@shared/types/bulkSpf'

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/trackvid-test' },
  dialog: {},
  shell: {},
  BrowserWindow: { getAllWindows: () => [] }
}))
vi.mock('@main/services/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

const { archiveFromRun } = await import('@main/services/bulkSpfArchive.store')
const { reportOf } = await import('@main/services/bulkSpfJob.service')

/**
 * A job's report in History: the same message the bulk claim posts, built from
 * this machine's archive when it ran the job, else from TrackVid's record.
 */

const row = (over: Partial<BulkSpfResultRow>): BulkSpfResultRow => ({
  awb: 'A1',
  sku: 'S1',
  claimType: 'DDR',
  pobid: 'DV1',
  orderStatus: '',
  result: 'Success',
  reason: '',
  ticketNumber: '',
  error: '',
  timestamp: '2026-09-14T00:00:00.000Z',
  ...over
})

const run: BulkSpfRun = {
  id: '475e072a-988f-4bde-81b2-ecd4b2deadb0',
  jobRecorded: true,
  status: 'done',
  startedAt: '2026-09-14T10:00:00.000Z',
  finishedAt: '2026-09-14T10:30:00.000Z',
  uploads: [{ claimType: 'DDR', filePath: '/x.xlsx', fileName: 'x.xlsx', rowCount: 4 }],
  buckets: { claimable: 3, alreadyClaimed: 0, missingPob: 0, unknownType: 0, noAccount: 1, notSelected: 0, duplicate: 0, noReturnNumber: 0 },
  claimable: 3,
  done: 3,
  summary: { total: 4, success: 2, failed: 1, helpCenterFailed: 0, notClaimable: 0, dryRun: 0, skipped: 1, pending: 0 },
  rows: [
    row({ awb: 'A1', sku: 'S1', result: 'Success', ticketNumber: 'T1' }),
    // Same return, second article: one input AWB, two claim rows.
    row({ awb: 'A1', sku: 'S2', result: 'Success', ticketNumber: 'T2' }),
    row({ awb: 'A2', sku: 'S3', result: 'Failed', error: 'claim create failed: status=502' }),
    row({ awb: 'A3', sku: 'S4', result: 'Skipped', reason: 'No AJIO login holds POB DV9', attempt: 1 })
  ],
  reportPath: null,
  accounts: ['online1@wrogn.com'],
  error: null
}

describe('archiveFromRun', () => {
  it('keeps the tickets and every article that was not filed', () => {
    const archive = archiveFromRun(run)

    expect(archive).toMatchObject({ jobId: run.id, status: 'done', inputAwbs: 3, claimRows: 4 })
    expect(archive.tickets).toEqual([
      { awb: 'A1', sku: 'S1', ticketId: 'T1', attempt: 1 },
      { awb: 'A1', sku: 'S2', ticketId: 'T2', attempt: 1 }
    ])
    expect(archive.unfiled).toEqual([
      { awb: 'A2', sku: 'S3', result: 'Failed', reason: 'claim create failed: status=502', attempt: 1 },
      { awb: 'A3', sku: 'S4', result: 'Skipped', reason: 'No AJIO login holds POB DV9', attempt: 1 }
    ])
  })
})

describe('reportOf', () => {
  it('builds the message from the local archive — Failed lines only, keyed by Return AWB', () => {
    const report = reportOf(archiveFromRun(run), null)

    expect(report).toMatchObject({
      source: 'local',
      status: 'COMPLETED',
      inputAwbs: 3,
      claimRows: 4,
      success: 2,
      failed: 1,
      skipped: 1,
      failedTotal: 1
    })
    expect(report?.failedLines).toEqual([
      { awb: 'A2', sku: 'S3', result: 'Failed', reason: 'claim create failed: status=502' }
    ])
  })

  it('falls back to TrackVid for a job run elsewhere, and prefers TrackVid\'s status', () => {
    const job: BulkJobDetail = {
      jobId: run.id,
      status: 'STALE',
      startedAt: run.startedAt,
      finishedAt: null,
      totalAwbs: 4,
      processedAwbs: 3,
      successCount: 2,
      failedCount: 1,
      skippedCount: 1,
      fileNames: [],
      accounts: [],
      error: null,
      failedAwbs: [
        { awb: 'A2', sku: 'S3', claimType: 'DDR', pobid: 'DV1', result: 'Help Center Failed', error: 'attachment failed', ticketNumber: 'T9' },
        { awb: 'A3', sku: 'S4', claimType: 'DDR', pobid: 'DV9', result: 'Skipped', error: 'no login', ticketNumber: '' }
      ]
    }

    const remote = reportOf(null, job)

    expect(remote).toMatchObject({ source: 'trackvid', status: 'STALE', inputAwbs: null, failed: 1, skipped: 1 })
    expect(remote?.failedLines).toEqual([{ awb: 'A2', sku: 'S3', result: 'Help Center Failed', reason: 'attachment failed' }])

    expect(reportOf(archiveFromRun(run), job)?.status).toBe('STALE')
    expect(reportOf(null, null)).toBeNull()
  })
})

describe('the attempt on the downloaded report', () => {
  it('adds an Attempt column to every sheet when the job counts attempts', async () => {
    const { reportSheets } = await import('@main/services/jobs.service')
    const sheets = reportSheets({
      jobId: 'j1',
      kind: 'ajio-bulk-claim',
      platform: 'Ajio',
      label: 'NDR/DDR bulk claim',
      status: 'done',
      startedAt: '2026-10-15T00:00:00.000Z',
      finishedAt: null,
      total: 2,
      succeeded: 1,
      failed: 1,
      error: null,
      detail: '',
      refLabel: 'Return AWB',
      succeededRows: [{ ref: 'A1', ticketId: 'T1', note: 'S1', attempt: 2 }],
      failedRows: [{ ref: 'A2', reason: 'no', result: 'Failed', sku: 'S2', attempt: 3 }],
      partial: false
    })

    expect(sheets.map(sheet => sheet.columns.at(-1))).toEqual(['Attempt', 'Attempt'])
    expect(sheets[0]?.rows[0]?.at(-1)).toBe(2)
    expect(sheets[1]?.rows[0]?.at(-1)).toBe(3)
  })
})
