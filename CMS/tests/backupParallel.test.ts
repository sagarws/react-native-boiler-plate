import { describe, expect, it, onTestFinished, vi } from 'vitest'

/**
 * Every selected month is read at the SAME TIME.
 *
 * Months are independent — each reads its own date window and writes its own
 * file — so running them one after another spent n times the wall clock for no
 * reason: the network sat idle between pages of one month while the next had
 * not started.
 *
 * What is pinned here is the thing an eye cannot check: that n months really do
 * produce n requests in flight, and that they advance together rather than one
 * month racing to its last page while the others wait. A regression to
 * sequential would still pass every other test in the suite — the rows all
 * arrive, just slowly — which is exactly why it needs measuring.
 */

const seen = vi.hoisted(() => ({
  /** Requests in flight right now, and the most there have ever been. */
  live: 0,
  peak: 0,
  /** Every (month, page) asked for, in the order it was asked. */
  order: [] as string[]
}))

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/trackvid-test' },
  dialog: {},
  shell: {},
  BrowserWindow: { getAllWindows: () => [] }
}))
vi.mock('@main/services/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}))
vi.mock('@main/ipc/broadcast', () => ({ broadcast: vi.fn() }))
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

const PAGES = 3

vi.mock('@main/services/masterDataReport.service', () => ({
  // Every page takes a moment, as a real one does: without that the first
  // month would finish before the second was asked for, and a sequential
  // implementation would look identical to a parallel one.
  readReportPage: async ({ from, page }: { from: string; page: number }) => {
    seen.live += 1
    seen.peak = Math.max(seen.peak, seen.live)
    seen.order.push(`${from.slice(0, 7)}#${page}`)

    await new Promise(resolve => setTimeout(resolve, 20))

    seen.live -= 1

    return {
      success: true,
      data: {
        rows: [{ awbNumber: `AWB${from}${page}`, ean: 'E1', returnCreateDate: from }],
        totalPages: PAGES,
        page
      }
    }
  }
}))

const { backupMonths } = await import('@main/services/masterBackup.service')

describe('a backup over several months', () => {
  it('asks all of them at once — n months, n requests in flight', async () => {
    // May–Sep must sit inside the five months the backup keeps, whatever
    // today is. Only Date is faked: the wait below needs real timers.
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 8, 20))
    onTestFinished(() => {
      vi.useRealTimers()
    })

    const started = await backupMonths({
      report: 'return',
      username: 'ops@example.com',
      fromYear: 2026,
      fromMonth: 5,
      toYear: 2026,
      toMonth: 9
    })

    expect(started.success).toBe(true)

    if (!started.success) return

    expect(started.data.months).toBe(5)

    // Wait for the run, which was deliberately not awaited by the caller.
    for (let attempt = 0; attempt < 400 && seen.order.length < 5 * PAGES + 1; attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 5))
    }

    // Five months selected, five requests open at the same moment.
    expect(seen.peak).toBe(5)

    /**
     * The first request is the PRIMER, on its own.
     *
     * The months share one signed-in browser page, and the lease that holds it
     * cannot be raced: five callers arriving together with nothing open would
     * each start a browser. So one read opens the session, and everything after
     * it goes at once.
     */
    const [primer, ...rest] = seen.order

    expect(primer).toBe('2026-05#0')

    // Then they advance together: every month's page 1 before any month's page
    // 2 — which is what "at the same time" means for a run made of chains
    // rather than single calls.
    const firstPages = rest.slice(0, 5)

    expect(new Set(firstPages).size).toBe(5)
    expect(firstPages.every(entry => entry.endsWith('#0'))).toBe(true)

    // Every page of every month was still read, plus the primer.
    expect(rest).toHaveLength(5 * PAGES)
  })
})
