import { describe, expect, it, vi } from 'vitest'
import type { BackupJobArchive } from '@shared/types/masterBackup'

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
 * A finished backup, as the Jobs page sees it.
 *
 * The other job kinds answer "which AWBs went through"; this one answers
 * "which report, which dates, how many rows" — and nothing else, because the
 * rows went into the backup rather than into a report. So what is checked here
 * is that the run stays legible after the fact: a re-sync that saved nothing
 * because everything was already held must read as a success, and the counts
 * must not quietly mix rows with pages.
 */

const archive: BackupJobArchive = {
  jobId: 'backup-1',
  report: 'return',
  username: 'online1@wrogn.com',
  kind: 'months',
  from: '2026-08-01',
  to: '2026-09-30',
  startedAt: '2026-09-17T04:00:00.000Z',
  finishedAt: '2026-09-17T04:38:00.000Z',
  status: 'done',
  months: [
    { year: 2026, month: 8, added: 2040, skipped: 12, failed: 0 },
    { year: 2026, month: 9, added: 1555, skipped: 4, failed: 1 }
  ],
  added: 3595,
  skipped: 16,
  failed: 1,
  error: null
}

vi.mock('@main/services/masterBackupArchive.store', () => ({
  clearBackupJobs: () => Promise.resolve(0),
  initialiseBackupArchive: vi.fn(),
  readBackupJobs: () => Promise.resolve([archive])
}))
vi.mock('@main/services/reClaimArchive.store', () => ({
  clearReClaimJobs: () => Promise.resolve(0),
  initialiseReClaimArchive: vi.fn(),
  readReClaimJobs: () => Promise.resolve([])
}))
vi.mock('@main/services/accountMapArchive.store', () => ({
  clearAccountMapJobs: () => Promise.resolve(0),
  readAccountMapJobs: () => Promise.resolve([])
}))
vi.mock('@main/services/refillArchive.store', () => ({
  clearRefillJobs: () => Promise.resolve(0),
  initialiseRefillArchive: vi.fn(),
  readRefillJobs: () => Promise.resolve([])
}))
vi.mock('@main/services/bulkSpfArchive.store', () => ({
  clearBulkJobArchives: () => Promise.resolve(0),
  initialiseBulkJobArchive: vi.fn(),
  readJobArchives: () => Promise.resolve([])
}))
vi.mock('@main/services/bulkSpfJob.service', () => ({
  listBulkJobs: () =>
    Promise.resolve({ success: false, error: { code: 'VALIDATION_ERROR', message: 'offline' } })
}))

const { listJobs, jobDetail } = await import('@main/services/jobs.service')

describe('a backup in the Jobs list', () => {
  it('counts rows seen as the total and rows saved as the successes', async () => {
    const result = await listJobs()

    expect(result.success).toBe(true)

    if (!result.success) return

    const row = result.data.find(job => job.jobId === 'backup-1')

    expect(row?.kind).toBe('ajio-master-backup')
    expect(row?.platform).toBe('Ajio')
    // Everything AJIO handed over, and the part of it that was new.
    expect(row?.total).toBe(3611)
    expect(row?.succeeded).toBe(3595)
    // Pages, not rows — the only thing that can fail here.
    expect(row?.failed).toBe(1)
  })

  it('says the report and the dates on the line itself', async () => {
    const result = await listJobs()

    if (!result.success) return

    const row = result.data.find(job => job.jobId === 'backup-1')

    expect(row?.detail).toContain('Return Report')
    expect(row?.detail).toContain('2026-08-01 → 2026-09-30')
    expect(row?.detail).toContain('16 already held')
  })

  it('opens as stated facts, not as two tables', async () => {
    const result = await jobDetail({ jobId: 'backup-1', kind: 'ajio-master-backup' })

    expect(result.success).toBe(true)

    if (!result.success) return

    const stated = Object.fromEntries(
      (result.data.summary ?? []).map(line => [line.label, line.value])
    )

    expect(stated.Report).toBe('Return Report')
    expect(stated['Date range']).toBe('2026-08-01 → 2026-09-30')
    expect(stated['Records synced']).toBe('3,595')
    expect(stated['Pages failed']).toBe('1')
    // Nothing failed per-row, so there is no failures table to draw.
    expect(result.data.failedRows).toHaveLength(0)
  })

  it('lists the months it worked through, so an empty month is visible', async () => {
    const result = await jobDetail({ jobId: 'backup-1', kind: 'ajio-master-backup' })

    if (!result.success) return

    expect(result.data.refLabel).toBe('Month')
    expect(result.data.succeededRows.map(row => row.ref)).toEqual(['2026-08', '2026-09'])
    expect(result.data.succeededRows[1]?.note).toBe('1,555 saved, 4 already held, 1 page(s) failed')
  })
})
