import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { SnapdealRecord, SnapdealRequest } from '@shared/types/snapdealBackup'
import { snapdealKey } from '@shared/utils/snapdealRows'

/**
 * The Snapdeal backup store, against a real directory.
 *
 * Four promises are worth pinning here, and every one of them is a place where
 * being wrong is invisible from the UI:
 *
 *   1. a re-download MERGES rather than skipping, so the forward AWB that
 *      arrives in the second copy of a return is not thrown away;
 *   2. a day is painted by the furthest request covering it, so a failed retry
 *      cannot hide data that is already held;
 *   3. forgetting a request leaves the ROWS alone — "ask again" must not be
 *      destructive;
 *   4. the per-month files this store used to write are folded into the one
 *      table rather than abandoned — Snapdeal's window has moved on, so a
 *      month dropped here is a month that cannot be fetched again.
 */

const state = vi.hoisted(() => ({ directory: '' }))

vi.mock('@main/database', () => ({ dataDirectory: () => state.directory }))
vi.mock('@main/services/logger', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))

const store = await import('@main/services/snapdealBackup.store')
const { JsonCollection } = await import('@main/database/jsonStore')

const record = (
  overrides: Partial<SnapdealRecord> & { subOrderCode: string; reverseAwb: string }
): SnapdealRecord => ({
  key: snapdealKey(overrides.subOrderCode, overrides.reverseAwb),
  awb: '',
  sku: '8907979168347',
  date: '2026-09-04',
  year: 2026,
  month: 9,
  savedAt: '2026-09-04T00:00:00.000Z',
  requestId: 'req-1',
  ...overrides
})

const request = (overrides: Partial<SnapdealRequest> & { id: string }): SnapdealRequest => ({
  requestId: '14243406',
  username: 'online1@wrogn.com',
  report: 'return',
  from: '2026-09-05',
  to: '2026-10-03',
  status: 'requested',
  requestedAt: '2026-10-03T00:00:00.000Z',
  readyAt: null,
  storedAt: null,
  code: null,
  subArea: 'ReturnsAck',
  filename: null,
  rows: 0,
  added: 0,
  attempts: 1,
  error: null,
  ...overrides
})

beforeAll(async () => {
  state.directory = await mkdtemp(join(tmpdir(), 'trackvid-snapdeal-'))
  store.initialiseSnapdealBackup()
})

afterAll(async () => {
  await rm(state.directory, { recursive: true, force: true })
})

describe('saving rows', () => {
  it('adds what is new', async () => {
    const saved = await store.saveSnapdealRecords('return', [
      record({ subOrderCode: '74216331124', reverseAwb: '4608544326972' }),
      record({ subOrderCode: '74226942559', reverseAwb: 'SDLR5006999324' })
    ])

    expect(saved).toEqual({ added: 2, updated: 0, skipped: 0 })
  })

  it('fills the forward AWB in rather than skipping the second copy', async () => {
    /*
     * THE BUG THIS EXISTS TO STOP. Snapdeal serves the return twice — the
     * first row carries AWBNO "NA" because the forward leg had not settled.
     * A store that skipped on identity would keep the blank one for ever, and
     * the claims this backup feeds are blocked on exactly that field.
     */
    const saved = await store.saveSnapdealRecords('return', [
      record({
        subOrderCode: '74216331124',
        reverseAwb: '4608544326972',
        awb: '7269624179856'
      })
    ])

    expect(saved).toEqual({ added: 0, updated: 1, skipped: 0 })

    const rows = await store.readSnapdealMonth('return', 2026, 9)

    expect(rows.find(row => row.subOrderCode === '74216331124')?.awb).toBe('7269624179856')
    // Still two returns, not three: the merge happened in place.
    expect(rows).toHaveLength(2)
  })

  it('does nothing at all for a row it already holds complete', async () => {
    const saved = await store.saveSnapdealRecords('return', [
      record({
        subOrderCode: '74216331124',
        reverseAwb: '4608544326972',
        awb: '7269624179856'
      })
    ])

    expect(saved).toEqual({ added: 0, updated: 0, skipped: 1 })
  })
})

describe('coverage', () => {
  it('counts the days without reading every row back', async () => {
    const coverage = await store.readSnapdealCoverage('return')

    expect(coverage.rows).toBe(2)
    expect(coverage.months).toHaveLength(1)
    expect(coverage.days).toEqual([{ date: '2026-09-04', rows: 2 }])
  })

  it('reports the size of the one table, not a figure per month', async () => {
    // The rows share a file now, so a per-month size would be the same number
    // repeated. The months carry 0 and the total is the file — which is the
    // number that answers what this costs on the machine.
    const coverage = await store.readSnapdealCoverage('return')

    expect(coverage.bytes).toBeGreaterThan(0)
    expect(coverage.months.every(month => month.bytes === 0)).toBe(true)
  })

  it('keeps every month in one table rather than a file each', async () => {
    // Two months of rows, still one file: this is the whole change, and the
    // thing that regresses silently if a future save goes back to partitioning.
    await store.saveSnapdealRecords('return', [
      record({ subOrderCode: '80000001', reverseAwb: 'SDLR80', date: '2026-10-02', month: 10 })
    ])

    const coverage = await store.readSnapdealCoverage('return')

    expect(coverage.months.map(month => month.month).sort((a, b) => a - b)).toEqual([9, 10])
    expect(await readdir(state.directory)).not.toContain('snapdeal-backup-return-2026-10.json')

    await store.deleteSnapdealRange('return', '2026-10-01', '2026-10-31')
  })
})

describe('the request table', () => {
  it('paints a day by the furthest request covering it', async () => {
    // A stored request and a failed retry over the same days: the day is
    // stored. Red here would send somebody re-requesting what they hold.
    await store.saveSnapdealRequest(
      request({ id: 'a', from: '2026-09-01', to: '2026-09-10', status: 'stored' })
    )
    await store.saveSnapdealRequest(
      request({ id: 'b', from: '2026-09-01', to: '2026-09-10', status: 'failed' })
    )
    await store.saveSnapdealRequest(
      request({ id: 'c', from: '2026-09-11', to: '2026-09-12', status: 'requested' })
    )

    const coverage = await store.readSnapdealRequestCoverage('return')
    const day = (date: string): string | undefined =>
      coverage.days.find(entry => entry.date === date)?.status

    expect(day('2026-09-05')).toBe('stored')
    expect(day('2026-09-11')).toBe('requested')
    expect(day('2026-09-20')).toBeUndefined()
    // Only the two that have been asked for and not yet stored.
    expect(coverage.outstanding).toBe(1)
  })

  it('finds the requests that OVERLAP a range, not only those inside it', async () => {
    // A 28-day window rarely lines up with the range somebody picks, so the
    // manual download has to see the request that straddles it.
    const found = await store.snapdealRequestsOverlapping({
      report: 'return',
      from: '2026-09-09',
      to: '2026-09-09'
    })

    expect(found.map(entry => entry.id).sort()).toEqual(['a', 'b'])
  })

  it('forgets a request without touching the rows it brought', async () => {
    const removed = await store.forgetSnapdealRequests({
      report: 'return',
      from: '2026-09-11',
      to: '2026-09-12'
    })

    expect(removed).toBe(1)
    expect((await store.readSnapdealRequests('return')).map(entry => entry.id).sort()).toEqual([
      'a',
      'b'
    ])
    // The whole point: asking again must not be destructive.
    expect((await store.readSnapdealCoverage('return')).rows).toBe(2)
  })
})

describe('deleting a range', () => {
  it('goes by the row’s own date, not by the month it reports under', async () => {
    // Filed under September, dated October — a delete that went by partition
    // would leave it behind while claiming the range was cleared.
    await store.saveSnapdealRecords('return', [
      record({ subOrderCode: '99999', reverseAwb: 'SDLR1', date: '2026-10-02' })
    ])

    const removed = await store.deleteSnapdealRange('return', '2026-10-01', '2026-10-31')

    expect(removed).toBe(1)
    expect((await store.readSnapdealCoverage('return')).rows).toBe(2)
  })
})

describe('the rows a previous version filed per month', () => {
  it('folds them into the one table and removes the files', async () => {
    /*
     * THE MIGRATION, and it is not optional. A machine that has been
     * collecting already holds `snapdeal-backup-return-2026-04` and its
     * siblings; Snapdeal's report window has moved on, so those rows cannot
     * simply be asked for again. Shipping the one-table shape without this
     * would empty the backup of every month it had.
     */
    const legacy = new JsonCollection<SnapdealRecord>({
      name: 'snapdeal-backup-return-2026-04',
      directory: state.directory
    })

    await legacy.mutate(() => ({
      records: [
        record({
          subOrderCode: '71216632046',
          reverseAwb: 'SDLR5005670795',
          awb: 'SDLC1071591128',
          date: '2026-04-23',
          year: 2026,
          month: 4
        })
      ],
      result: undefined
    }))

    const folded = await store.foldInMonthFiles()

    expect(folded).toBe(1)
    expect(await readdir(state.directory)).not.toContain('snapdeal-backup-return-2026-04.json')

    const rows = await store.readSnapdealMonth('return', 2026, 4)

    expect(rows).toHaveLength(1)
    expect(rows[0]?.awb).toBe('SDLC1071591128')
    // And the calendar knows about April now.
    expect((await store.readSnapdealCoverage('return')).months.map(month => month.month)).toContain(4)
  })

  it('repoints the reference from Snapdeal\u2019s number to the request row\u2019s id', async () => {
    /*
     * The per-month version stored Snapdeal's portal number in `requestId`;
     * rows written now store the id of the request row that brought them.
     * Folding without translating would leave one column meaning two different
     * things by age — a join that works for this month and quietly returns
     * nothing for last month.
     */
    await store.saveSnapdealRequest(
      request({ id: 'row-uuid', requestId: '14244592', from: '2026-03-01', to: '2026-03-28' })
    )

    await new JsonCollection<SnapdealRecord>({
      name: 'snapdeal-backup-return-2026-03',
      directory: state.directory
    }).mutate(() => ({
      records: [
        record({
          subOrderCode: '60000001',
          reverseAwb: 'SDLR60',
          date: '2026-03-14',
          month: 3,
          // What the old shape wrote: Snapdeal's own number.
          requestId: '14244592'
        })
      ],
      result: undefined
    }))

    await store.foldInMonthFiles()

    const [row] = await store.readSnapdealMonth('return', 2026, 3)

    expect(row?.requestId).toBe('row-uuid')
  })

  it('leaves a reference it cannot translate alone rather than blanking it', async () => {
    // A number no request row claims is still better evidence than nothing.
    await new JsonCollection<SnapdealRecord>({
      name: 'snapdeal-backup-return-2026-02',
      directory: state.directory
    }).mutate(() => ({
      records: [
        record({
          subOrderCode: '60000002',
          reverseAwb: 'SDLR61',
          date: '2026-02-10',
          month: 2,
          requestId: '99999999'
        })
      ],
      result: undefined
    }))

    await store.foldInMonthFiles()

    const [row] = await store.readSnapdealMonth('return', 2026, 2)

    expect(row?.requestId).toBe('99999999')
  })

  it('does nothing on a machine that never had them', async () => {
    // Idempotent: it runs at every launch, so a second pass must be free.
    expect(await store.foldInMonthFiles()).toBe(0)
  })
})
