import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BackupFinished, BackupProgress } from '@shared/types/masterBackup'

/**
 * A month AJIO would not finish serving must not report itself complete.
 *
 * AJIO answers `totalPages: 100` for EVERY month, and 100 pages at its 100-row
 * page cap is exactly the 10,000-row result window. So a month holding 25,000
 * rows reads to the end of page 100, fills its bar, and is short by 15,000 with
 * nothing on screen to say so — which is how a backup came to show every month
 * at 100% while the coverage calendar had the first twelve days of March and
 * the first ten of April missing.
 *
 * `totalPages` cannot tell those two apart. `totalElements` can, and these pin
 * that it is used — and that it is not guessed from when AJIO does not send it.
 */

const events: { channel: string; payload: unknown }[] = []

/** What AJIO claims the window holds. Null models the field being absent. */
const state = vi.hoisted(() => ({
  totalElements: null as number | null,
  /** Rows AJIO holds PER DAY, so a narrower window genuinely holds fewer. */
  rowsPerDay: null as number | null,
  /**
   * AJIO's result window, in rows, or null for "serves everything".
   *
   * Modelled per REQUESTED RANGE, which is the whole point: the same month asked
   * for in halves comes back complete, and that is what the split relies on.
   */
  cap: null as number | null,
  /** Every window the reader asked for, in order. */
  asked: [] as string[],
  /** AJIO's page ceiling, or null for "reports the true count". */
  ceilingPages: null as number | null,
  /**
   * Does the response carry `totalElements` at all?
   *
   * The real one does NOT — it has `pageNumber` and `totalPages` and nothing
   * else. Defaulting this to false keeps the harness honest; the tests that
   * want the field turn it on deliberately.
   */
  sendsTotalElements: false
}))

const PAGES = 3
const ROWS_PER_PAGE = 10

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/trackvid-test' },
  dialog: {},
  shell: {},
  BrowserWindow: { getAllWindows: () => [] }
}))
vi.mock('@main/services/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}))
vi.mock('@main/ipc/broadcast', () => ({
  broadcast: (channel: string, payload: unknown) => events.push({ channel, payload })
}))
vi.mock('@main/services/masterBackupArchive.store', () => ({
  initialiseBackupArchive: vi.fn(),
  saveBackupJob: vi.fn(() => Promise.resolve())
}))
vi.mock('@main/services/masterBackup.store', () => ({
  initialiseMasterBackup: vi.fn(),
  recordKey: (awb: unknown, ean: unknown) => `${String(awb)}|${String(ean)}`,
  saveRecords: (_r: unknown, _y: number, _m: number, rows: unknown[]) =>
    Promise.resolve({ added: rows.length, skipped: 0 }),
  heldKeys: () => Promise.resolve(new Set<string>()),
  readCoverage: () => Promise.resolve({ report: 'return', months: [], days: [], rows: 0, bytes: 0 }),
  readMonth: () => Promise.resolve([]),
  deleteRange: () => Promise.resolve(0),
  readBackupSettings: () =>
    Promise.resolve({
      username: 'ops@example.com',
      dailyTime: null,
      lastRunAt: null,
      lastSyncedDate: null
    }),
  writeBackupSettings: () => Promise.resolve({}),
  recordReportSync: () => Promise.resolve({})
}))
vi.mock('@main/services/masterDataReport.service', () => ({
  readReportPage: ({ page, from, to }: { page: number; from: string; to: string }) => {
    if (page === 0) state.asked.push(`${from}→${to}`)

    // What this window WOULD hold if AJIO served it all. When rowsPerDay is
    // set, it scales with the window — which is the property the split relies
    // on and the reason a fixed total would not model this at all.
    const days =
      Math.round(
        (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000
      ) + 1
    const holds =
      state.rowsPerDay !== null
        ? days * state.rowsPerDay
        : (state.totalElements ?? PAGES * ROWS_PER_PAGE)
    // What it will actually serve for a window this wide. A narrower window is
    // under the cap and comes back whole — the behaviour the split exploits.
    const serves = state.cap === null ? holds : Math.min(holds, state.cap)
    // AJIO pins totalPages at its ceiling for a window it will not finish, and
    // reports the true count for one it will. `ceilingPages` models that.
    const truePages = Math.max(1, Math.ceil(serves / ROWS_PER_PAGE))
    const pages =
      state.ceilingPages !== null ? Math.min(truePages, state.ceilingPages) : truePages
    const rows = page < pages ? Math.min(ROWS_PER_PAGE, serves - page * ROWS_PER_PAGE) : 0

    return Promise.resolve({
      success: true,
      data: {
        rows: Array.from({ length: Math.max(0, rows) }, (_, index) => ({
          awbNumber: `AWB-${from}-${page}-${index}`,
          ean: `E${index}`,
          // Both, so one mock serves either report: forward rows carry
          // `orderDate`, return rows `returnCreateDate`.
          orderDate: from,
          returnCreateDate: from
        })),
        totalPages: pages,
        totalElements: state.sendsTotalElements
          ? (state.rowsPerDay !== null ? holds : state.totalElements)
          : null,
        page
      }
    })
  }
}))

const { backupMonths } = await import('@main/services/masterBackup.service')
const { MASTER_BACKUP_EVENTS } = await import('@shared/constants/channels')

const ending = (): BackupFinished | undefined =>
  events.find(event => event.channel === MASTER_BACKUP_EVENTS.finished)?.payload as
    | BackupFinished
    | undefined

const allTicks = (): BackupProgress[] =>
  events
    .filter(event => event.channel === MASTER_BACKUP_EVENTS.progress)
    .map(event => event.payload as BackupProgress)

const lastTick = (): BackupProgress | undefined =>
  events
    .filter(event => event.channel === MASTER_BACKUP_EVENTS.progress)
    .map(event => event.payload as BackupProgress)
    .at(-1)

const run = async (report: 'forward' | 'return' = 'return'): Promise<void> => {
  await backupMonths({
    report,
    username: 'ops@example.com',
    fromYear: 2026,
    fromMonth: 7,
    toYear: 2026,
    toMonth: 7
  })

  for (let attempt = 0; attempt < 200 && !ending(); attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, 5))
  }
}

describe('a month AJIO would not finish serving', () => {
  beforeEach(() => {
    events.length = 0
    state.totalElements = null
    state.rowsPerDay = null
    state.cap = null
    state.ceilingPages = null
    state.sendsTotalElements = false
    state.asked = []
  })

  it('splits a capped month until AJIO serves all of it', async () => {
    // July holds 2 rows a day — 62 across the month — and AJIO serves at most
    // 20 per window. Asked as one month it comes back a third of the way, which
    // is the Forward Report's January where only the 23rd onwards arrived.
    state.sendsTotalElements = true
    state.rowsPerDay = 2
    state.cap = 20

    await run()

    const month = lastTick()?.months[0]

    // The month was asked for whole FIRST, then in narrower pieces.
    expect(state.asked[0]).toBe('2026-07-01→2026-07-31')
    // The halves themselves, not just "more than one window": this is the
    // behaviour, and a looser assertion passed even with splitting disabled.
    expect(state.asked).toContain('2026-07-01→2026-07-16')
    expect(state.asked).toContain('2026-07-17→2026-07-31')
    // And it is NOT reported incomplete, because the split got the rest.
    expect(month?.truncated).toBe(false)
    expect(month?.done).toBe(true)
  })

  it('reports a single day it still cannot finish, rather than looping', async () => {
    // The floor of the recursion: ONE DAY holds more than AJIO will serve, so
    // no amount of narrowing can finish it.
    state.sendsTotalElements = true
    state.rowsPerDay = 20
    state.cap = 10

    await run()

    const month = lastTick()?.months[0]

    // It kept splitting down to single days and then said so.
    expect(state.asked).toContain('2026-07-01→2026-07-01')
    expect(month?.truncated).toBe(true)
  })

  it('splits the FORWARD report the same way — one reader, both reports', async () => {
    /**
     * Not a duplicate of the return case.
     *
     * The Forward Report is the one that lost most: January 2026 held the 23rd
     * onwards and nothing before it, because forward rows outnumber return rows
     * and the 10,000-row window covered barely nine days. The split lives in
     * the single reader both reports go through — `backupMonthInWindows`, which
     * every entry point calls — and this pins that rather than leaving it to a
     * reading of the code.
     */
    state.sendsTotalElements = true
    state.rowsPerDay = 2
    state.cap = 20

    await run('forward')

    const month = lastTick()?.months[0]

    expect(state.asked).toContain('2026-07-01→2026-07-16')
    expect(state.asked).toContain('2026-07-17→2026-07-31')
    expect(month?.truncated).toBe(false)
    expect(month?.done).toBe(true)
  })

  /**
   * BOTH REPORTS, from the same loop.
   *
   * The ceiling check reads `totalPages` and knows nothing about which report
   * it is reading — the report is a parameter carried on the run state, and
   * every entry point (the month buttons, Coverage's Sync range, the nightly
   * re-sync, which does both) goes through the one reader. Running the case
   * twice pins that instead of arguing it from the code.
   */
  for (const report of ['return', 'forward'] as const) {
    it(`splits the ${report} report on the PAGE CEILING, all AJIO actually reports`, async () => {
      /**
       * The shape of a real AJIO response, and the reason the first version of
       * this fix never ran.
       *
       * AJIO's report returns `pageNumber` and `totalPages` — there is no
       * `totalElements`. A check comparing rows served against a row total
       * could therefore never fire, so the split was written and shipped and
       * did nothing: January still held only the 23rd onwards.
       *
       * What AJIO does give away is the page count: pinned at 100 for a window
       * it will not finish, truthful (40, for five days) for one it will.
       */
      // 100 is AJIO's observed ceiling and the constant the reader compares
      // against, so the harness has to use the same number to exercise it.
      const CEILING = 100

      state.totalElements = null
      state.sendsTotalElements = false
      // 40 a day is 1,240 for July — past the ceiling. Half a month is 640
      // rows, 64 pages, which AJIO reports truthfully and serves whole.
      state.rowsPerDay = 40
      state.ceilingPages = CEILING
      state.cap = CEILING * ROWS_PER_PAGE

      await run(report)

      const month = lastTick()?.months[0]

      // Narrowed past the whole month, on the page count alone.
      expect(state.asked[0]).toBe('2026-07-01→2026-07-31')
      expect(state.asked).toContain('2026-07-01→2026-07-16')
      expect(month?.done).toBe(true)
    })
  }

  /**
   * BOTH REPORTS. The day counting lives in the one reader and never mentions
   * which report it is reading — but "the code looks shared" is not the same
   * as "the behaviour is pinned for each", so it is run twice.
   */
  for (const report of ['return', 'forward'] as const) {
    it(`reports ${report} progress that only ever moves forward, however often it splits`, async () => {
      /**
       * The bar an operator watches.
       *
       * Progress used to be the PAGE number, and AJIO restarts that with every
       * window — so a month read in eight windows sent the bar back to the
       * start eight times, and a run making progress was indistinguishable
       * from one going in circles.
       *
       * Days are the unit that cannot do that: splitting a window does not
       * change how many days it covers, so the count only climbs.
       */
      const CEILING = 100

      state.sendsTotalElements = false
      state.rowsPerDay = 40
      state.ceilingPages = CEILING
      state.cap = CEILING * ROWS_PER_PAGE

      await run(report)

      const days = allTicks()
        .map(tick => tick.months[0]?.daysDone)
        .filter((value): value is number => typeof value === 'number')

      expect(days.length).toBeGreaterThan(2)
      // Never backwards, at any point in the run.
      for (const [index, value] of days.entries()) {
        if (index > 0) expect(value).toBeGreaterThanOrEqual(days[index - 1] as number)
      }

      const month = lastTick()?.months[0]

      // July, whole, and never more than it has.
      expect(month?.daysTotal).toBe(31)
      expect(month?.daysDone).toBe(31)
    })
  }

  it('does not guess when AJIO sends no count at all', async () => {
    // Absent, not zero. Claiming truncation from the page number alone would
    // libel every month that genuinely holds a full window.
    state.totalElements = null

    await run()

    const month = lastTick()?.months[0]

    expect(month?.totalElements).toBeNull()
    expect(month?.truncated).toBe(false)
  })
})
