import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BackupFinished, BackupProgress } from '@shared/types/masterBackup'

/**
 * What a running backup says about itself.
 *
 * This is the part an operator watches, and it has already been wrong once: the
 * page total was assumed to be 1 before AJIO had said otherwise, so the bar
 * filled completely on the first tick and then jumped back to the start. So the
 * sequence is pinned here — never a total that has not been reported, never a
 * page beyond the total, and always an end.
 */

const events: { channel: string; payload: unknown }[] = []

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
    Promise.resolve({ username: 'ops@example.com', dailyTime: null, lastRunAt: null, lastSyncedDate: null }),
  writeBackupSettings: () => Promise.resolve({}),
  recordReportSync: () => Promise.resolve({})
}))

/** Three pages of ten rows, and AJIO says so from the first response on. */
const TOTAL_PAGES = 3

vi.mock('@main/services/masterDataReport.service', () => ({
  // The backup reads pages WITHOUT the automation lock — it holds the lock
  // itself for the whole run — so this is the name it calls.
  readReportPage: ({ page }: { page: number }) =>
    Promise.resolve({
      success: true,
      data: {
        rows: Array.from({ length: 10 }, (_, index) => ({
          awbNumber: `AWB${page}${index}`,
          ean: `E${index}`,
          returnCreateDate: '2026-07-14'
        })),
        totalPages: TOTAL_PAGES,
        page
      }
    })
}))

const { backupMonths } = await import('@main/services/masterBackup.service')
const { MASTER_BACKUP_EVENTS } = await import('@shared/constants/channels')

const ticks = (): BackupProgress[] =>
  events
    .filter(event => event.channel === MASTER_BACKUP_EVENTS.progress)
    .map(event => event.payload as BackupProgress)

const ending = (): BackupFinished | undefined =>
  events.find(event => event.channel === MASTER_BACKUP_EVENTS.finished)?.payload as
    | BackupFinished
    | undefined

/** Resolves when the run publishes its end, so the test is not a sleep. */
const runFinished = async (): Promise<void> => {
  for (let attempt = 0; attempt < 200 && !ending(); attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, 5))
  }
}

beforeEach(() => {
  events.length = 0
})

describe('a running backup', () => {
  it('starts at nothing, then counts pages once AJIO has said how many', async () => {
    const started = await backupMonths({
      report: 'return',
      username: 'ops@example.com',
      fromYear: 2026,
      fromMonth: 7,
      toYear: 2026,
      toMonth: 7
    })

    expect(started.success).toBe(true)

    if (!started.success) return

    expect(started.data.months).toBe(1)
    expect(started.data.label).toBe('July 2026')

    await runFinished()

    const [first] = ticks()

    // The opening tick knows nothing yet, and says so rather than drawing 1 of 1.
    expect(first?.totalPages).toBe(0)
    expect(first?.page).toBe(0)

    // And no tick ever claims a page beyond the total it reported.
    for (const tick of ticks()) {
      if (tick.totalPages > 0) expect(tick.page).toBeLessThanOrEqual(tick.totalPages)
    }
  })

  it('reads several months at once, and counts the ones that are finished', async () => {
    await backupMonths({
      report: 'return',
      username: 'ops@example.com',
      fromYear: 2026,
      fromMonth: 7,
      toYear: 2026,
      toMonth: 8
    })

    await runFinished()

    const months = new Set(ticks().map(tick => tick.totalMonths))

    expect(months).toEqual(new Set([2]))

    // `month` is now months FINISHED, so it never goes backwards and ends at
    // the total — a run of two months that reported "month 1" forever would be
    // a bar that never moved.
    const done = ticks().map(tick => tick.month)

    expect(done).toEqual([...done].sort((a, b) => a - b))
    expect(ticks().at(-1)?.month).toBe(2)

    // Both months are named while they run, and the label says when more than
    // one is in flight rather than naming one and hiding the other.
    const labels = ticks().map(tick => tick.label)

    expect(labels.some(label => label.includes('July 2026'))).toBe(true)
    expect(labels.some(label => label.includes('August 2026') || label.includes('more'))).toBe(true)

    // Pages are the months added together: two months of three pages is six,
    // not three.
    expect(Math.max(...ticks().map(tick => tick.totalPages))).toBe(TOTAL_PAGES * 2)

    // Totals are for the RUN, whichever month added to them.
    expect(ticks().at(-1)?.added).toBe(TOTAL_PAGES * 10 * 2)
  })

  it('always ends — one final tick that is not running, and one summary', async () => {
    await backupMonths({
      report: 'return',
      username: 'ops@example.com',
      fromYear: 2026,
      fromMonth: 7,
      toYear: 2026,
      toMonth: 7
    })

    await runFinished()

    const last = ticks().at(-1)

    expect(last?.running).toBe(false)
    expect(ending()?.added).toBe(TOTAL_PAGES * 10)
    expect(ending()?.kind).toBe('months')
    expect(ending()?.error).toBeNull()
  })

  it('refuses a second run while one is going, rather than interleaving them', async () => {
    const first = await backupMonths({
      report: 'return',
      username: 'ops@example.com',
      fromYear: 2026,
      fromMonth: 7,
      toYear: 2026,
      toMonth: 7
    })
    const second = await backupMonths({
      report: 'return',
      username: 'ops@example.com',
      fromYear: 2026,
      fromMonth: 8,
      toYear: 2026,
      toMonth: 8
    })

    expect(first.success).toBe(true)
    expect(second.success).toBe(false)

    if (second.success) return

    expect(second.error.message).toContain('already running')

    await runFinished()
  })

  it('reports every month separately, not one bar over all of them', async () => {
    await backupMonths({
      report: 'return',
      username: 'ops@example.com',
      fromYear: 2026,
      fromMonth: 7,
      toYear: 2026,
      toMonth: 9
    })

    await runFinished()

    const last = ticks().at(-1)

    // Three selected, three rows — including the ones that have finished. A row
    // that disappeared when its month ended would make the card shrink as the
    // run went on, and hide which months a failure belonged to.
    expect(last?.months.map(month => month.label)).toEqual([
      'July 2026',
      'August 2026',
      'September 2026'
    ])
    expect(last?.months.every(month => month.done)).toBe(true)

    // Each carries its OWN counts, not a share of the run's.
    for (const month of last?.months ?? []) {
      expect(month.added).toBe(TOTAL_PAGES * 10)
      expect(month.totalPages).toBe(TOTAL_PAGES)
    }

    // And they add up to the run.
    const summed = (last?.months ?? []).reduce((total, month) => total + month.added, 0)

    expect(summed).toBe(last?.added)
  })
})
