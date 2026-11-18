import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { BackupRecord } from '@shared/types/masterBackup'

/**
 * The backup store, against a real directory.
 *
 * What is worth testing here is not that JSON round-trips — jsonStore.test
 * covers that — but the three promises this store makes to the rest of the
 * feature: a re-sync adds nothing it already holds, the calendar can be drawn
 * without reading every row, and a range delete goes by the row's OWN date
 * rather than by the month partition it happens to live in.
 */

const state = vi.hoisted(() => ({ directory: '' }))

vi.mock('@main/database', () => ({ dataDirectory: () => state.directory }))
vi.mock('@main/services/logger', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))

const store = await import('@main/services/masterBackup.store')

const record = (overrides: Partial<BackupRecord> & { awb: string; ean: string }): BackupRecord => ({
  key: store.recordKey(overrides.awb, overrides.ean),
  date: '2026-08-14',
  year: 2026,
  month: 8,
  page: 0,
  savedAt: '2026-08-14T00:00:00.000Z',
  row: { awbNumber: overrides.awb, ean: overrides.ean },
  ...overrides
})

beforeAll(async () => {
  state.directory = await mkdtemp(join(tmpdir(), 'trackvid-backup-'))
  store.initialiseMasterBackup()
})

afterAll(async () => {
  await rm(state.directory, { recursive: true, force: true })
})

describe('the AJIO backup store', () => {
  it('saves a month, then skips every row of it on a re-sync', async () => {
    const rows = [
      record({ awb: 'AWB1', ean: 'E1' }),
      record({ awb: 'AWB1', ean: 'E2' }),
      record({ awb: 'AWB2', ean: 'E1' })
    ]

    await expect(store.saveRecords('return', 2026, 8, rows)).resolves.toEqual({
      added: 3,
      skipped: 0
    })

    // The same page fetched again: nothing new, and nothing lost.
    await expect(store.saveRecords('return', 2026, 8, rows)).resolves.toEqual({
      added: 0,
      skipped: 3
    })

    await expect(store.readMonth('return', 2026, 8)).resolves.toHaveLength(3)
  })

  it('adds only the rows a later page brings that are genuinely new', async () => {
    const result = await store.saveRecords('return', 2026, 8, [
      record({ awb: 'AWB2', ean: 'E1', page: 1 }),
      record({ awb: 'AWB3', ean: 'E9', page: 1 })
    ])

    expect(result).toEqual({ added: 1, skipped: 1 })
  })

  it('keeps the two reports apart — the same AWB is a different row in each', async () => {
    await store.saveRecords('forward', 2026, 8, [record({ awb: 'AWB1', ean: 'E1' })])

    await expect(store.readMonth('forward', 2026, 8)).resolves.toHaveLength(1)
    await expect(store.readMonth('return', 2026, 8)).resolves.toHaveLength(4)
  })

  it('reports coverage per month and per day, without reading the rows back', async () => {
    await store.saveRecords('return', 2026, 9, [
      record({ awb: 'AWB7', ean: 'E1', year: 2026, month: 9, date: '2026-09-02' })
    ])

    const coverage = await store.readCoverage('return')

    expect(coverage.rows).toBe(5)
    // Newest month first, so the viewer opens on the month most likely wanted.
    expect(coverage.months.map(month => month.month)).toEqual([9, 8])
    expect(coverage.days.find(day => day.date === '2026-08-14')?.rows).toBe(4)
    expect(coverage.days.find(day => day.date === '2026-09-02')?.rows).toBe(1)
  })

  it('hands back the keys a month holds, for the skip on the next sync', async () => {
    const keys = await store.heldKeys('return', 2026, 8)

    expect(keys.has(store.recordKey('awb1', 'e1'))).toBe(true)
    expect(keys.has(store.recordKey('AWB404', 'E1'))).toBe(false)
  })

  it("deletes by the row's own date, reaching into the month it was filed under", async () => {
    // A row created on 31 August that arrived in September's page — the case a
    // delete-by-partition would leave behind while claiming the range was clear.
    await store.saveRecords('return', 2026, 9, [
      record({ awb: 'AWB8', ean: 'E1', year: 2026, month: 9, date: '2026-08-31' })
    ])

    await expect(store.deleteRange('return', '2026-08-31', '2026-08-31')).resolves.toBe(1)
    await expect(store.readMonth('return', 2026, 9)).resolves.toHaveLength(1)
  })

  it('drops a month from coverage once its last row is deleted', async () => {
    await store.deleteRange('return', '2026-09-01', '2026-09-30')

    const coverage = await store.readCoverage('return')

    expect(coverage.months.map(month => month.month)).toEqual([8])
  })

  it('erases one report without touching the other', async () => {
    // The forward report holds one row from an earlier test; the return report
    // holds the rest. Erasing one must leave the other exactly as it was.
    const before = await store.readCoverage('forward')

    expect(before.rows).toBeGreaterThan(0)

    const removed = await store.eraseReport('return')

    expect(removed).toBeGreaterThan(0)

    const after = await store.readCoverage('return')

    // Nothing held, and no months left claiming to hold it.
    expect(after.rows).toBe(0)
    expect(after.months).toHaveLength(0)
    expect(after.days).toHaveLength(0)
    await expect(store.readMonth('return', 2026, 8)).resolves.toHaveLength(0)

    // The forward report is untouched.
    await expect(store.readCoverage('forward')).resolves.toMatchObject({ rows: before.rows })
  })

  it('has nothing to erase the second time, and says so with a zero', async () => {
    await expect(store.eraseReport('return')).resolves.toBe(0)
  })

  it('finds a row by AWB wherever it is held — any month, either report', async () => {
    await store.saveRecords('return', 2026, 8, [
      record({ awb: 'R2503545875AJI', ean: 'E7', date: '2026-08-02' })
    ])
    await store.saveRecords('forward', 2026, 3, [
      record({ awb: 'FWD-ONLY-1', ean: 'E8', year: 2026, month: 3, date: '2026-03-02' })
    ])

    // Neither is in the month the viewer happens to be showing, which is the
    // whole point: somebody arrives with an AWB, not with a month.
    const found = await store.searchRecords('R2503545875AJI')

    expect(found.hits).toHaveLength(1)
    expect(found.hits[0]?.report).toBe('return')
    expect(found.hits[0]?.month).toBe(8)

    await expect(store.searchRecords('FWD-ONLY-1')).resolves.toMatchObject({
      hits: [{ report: 'forward' }]
    })
  })

  it('ignores casing and padding, as a pasted AWB always has some', async () => {
    await expect(store.searchRecords('  r2503545875aji ')).resolves.toMatchObject({
      hits: [{ awb: 'R2503545875AJI' }]
    })
  })

  it('matches on the EAN too, since that is the other half of the key', async () => {
    const found = await store.searchRecords('E7')

    expect(found.hits.length).toBeGreaterThan(0)
  })

  it('stops at the cap rather than reading the rest of the backup', async () => {
    const found = await store.searchRecords('E', 2)

    expect(found.hits).toHaveLength(2)
    expect(found.capped).toBe(true)
  })

  it('finds nothing for an AWB nobody holds, and says so without a cap', async () => {
    await expect(store.searchRecords('NOT-HELD-ANYWHERE')).resolves.toEqual({
      hits: [],
      capped: false
    })
  })

  it('answers a whole list of AWBs in one pass, and says which are missing', async () => {
    const { hits, found } = await store.lookupRecords([
      'R2503545875AJI',
      'FWD-ONLY-1',
      'NEVER-BACKED-UP'
    ])

    // Two held — one in each report, neither in the month a viewer would be
    // showing — and the third is the answer somebody actually needs.
    expect(found.has('R2503545875AJI')).toBe(true)
    expect(found.has('FWD-ONLY-1')).toBe(true)
    expect(found.has('NEVER-BACKED-UP')).toBe(false)
    expect(hits.map(hit => hit.report).sort()).toEqual(['forward', 'return'])
  })

  it('matches a pasted number exactly, not as a fragment', async () => {
    // "contains" would pull in every AWB ending in these digits; a pasted list
    // is a list of identifiers, and the point is to be told about those.
    const { found } = await store.lookupRecords(['2503545875'])

    expect(found.size).toBe(0)
  })

  it('ignores casing and padding on a pasted list too', async () => {
    const { found } = await store.lookupRecords(['  r2503545875aji  '])

    expect(found.has('R2503545875AJI')).toBe(true)
  })

  it('reads settings back as written, and defaults the rest', async () => {
    await store.writeBackupSettings({ username: 'ops@example.com', dailyTime: '02:30' })

    const settings = await store.readBackupSettings()

    expect(settings.username).toBe('ops@example.com')
    expect(settings.dailyTime).toBe('02:30')
    expect(settings.lastRunAt).toBeNull()
    expect(settings.lastSyncByReport).toEqual({})
  })

  /**
   * The two reports are separate runs and either can fail on its own, so the
   * Settings row shows them separately. That is only true if stamping one
   * leaves the other alone — which is the thing a one-level-deep settings merge
   * quietly gets wrong.
   */
  it('stamps each report on its own, without erasing the other', async () => {
    await store.recordReportSync({
      report: 'forward',
      username: 'ops@example.com',
      coveredTo: '2026-09-12',
      at: '2026-09-12T02:35:00.000Z'
    })

    await store.recordReportSync({
      report: 'return',
      username: 'ops@example.com',
      coveredTo: '2026-09-19',
      at: '2026-09-19T02:40:00.000Z'
    })

    const settings = await store.readBackupSettings()

    expect(settings.lastSyncByReport.forward).toEqual({
      at: '2026-09-12T02:35:00.000Z',
      coveredTo: '2026-09-12'
    })
    expect(settings.lastSyncByReport.return).toEqual({
      at: '2026-09-19T02:40:00.000Z',
      coveredTo: '2026-09-19'
    })
    // Whichever wrote last is still where "sync since last" starts.
    expect(settings.lastSyncedDate).toBe('2026-09-19')
  })
})
