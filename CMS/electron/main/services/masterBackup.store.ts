import { stat } from 'node:fs/promises'
import type {
  BackupCoverage,
  BackupRecord,
  BackupReport,
  BackupSettings,
  DayCoverage,
  MonthCoverage
} from '@shared/types/masterBackup'
import { claimFacts, type BackupFacts } from '@shared/utils/backupRows'
import { recordKey } from '@shared/utils/backupRows'
import { dataDirectory } from '../database'
import { JsonCollection } from '../database/jsonStore'
import { logger } from './logger'

/**
 * Where the AJIO backup lives on this machine.
 *
 * ONE FILE PER REPORT PER MONTH. A single file would be the obvious thing and
 * the wrong one: a year of both reports is hundreds of thousands of rows, and
 * every append would rewrite the lot. Partitioning by month means a write
 * touches one month, a read of September costs September, and deleting a range
 * is deleting files rather than filtering a monolith.
 *
 * IDENTITY IS AWB + EAN, and it is computed once, at write. One AWB can carry
 * several articles, so neither alone identifies a row. Holding the key on the
 * record (rather than deriving it at compare time) is what lets a re-sync skip
 * duplicates with a Set lookup instead of a scan per row.
 *
 * COVERAGE IS DERIVED AND CACHED. The calendar needs "which days do we hold",
 * which is a question about every month at once — reading them all to answer it
 * would make opening a dialog cost the whole backup. So each write updates a
 * small index: one entry per month, with its day counts.
 */

const SETTINGS_COLLECTION = 'ajio-backup-settings'
const INDEX_COLLECTION = 'ajio-backup-index'

const pad = (value: number): string => String(value).padStart(2, '0')

/** `ajio-backup-return-2026-09` — the file one month of one report lives in. */
const partitionName = (report: BackupReport, year: number, month: number): string =>
  `ajio-backup-${report}-${year}-${pad(month)}`

/**
 * Stored per month, so the calendar can be drawn without reading the rows.
 *
 * Without `bytes`: the size is a fact about the file as it is NOW, and a
 * remembered one would drift every time a row was added or deleted. It is
 * measured at read instead.
 */
interface MonthIndex extends Omit<MonthCoverage, 'bytes'> {
  report: BackupReport
  /** Rows per day, `yyyy-MM-dd` → count. */
  days: Record<string, number>
}

let settings: JsonCollection<BackupSettings & { id: string }> | null = null
let index: JsonCollection<MonthIndex> | null = null

/** Month partitions are opened lazily and kept — a run touches a few of them. */
const partitions = new Map<string, JsonCollection<BackupRecord>>()

export const initialiseMasterBackup = (): void => {
  settings = new JsonCollection({ name: SETTINGS_COLLECTION, directory: dataDirectory() })
  index = new JsonCollection({ name: INDEX_COLLECTION, directory: dataDirectory() })
}

const partition = (report: BackupReport, year: number, month: number): JsonCollection<BackupRecord> => {
  const name = partitionName(report, year, month)
  const open = partitions.get(name)

  if (open) return open

  const collection = new JsonCollection<BackupRecord>({ name, directory: dataDirectory() })

  partitions.set(name, collection)

  return collection
}

export { recordKey }

const readIndex = async (): Promise<MonthIndex[]> => {
  if (!index) return []

  return index.read().catch(() => [] as MonthIndex[])
}

const indexId = (report: BackupReport, year: number, month: number): string =>
  `${report}-${year}-${pad(month)}`

/** Recomputes one month's index entry from the rows it holds. Never throws. */
const reindex = async (report: BackupReport, year: number, month: number): Promise<void> => {
  if (!index) return

  const rows = await partition(report, year, month)
    .read()
    .catch(() => [] as BackupRecord[])

  const days: Record<string, number> = {}
  const pages = new Set<number>()

  for (const record of rows) {
    if (record.date) days[record.date] = (days[record.date] ?? 0) + 1
    pages.add(record.page)
  }

  const entry: MonthIndex = {
    report,
    year,
    month,
    rows: rows.length,
    pages: pages.size,
    lastSyncedAt: new Date().toISOString(),
    days
  }

  await index
    .mutate(records => {
      const id = indexId(report, year, month)
      const rest = records.filter(record => indexId(record.report, record.year, record.month) !== id)

      // A month with no rows left is dropped rather than kept at zero: the
      // calendar asks "what do we hold", and an empty entry is not an answer.
      return { records: rows.length > 0 ? [...rest, entry] : rest, result: undefined }
    })
    .catch(error => logger.warn(`[ajio-backup] could not index ${report} ${year}-${month}`, error))
}

/**
 * Adds rows to one month, skipping any AWB + EAN it already holds.
 *
 * Returns what it did, because "nothing was added" is the normal outcome of a
 * re-sync and has to be distinguishable from "nothing came back".
 */
export const saveRecords = async (
  report: BackupReport,
  year: number,
  month: number,
  records: BackupRecord[]
): Promise<{ added: number; skipped: number }> => {
  if (records.length === 0) return { added: 0, skipped: 0 }

  const collection = partition(report, year, month)

  const result = await collection
    .mutate(existing => {
      const held = new Set(existing.map(record => record.key))
      const fresh: BackupRecord[] = []
      let skipped = 0

      for (const record of records) {
        if (held.has(record.key)) {
          skipped += 1
          continue
        }

        held.add(record.key)
        fresh.push(record)
      }

      return {
        records: [...existing, ...fresh],
        result: { added: fresh.length, skipped }
      }
    })
    .catch(error => {
      logger.warn(`[ajio-backup] could not save ${report} ${year}-${month}`, error)

      return { added: 0, skipped: 0 }
    })

  if (result.added > 0) {
    version += 1
    await reindex(report, year, month)
  }

  return result
}

/**
 * Moves rows filed under an EARLIER month than their own date into their own
 * month's file.
 *
 * A repair for one bug: the daily sync once sent 30 Sep → 10 Oct as a single
 * window, and every October row landed in September's file — so October read
 * as never synced. Only later-dated rows move; a row AJIO back-dated into an
 * earlier month's page is left where the month backup put it.
 *
 * Saved into the new month BEFORE it is removed from the old one, so a failure
 * part-way leaves a row twice, never nowhere.
 *
 * @returns how many rows moved
 */
export const refileLaterRows = async (report: BackupReport): Promise<number> => {
  let moved = 0

  for (const entry of (await readIndex()).filter(item => item.report === report)) {
    const filedAs = `${entry.year}-${pad(entry.month)}`
    const strays = (await readMonth(report, entry.year, entry.month)).filter(
      record => /^\d{4}-\d{2}-\d{2}$/.test(record.date) && record.date.slice(0, 7) > filedAs
    )

    if (strays.length === 0) continue

    const byMonth = new Map<string, BackupRecord[]>()

    for (const record of strays) {
      const key = record.date.slice(0, 7)
      byMonth.set(key, [...(byMonth.get(key) ?? []), record])
    }

    for (const [key, records] of byMonth) {
      await saveRecords(report, Number(key.slice(0, 4)), Number(key.slice(5, 7)), records)
    }

    const keys = new Set(strays.map(record => record.key))
    const removed = await partition(report, entry.year, entry.month)
      .mutate(records => {
        const keep = records.filter(record => !keys.has(record.key))

        return { records: keep, result: records.length - keep.length }
      })
      .catch(error => {
        logger.warn(`[ajio-backup] could not refile rows out of ${filedAs}`, error)

        return 0
      })

    if (removed > 0) {
      moved += removed
      version += 1
      await reindex(report, entry.year, entry.month)
      logger.info(`[ajio-backup] ${report}: moved ${removed} row(s) out of ${filedAs} into their own month`)
    }
  }

  return moved
}

/** What one month's file takes on disk. 0 when it cannot be read. */
const partitionBytes = async (
  report: BackupReport,
  year: number,
  month: number
): Promise<number> => {
  const file = partition(report, year, month).filePath

  return stat(file)
    .then(info => info.size)
    .catch(() => 0)
}

/** Every month held for one report, newest first, with its day counts. */
export const readCoverage = async (report: BackupReport): Promise<BackupCoverage> => {
  const months = (await readIndex()).filter(entry => entry.report === report)

  const days: DayCoverage[] = months
    .flatMap(entry => Object.entries(entry.days).map(([date, rows]) => ({ date, rows })))
    .sort((a, b) => a.date.localeCompare(b.date))

  // One stat per month rather than reading the rows: the size is a property of
  // the file, and parsing a year of JSON to weigh it would cost more than the
  // answer is worth.
  const sizes = await Promise.all(
    months.map(entry => partitionBytes(report, entry.year, entry.month))
  )

  const summary: MonthCoverage[] = months
    .map(({ year, month, rows, pages, lastSyncedAt }, index) => ({
      year,
      month,
      rows,
      pages,
      lastSyncedAt,
      bytes: sizes[index] ?? 0
    }))
    .sort((a, b) => b.year - a.year || b.month - a.month)

  return {
    report,
    months: summary,
    days,
    rows: summary.reduce((total, entry) => total + entry.rows, 0),
    bytes: summary.reduce((total, entry) => total + entry.bytes, 0)
  }
}

/** One month's rows, for the viewer. */
export const readMonth = async (
  report: BackupReport,
  year: number,
  month: number
): Promise<BackupRecord[]> =>
  partition(report, year, month)
    .read()
    .catch(() => [] as BackupRecord[])

/** The keys one month already holds — read once per month by a sync. */
export const heldKeys = async (
  report: BackupReport,
  year: number,
  month: number
): Promise<Set<string>> => new Set((await readMonth(report, year, month)).map(record => record.key))

/**
 * Deletes rows whose own date falls inside the range, month by month.
 *
 * By the ROW's date rather than by the month it was filed under: a return
 * created on the 31st can arrive in the next month's page, and a delete that
 * went by partition would leave it behind while claiming the range was cleared.
 */
export const deleteRange = async (
  report: BackupReport,
  from: string,
  to: string
): Promise<number> => {
  const touched = (await readIndex()).filter(entry => entry.report === report)
  let removed = 0

  for (const entry of touched) {
    const collection = partition(report, entry.year, entry.month)

    const deleted = await collection
      .mutate(records => {
        const keep = records.filter(record => !(record.date >= from && record.date <= to))

        return { records: keep, result: records.length - keep.length }
      })
      .catch(error => {
        logger.warn(`[ajio-backup] could not delete from ${entry.year}-${entry.month}`, error)

        return 0
      })

    if (deleted > 0) {
      removed += deleted
      version += 1
      await reindex(report, entry.year, entry.month)
    }
  }

  return removed
}

/**
 * AWB → what that row can tell a claim.
 *
 * BUILT ONCE AND KEPT, because the caller is Refill Data working through a
 * ticked list: rebuilding per claim would read every month off disk again for
 * each row. Held as the three strings a claim wants rather than as the rows
 * themselves — a year of AJIO is tens of thousands of forty-field rows, and
 * keeping those resident to read three fields is not a trade worth making.
 *
 * Invalidated by `version`, which every write bumps, so a lookup taken after a
 * backup or a delete sees what the machine now holds.
 */
export interface BackupMatch extends BackupFacts {
  awb: string
  year: number
  month: number
}

let version = 0
let lookupCache: { version: number; report: BackupReport; byAwb: Map<string, BackupMatch> } | null =
  null

export const awbLookup = async (report: BackupReport): Promise<Map<string, BackupMatch>> => {
  if (lookupCache && lookupCache.version === version && lookupCache.report === report) {
    return lookupCache.byAwb
  }

  const months = (await readIndex())
    .filter(entry => entry.report === report)
    // Newest first, so where the same AWB appears twice the recent row wins.
    .sort((a, b) => b.year - a.year || b.month - a.month)

  const byAwb = new Map<string, BackupMatch>()

  for (const entry of months) {
    for (const record of await readMonth(report, entry.year, entry.month)) {
      const key = record.awb.trim().toUpperCase()

      if (!key || byAwb.has(key)) continue

      byAwb.set(key, {
        awb: record.awb,
        year: record.year,
        month: record.month,
        ...claimFacts(record.row)
      })
    }
  }

  lookupCache = { version, report, byAwb }

  return byAwb
}

/**
 * Everything held for one report, gone.
 *
 * BY REPORT, not by date, because this is the one operation whose point is that
 * nothing is left: a range delete asks which rows, and the answer here is all
 * of them. The two reports stay separate as they are everywhere else — erasing
 * the return report must not take the forward one with it.
 *
 * The files are emptied and the index entries dropped, so the calendar and the
 * month chips go back to nothing rather than showing green over an empty file.
 */
export const eraseReport = async (report: BackupReport): Promise<number> => {
  const months = (await readIndex()).filter(entry => entry.report === report)
  let removed = 0

  for (const entry of months) {
    const emptied = await partition(report, entry.year, entry.month)
      .mutate(records => ({ records: [], result: records.length }))
      .catch(error => {
        logger.warn(`[ajio-backup] could not erase ${entry.year}-${entry.month}`, error)

        return 0
      })

    removed += emptied
    await reindex(report, entry.year, entry.month)
  }

  // The AWB lookup is built from what was just deleted.
  version += 1

  return removed
}

/**
 * Drops everything older than `start` (`yyyy-MM-dd`), across both reports.
 *
 * A month filed before the start is emptied whole — including any row with no
 * date, which a by-date filter would leave behind for ever. A month inside the
 * window loses only the rows dated before the start: a return created on the
 * 31st can be filed under the next month (see `deleteRange`).
 */
export const pruneBefore = async (start: string): Promise<number> => {
  const startMonth = start.slice(0, 7)
  let removed = 0

  for (const entry of await readIndex()) {
    const expired = `${entry.year}-${pad(entry.month)}` < startMonth

    const deleted = await partition(entry.report, entry.year, entry.month)
      .mutate(records => {
        const keep = expired ? [] : records.filter(record => !(record.date && record.date < start))

        return { records: keep, result: records.length - keep.length }
      })
      .catch(error => {
        logger.warn(`[ajio-backup] could not prune ${entry.report} ${entry.year}-${entry.month}`, error)

        return 0
      })

    if (deleted > 0 || expired) {
      removed += deleted
      await reindex(entry.report, entry.year, entry.month)
    }
  }

  if (removed > 0) version += 1

  return removed
}

/**
 * Every row this machine holds whose AWB or EAN contains `term`.
 *
 * ACROSS BOTH REPORTS AND EVERY MONTH, because that is the question being
 * asked. The viewer opened on one month of one report and filtered what it had
 * loaded, so searching for an AWB meant knowing which month it was in first —
 * and an operator with an AWB in their hand has exactly the thing that tells
 * them nothing about which month it belongs to.
 *
 * Read month by month rather than all at once: a year of both reports is
 * hundreds of thousands of rows, and holding them together to filter them is
 * how a desktop app runs out of memory over a search box.
 */
export const searchRecords = async (
  term: string,
  limit = 200
): Promise<{ hits: (BackupRecord & { report: BackupReport })[]; capped: boolean }> => {
  const wanted = term.trim().toUpperCase()
  const hits: (BackupRecord & { report: BackupReport })[] = []

  if (!wanted) return { hits, capped: false }

  const months = (await readIndex()).sort(
    (a, b) => b.year - a.year || b.month - a.month
  )

  for (const entry of months) {
    for (const record of await readMonth(entry.report, entry.year, entry.month)) {
      if (
        !record.awb.toUpperCase().includes(wanted) &&
        !record.ean.toUpperCase().includes(wanted)
      ) {
        continue
      }

      hits.push({ ...record, report: entry.report })

      // Stopped rather than truncated afterwards: the point of the cap is to
      // not read the rest of the backup once there is plainly enough to look at.
      if (hits.length >= limit) return { hits, capped: true }
    }
  }

  return { hits, capped: false }
}

/**
 * Every stored row whose AWB or EAN is one of `keys` — both reports, every
 * month.
 *
 * EXACT, unlike the search box. A pasted list is a list of identifiers, and a
 * "contains" match over it would pull in every row whose AWB happens to end in
 * somebody else's: the point of pasting fifteen numbers is to be told about
 * those fifteen.
 *
 * One pass over each month for the whole list, rather than a pass per number —
 * fifteen numbers against a year of both reports would otherwise read the
 * backup fifteen times.
 */
export const lookupRecords = async (
  keys: string[]
): Promise<{ hits: (BackupRecord & { report: BackupReport })[]; found: Set<string> }> => {
  const wanted = new Set(keys.map(key => key.trim().toUpperCase()).filter(Boolean))
  const hits: (BackupRecord & { report: BackupReport })[] = []
  const found = new Set<string>()

  if (wanted.size === 0) return { hits, found }

  const months = (await readIndex()).sort((a, b) => b.year - a.year || b.month - a.month)

  for (const entry of months) {
    for (const record of await readMonth(entry.report, entry.year, entry.month)) {
      const awb = record.awb.trim().toUpperCase()
      const ean = record.ean.trim().toUpperCase()
      const matched = wanted.has(awb) ? awb : wanted.has(ean) ? ean : null

      if (!matched) continue

      hits.push({ ...record, report: entry.report })
      found.add(matched)
    }
  }

  return { hits, found }
}

const DEFAULT_SETTINGS: BackupSettings = {
  username: '',
  dailyTime: null,
  lastRunAt: null,
  lastSyncedDate: null,
  lastSyncByReport: {}
}

export const readBackupSettings = async (): Promise<BackupSettings> => {
  if (!settings) return DEFAULT_SETTINGS

  const records = await settings.read().catch(() => [])

  return { ...DEFAULT_SETTINGS, ...(records[0] ?? {}) }
}

export const writeBackupSettings = async (patch: Partial<BackupSettings>): Promise<BackupSettings> => {
  const current = await readBackupSettings()
  const next = { ...current, ...patch }

  if (settings) {
    await settings
      .mutate(() => ({ records: [{ id: 'settings', ...next }], result: undefined }))
      .catch(error => logger.warn('[ajio-backup] could not save settings', error))
  }

  return next
}

/**
 * Stamps one report as synced, leaving the other's stamp alone.
 *
 * HERE RATHER THAN AT THE CALL SITE because `writeBackupSettings` merges one
 * level deep: a caller patching `lastSyncByReport` from what it happens to
 * remember would drop the other report's stamp every time this one ran — and
 * the whole point of keeping two is that each says something the other cannot.
 *
 * `lastSyncedDate` still moves with whichever report wrote last. That is what
 * "sync since last" reads, and it is deliberately left as it was: narrowing it
 * per report changes where a sync STARTS, which is a behaviour change and not
 * this function's business.
 */
export const recordReportSync = async (input: {
  report: BackupReport
  username: string
  /** The last date the run's window covered, `yyyy-MM-dd`. */
  coveredTo: string
  /** When it finished. Injected by the tests; now, in the app. */
  at?: string
  /**
   * Leave the card's chosen account as it is. The scheduled run reads EVERY
   * account, and must not hand the card whichever one it happened to read last.
   */
  keepChosenAccount?: boolean
}): Promise<BackupSettings> => {
  const current = await readBackupSettings()
  const stamp = { at: input.at ?? new Date().toISOString(), coveredTo: input.coveredTo }

  return writeBackupSettings({
    ...(input.keepChosenAccount === true ? {} : { username: input.username }),
    lastSyncedDate: input.coveredTo,
    lastSyncByReport: {
      ...current.lastSyncByReport,
      [input.report]: stamp
    },
    lastSyncByAccount: {
      ...(current.lastSyncByAccount ?? {}),
      [input.username]: { ...(current.lastSyncByAccount?.[input.username] ?? {}), [input.report]: stamp }
    }
  })
}

/**
 * Every line of one return order, out of this machine's backup.
 *
 * THE OTHER HALF OF THE RETURN-ORDER LOOKUP. The API path asks AJIO directly —
 * always current, needs a signed-in browser, and walks a month of pages per
 * window. This one reads what the nightly AJIO report sync already downloaded:
 * instant, no login, no network, and only as complete as the backup is. Which
 * one a claim uses is the operator's choice on the Create Claim form.
 *
 * A SCAN, NOT AN INDEX, and deliberately. `awbLookup` keeps a Map because every
 * refill row hits it; a return order number is typed by a person a few times an
 * hour, and a second index of every row in every month would cost memory all
 * day to save a few hundred milliseconds now and then.
 *
 * NEWEST MONTH FIRST, stopping at the first month that has it: a return order's
 * lines all share its creation date, so once a month answers there is nothing
 * for an older one to add. Same reasoning as the API path's windows.
 */
export const returnOrderRows = async (
  returnOrderNo: string
): Promise<{ rows: Record<string, unknown>[]; year: number; month: number } | null> => {
  const wanted = returnOrderNo.trim().toUpperCase()

  if (!wanted) return null

  const months = (await readIndex())
    .filter(entry => entry.report === 'return')
    .sort((a, b) => b.year - a.year || b.month - a.month)

  for (const entry of months) {
    const rows = (await readMonth('return', entry.year, entry.month))
      .filter(record => {
        const value = record.row.returnOrderNo

        return typeof value === 'string' && value.trim().toUpperCase() === wanted
      })
      .map(record => record.row)

    if (rows.length > 0) return { rows, year: entry.year, month: entry.month }
  }

  return null
}

/**
 * The forward AWB for one customer order number, out of the backup.
 *
 * THE OTHER HALF OF A REPORT-SOURCED CLAIM. The return report answers with
 * `fwdAwbNo` and it is very often null — AJIO simply does not carry the forward
 * leg on the return line. The API source chases it through the live forward
 * report; this is the same question asked of what the nightly sync already
 * downloaded, so the Report source can answer it without touching AJIO.
 *
 * KEYED ON `orderNo`, the customer order number the return line DID give us —
 * the same key the live lookup uses.
 *
 * A SCAN, like `returnOrderRows`, and for the same reason: this is asked a few
 * times an hour by a person, and a second index of every forward row in every
 * month would cost memory all day to save a moment now and then.
 *
 * THE FIRST ROW CARRYING AN AWB WINS. An order's lines ship together under one
 * AWB, but a cancelled line carries none — taking the first row blindly would
 * read that as "this order has no forward AWB".
 */
export const forwardAwbForOrder = async (orderNo: string): Promise<string | null> => {
  const wanted = orderNo.trim().toUpperCase()

  if (!wanted) return null

  const months = (await readIndex())
    .filter(entry => entry.report === 'forward')
    .sort((a, b) => b.year - a.year || b.month - a.month)

  for (const entry of months) {
    for (const record of await readMonth('forward', entry.year, entry.month)) {
      const order = record.row.orderNo

      if (typeof order !== 'string' || order.trim().toUpperCase() !== wanted) continue

      const awb = record.row.awbNumber

      if (typeof awb === 'string' && awb.trim().length > 0) return awb.trim()
    }
  }

  return null
}
