import { readdir, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type {
  SnapdealBackupSettings,
  SnapdealCoverage,
  SnapdealDayCoverage,
  SnapdealMonthCoverage,
  SnapdealRecord,
  SnapdealReport,
  SnapdealRequest,
  SnapdealRequestCoverage,
  SnapdealRequestDay,
  SnapdealRequestStatus
} from '@shared/types/snapdealBackup'
import {
  bestRequestStatus,
  mergeSnapdealRecord,
  snapdealDaysIn,
  snapdealRecordDiffers
} from '@shared/utils/snapdealRows'
import { dataDirectory } from '../database'
import { JsonCollection } from '../database/jsonStore'
import { logger } from './logger'

/**
 * Where the Snapdeal backup lives on this machine.
 *
 * THREE STORES, NOT ONE, because three different questions are asked of it:
 *
 *   `snapdeal-backup-requests`   what was asked of Snapdeal, and how it went.
 *   `snapdeal-backup-return`     every stored return, in ONE table.
 *   `snapdeal-backup-index`      day counts per month, so a calendar can be
 *                                drawn without reading the rows.
 *
 * The request table is the one that has no equivalent in the AJIO backup, and
 * it is the reason this feature works at all: Snapdeal builds a report over
 * minutes, so between asking and holding there is a state that neither the
 * rows nor a log can represent. Without it, a pass that asked for twelve
 * months and collected none looks exactly like a pass that was never run.
 *
 * ONE TABLE FOR THE ROWS, and NOT one file per month as the AJIO backup has.
 * That difference is a difference in the data, not a change of mind: an AJIO
 * month is forty columns of claim evidence and runs to 30 MB, so a write that
 * touched every month would rewrite a third of a gigabyte. A Snapdeal record
 * is four short strings and a date — a hundred-row month is 30 KB, a year
 * under half a megabyte — and splitting that across twelve files bought
 * nothing while costing plenty: twelve rows in the Local Database page where
 * one belongs, a search that opens twelve files, and a row that cannot be
 * found without first guessing which month it was filed under.
 *
 * Every row carries `requestId`, the `id` of the row in
 * `snapdeal-backup-requests` that brought it — so "which window did this come
 * from" is a join rather than a filename.
 */

const SETTINGS_COLLECTION = 'snapdeal-backup-settings'
const REQUESTS_COLLECTION = 'snapdeal-backup-requests'
const INDEX_COLLECTION = 'snapdeal-backup-index'

const pad = (value: number): string => String(value).padStart(2, '0')

/** `snapdeal-backup-return` — every stored row of one report. */
const tableName = (report: SnapdealReport): string => `snapdeal-backup-${report}`

/**
 * The per-month files this store used to write.
 *
 * Matched so `foldInMonthFiles` can carry their rows into the one table and
 * delete them. Anchored on the full name: `snapdeal-backup-return` itself must
 * not match, or a migration would fold the new table into itself.
 */
const LEGACY_PARTITION = /^snapdeal-backup-([a-z]+)-(\d{4})-(\d{2})$/

interface MonthIndex extends Omit<SnapdealMonthCoverage, 'bytes'> {
  report: SnapdealReport
  /** Rows per day, `yyyy-MM-dd` → count. */
  days: Record<string, number>
}

let settings: JsonCollection<SnapdealBackupSettings & { id: string }> | null = null
let requests: JsonCollection<SnapdealRequest> | null = null
let index: JsonCollection<MonthIndex> | null = null

const tables = new Map<string, JsonCollection<SnapdealRecord>>()

export const initialiseSnapdealBackup = (): void => {
  settings = new JsonCollection({ name: SETTINGS_COLLECTION, directory: dataDirectory() })
  requests = new JsonCollection({ name: REQUESTS_COLLECTION, directory: dataDirectory() })
  index = new JsonCollection({ name: INDEX_COLLECTION, directory: dataDirectory() })
}

const table = (report: SnapdealReport): JsonCollection<SnapdealRecord> => {
  const name = tableName(report)
  const open = tables.get(name)

  if (open) return open

  const collection = new JsonCollection<SnapdealRecord>({ name, directory: dataDirectory() })

  tables.set(name, collection)

  return collection
}

/* -------------------------------------------------------------------------- *
 * Settings
 * -------------------------------------------------------------------------- */

const DEFAULTS: SnapdealBackupSettings = {
  username: '',
  lastRunAt: null,
  coveredTo: null,
  lastStoredAt: null
}

export const readSnapdealSettings = async (): Promise<SnapdealBackupSettings> => {
  const records = await (settings?.read().catch(() => []) ?? Promise.resolve([]))
  const held = records[0]

  return held ? { ...DEFAULTS, ...held } : { ...DEFAULTS }
}

export const writeSnapdealSettings = async (
  patch: Partial<SnapdealBackupSettings>
): Promise<SnapdealBackupSettings> => {
  const target = settings

  if (!target) return { ...DEFAULTS, ...patch }

  return target.mutate(records => {
    const next = { ...DEFAULTS, ...records[0], ...patch, id: 'snapdeal-backup' }

    return { records: [next], result: next }
  })
}

/* -------------------------------------------------------------------------- *
 * The request table
 * -------------------------------------------------------------------------- */

/** Every request, newest first. */
export const readSnapdealRequests = async (
  report?: SnapdealReport
): Promise<SnapdealRequest[]> => {
  const records = await (requests?.read().catch(() => [] as SnapdealRequest[]) ??
    Promise.resolve([] as SnapdealRequest[]))

  return records
    .filter(record => !report || record.report === report)
    .sort((a, b) => Date.parse(b.requestedAt) - Date.parse(a.requestedAt))
}

/**
 * Adds or replaces one request row. Never throws.
 *
 * The request table is bookkeeping ABOUT work, so a write that fails must not
 * fail the work — but unlike the job archive it is also load-bearing: losing a
 * row means asking Snapdeal for a window it is already building. So a failure
 * is logged loudly rather than swallowed quietly.
 */
export const saveSnapdealRequest = async (request: SnapdealRequest): Promise<void> => {
  const target = requests

  if (!target) return

  await target
    .mutate(records => {
      const rest = records.filter(record => record.id !== request.id)

      return { records: [request, ...rest], result: undefined }
    })
    .catch(error =>
      logger.error(
        `[snapdeal-backup] could not record the request for ${request.from} → ${request.to}`,
        error
      )
    )
}

/**
 * The requests whose window overlaps this range.
 *
 * OVERLAP, NOT CONTAINMENT. A 28-day window rarely lines up with the range
 * somebody picks on a calendar, so "the requests covering 3–7 October" has to
 * include the one that ran from 15 September to 12 October — otherwise the
 * manual download in the request coverage dialog finds nothing for a range
 * whose rows are sitting in a file that was already fetched.
 */
export const snapdealRequestsOverlapping = async (input: {
  report: SnapdealReport
  from: string
  to: string
}): Promise<SnapdealRequest[]> =>
  (await readSnapdealRequests(input.report)).filter(
    record => record.from <= input.to && record.to >= input.from
  )

/**
 * Throws away request rows for a range, so those windows can be asked for
 * again.
 *
 * The one way out of a stuck row: a request Snapdeal lost, or one this machine
 * recorded as sent while the portal never queued it, would otherwise block its
 * window for ever — `requestSnapdealWindows` skips a window a request already
 * covers, which is exactly what makes a stale row permanent.
 *
 * Does NOT touch the rows. Forgetting the receipt and deleting the data are
 * different decisions, and conflating them would make "ask again" destructive.
 */
export const forgetSnapdealRequests = async (input: {
  report: SnapdealReport
  from: string
  to: string
}): Promise<number> => {
  const target = requests

  if (!target) return 0

  return target
    .mutate(records => {
      const keep = records.filter(
        record =>
          record.report !== input.report || record.to < input.from || record.from > input.to
      )

      return { records: keep, result: records.length - keep.length }
    })
    .catch(error => {
      logger.warn('[snapdeal-backup] could not forget requests', error)

      return 0
    })
}

/**
 * What was asked for, day by day.
 *
 * Painted by the furthest any request covering that day got — see
 * `bestRequestStatus`. A day nothing was ever asked for is simply absent, which
 * is what the calendar draws as grey.
 */
export const readSnapdealRequestCoverage = async (
  report: SnapdealReport
): Promise<SnapdealRequestCoverage> => {
  const rows = await readSnapdealRequests(report)
  const byDay = new Map<string, SnapdealRequestStatus[]>()

  for (const request of rows) {
    for (const date of snapdealDaysIn({ from: request.from, to: request.to })) {
      const held = byDay.get(date)

      if (held) held.push(request.status)
      else byDay.set(date, [request.status])
    }
  }

  const days: SnapdealRequestDay[] = [...byDay.entries()]
    .map(([date, statuses]) => ({ date, status: bestRequestStatus(statuses) ?? 'requested' }))
    .sort((a, b) => a.date.localeCompare(b.date))

  return {
    report,
    days,
    requests: rows,
    outstanding: rows.filter(row => row.status === 'requested' || row.status === 'ready').length
  }
}

/* -------------------------------------------------------------------------- *
 * The rows
 * -------------------------------------------------------------------------- */

const indexId = (report: SnapdealReport, year: number, month: number): string =>
  `${report}-${year}-${pad(month)}`

/**
 * Recomputes the WHOLE index for a report from the one table it now has.
 *
 * Every month at once, because there is one file: a reindex that touched a
 * single month would still have read all the rows to find it, and would leave
 * a month that lost its last row sitting in the index for ever.
 *
 * Never throws — the index is derived, and a calendar that is briefly stale is
 * not worth failing a save that has already landed.
 */
const reindex = async (report: SnapdealReport): Promise<void> => {
  if (!index) return

  const rows = await readSnapdealRows(report)
  const months = new Map<string, MonthIndex>()
  const stamp = new Date().toISOString()

  for (const record of rows) {
    if (!record.year || !record.month) continue

    const id = indexId(report, record.year, record.month)
    const entry = months.get(id) ?? {
      report,
      year: record.year,
      month: record.month,
      rows: 0,
      lastStoredAt: stamp,
      days: {}
    }

    entry.rows += 1
    if (record.date) entry.days[record.date] = (entry.days[record.date] ?? 0) + 1
    months.set(id, entry)
  }

  await index
    .mutate(records => ({
      // Other reports' entries are left alone; this report's are replaced
      // wholesale, so a month with nothing left simply stops being listed.
      records: [...records.filter(entry => entry.report !== report), ...months.values()],
      result: undefined
    }))
    .catch(error => logger.warn(`[snapdeal-backup] could not index ${report}`, error))
}

/** The merge itself, shared by a download and by the migration below. */
const mergeIntoTable = async (
  report: SnapdealReport,
  records: SnapdealRecord[]
): Promise<{ added: number; updated: number; skipped: number }> =>
  table(report)
    .mutate(existing => {
      const held = new Map(existing.map(record => [record.key, record]))
      let added = 0
      let updated = 0
      let skipped = 0

      for (const record of records) {
        const current = held.get(record.key)

        if (!current) {
          held.set(record.key, record)
          added += 1
          continue
        }

        const merged = mergeSnapdealRecord(current, record)

        if (snapdealRecordDiffers(current, merged)) {
          held.set(record.key, merged)
          updated += 1
        } else {
          skipped += 1
        }
      }

      return { records: [...held.values()], result: { added, updated, skipped } }
    })
    .catch(error => {
      logger.warn(`[snapdeal-backup] could not save ${report} rows`, error)

      return { added: 0, updated: 0, skipped: 0 }
    })

/**
 * Carries rows out of the old per-month files into the one table, once.
 *
 * WHY THIS EXISTS RATHER THAN A LINE IN A CHANGELOG. A machine that has been
 * collecting already holds `snapdeal-backup-return-2026-04` and its siblings,
 * and those rows cannot simply be fetched again: Snapdeal's window has moved
 * on, and where it has not, a report still takes minutes to rebuild. Shipping
 * the new shape without this would silently empty the backup of every month it
 * had.
 *
 * It also REPOINTS the reference on every row it carries. Rows written by the
 * per-month version stored Snapdeal's own portal number in `requestId`; rows
 * written now store the `id` of the request row that brought them. Folding
 * them in without translating would leave one column meaning two different
 * things depending on when a row happened to be collected — a join that works
 * for this month and silently returns nothing for last month, which is worse
 * than either convention on its own.
 *
 * Idempotent and best effort: rows are merged by the same rule a download uses,
 * a file is deleted only AFTER its rows are in, and anything that will not read
 * is left on disk to be looked at rather than thrown away.
 */
export const foldInMonthFiles = async (): Promise<number> => {
  const directory = dataDirectory()
  let folded = 0
  let entries: string[]

  try {
    entries = await readdir(directory)
  } catch {
    return 0
  }

  // Snapdeal's portal number → our request row's id. Built once; a portal
  // number it does not know is left alone rather than blanked, because a
  // reference nobody can follow is still better evidence than none.
  const byPortalId = new Map<string, string>()

  for (const request of await readSnapdealRequests()) {
    if (request.requestId) byPortalId.set(request.requestId, request.id)
  }

  const touched = new Set<SnapdealReport>()

  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue

    const name = entry.slice(0, -5)
    const match = LEGACY_PARTITION.exec(name)

    if (!match) continue

    const report = match[1] as SnapdealReport

    try {
      const rows = (await new JsonCollection<SnapdealRecord>({ name, directory }).read()).map(
        record => {
          const repointed = record.requestId ? byPortalId.get(record.requestId) : undefined

          return repointed ? { ...record, requestId: repointed } : record
        }
      )

      if (rows.length > 0) {
        await mergeIntoTable(report, rows)
        folded += rows.length
        touched.add(report)
      }

      // Only once the rows are safely in the table. Deleting before the merge
      // is the one ordering that can lose them.
      await rm(join(directory, entry), { force: true })
      logger.info(
        `[snapdeal-backup] folded ${rows.length} row(s) from ${name} into ${tableName(report)}`
      )
    } catch (error) {
      logger.warn(`[snapdeal-backup] could not fold ${name} in — leaving it on disk`, error)
    }
  }

  for (const report of touched) await reindex(report)

  return folded
}

/**
 * Adds rows, merging anything already held.
 *
 * MERGED RATHER THAN SKIPPED, which is where this parts company with the AJIO
 * backup. Snapdeal serves the same return twice — once when it was raised,
 * carrying no forward AWB, and again once the forward leg was settled — so a
 * plain "skip what is held" keeps whichever row arrived first and throws away
 * the forward AWB in the other. In a real report that was 85 of 331 returns.
 *
 * So a held record is merged with the incoming one and rewritten only when the
 * merge actually changed something. Three counts come back because they are
 * three different outcomes: new, enriched, and already complete.
 */
export const saveSnapdealRecords = async (
  report: SnapdealReport,
  records: SnapdealRecord[]
): Promise<{ added: number; updated: number; skipped: number }> => {
  if (records.length === 0) return { added: 0, updated: 0, skipped: 0 }

  const result = await mergeIntoTable(report, records)

  if (result.added > 0 || result.updated > 0) await reindex(report)

  return result
}

/** What the table takes on disk. 0 when it cannot be read. */
const tableBytes = async (report: SnapdealReport): Promise<number> =>
  stat(table(report).filePath)
    .then(info => info.size)
    .catch(() => 0)

/**
 * Every month held for one report, newest first, with its day counts.
 *
 * `bytes` is now the WHOLE table's size, reported once on the coverage rather
 * than per month: the rows share one file, so a per-month figure would either
 * be a guess or the same number repeated twelve times. Each month therefore
 * reports 0, and the total is the file — which is the number that answers the
 * question anybody is asking, namely what this costs on the machine.
 */
export const readSnapdealCoverage = async (
  report: SnapdealReport
): Promise<SnapdealCoverage> => {
  const months = (
    await (index?.read().catch(() => [] as MonthIndex[]) ?? Promise.resolve([] as MonthIndex[]))
  ).filter(entry => entry.report === report)

  const days: SnapdealDayCoverage[] = months
    .flatMap(entry => Object.entries(entry.days).map(([date, rows]) => ({ date, rows })))
    .sort((a, b) => a.date.localeCompare(b.date))

  const summary: SnapdealMonthCoverage[] = months
    .map(({ year, month, rows, lastStoredAt }) => ({ year, month, rows, lastStoredAt, bytes: 0 }))
    .sort((a, b) => b.year - a.year || b.month - a.month)

  return {
    report,
    months: summary,
    days,
    rows: summary.reduce((total, entry) => total + entry.rows, 0),
    bytes: await tableBytes(report)
  }
}

/** Every stored row of one report. */
export const readSnapdealRows = async (report: SnapdealReport): Promise<SnapdealRecord[]> =>
  table(report)
    .read()
    .catch(() => [] as SnapdealRecord[])

/** One month's rows, for the viewer — filtered out of the one table. */
export const readSnapdealMonth = async (
  report: SnapdealReport,
  year: number,
  month: number
): Promise<SnapdealRecord[]> =>
  (await readSnapdealRows(report)).filter(
    record => record.year === year && record.month === month
  )

/** Which months this report holds anything for. */
export const heldSnapdealMonths = async (
  report: SnapdealReport
): Promise<{ year: number; month: number }[]> =>
  (await (index?.read().catch(() => [] as MonthIndex[]) ?? Promise.resolve([] as MonthIndex[])))
    .filter(entry => entry.report === report)
    .map(({ year, month }) => ({ year, month }))

/**
 * Deletes rows whose own date falls inside the range.
 *
 * By the ROW's date rather than by the month it was filed under: a return
 * raised on the 31st can arrive in a window belonging to the next month, and a
 * delete that went by month would leave it behind while claiming the range was
 * cleared. With one table that is simply what the filter says — which is half
 * the reason the months are gone.
 */
export const deleteSnapdealRange = async (
  report: SnapdealReport,
  from: string,
  to: string
): Promise<number> => {
  const removed = await table(report)
    .mutate(records => {
      const keep = records.filter(record => record.date < from || record.date > to)

      return { records: keep, result: records.length - keep.length }
    })
    .catch(() => 0)

  if (removed > 0) await reindex(report)

  return removed
}

/**
 * Drops every row older than `start` (`yyyy-MM-dd`), and the request receipts
 * that only covered those days.
 *
 * By the month a row was filed under OR its own date, so a row with no date in
 * an expired month still goes. The receipts go too: a window wholly before the
 * start describes data this machine no longer holds, and left behind it would
 * paint the coverage calendar for months the card no longer offers.
 */
export const pruneSnapdealBefore = async (
  report: SnapdealReport,
  start: string
): Promise<number> => {
  const startMonth = start.slice(0, 7)

  const removed = await table(report)
    .mutate(records => {
      const keep = records.filter(record => {
        const filed = record.year && record.month ? `${record.year}-${pad(record.month)}` : null

        if (filed && filed < startMonth) return false

        return !(record.date && record.date < start)
      })

      return { records: keep, result: records.length - keep.length }
    })
    .catch(error => {
      logger.warn(`[snapdeal-backup] could not prune ${report}`, error)

      return 0
    })

  if (removed > 0) await reindex(report)

  await requests
    ?.mutate(records => {
      const keep = records.filter(record => record.report !== report || record.to >= start)

      return { records: keep, result: undefined }
    })
    .catch(error => logger.warn('[snapdeal-backup] could not prune requests', error))

  return removed
}

/** Everything held for one report. Returns what went. */
export const eraseSnapdealReport = async (
  report: SnapdealReport
): Promise<{ rows: number; months: number }> => {
  const months = (await heldSnapdealMonths(report)).length
  const rows = (await readSnapdealRows(report)).length

  await table(report)
    .clear()
    .catch(() => undefined)
  await reindex(report)

  return { rows, months }
}

/**
 * The stored return for one AWB — an EXACT match, on the return AWB
 * (`reverseAwb`) or the forward one (`awb`) depending on which field was typed.
 *
 * Snapdeal can serve one return on more than one row (see `saveSnapdealRecords`),
 * so when several match, the fullest one wins — a row with the forward AWB and
 * SKU filled in over one without — and then the most recent.
 */
export const findSnapdealByAwb = async (
  awb: string,
  side: 'return' | 'forward'
): Promise<SnapdealRecord | null> => {
  const wanted = awb.trim().toUpperCase()

  if (!wanted) return null

  const filled = (record: SnapdealRecord): number =>
    [record.subOrderCode, record.awb, record.reverseAwb, record.sku].filter(Boolean).length

  const matches = (await readSnapdealRows('return')).filter(record =>
    (side === 'return' ? record.reverseAwb : record.awb).trim().toUpperCase() === wanted
  )

  return (
    matches.sort((a, b) => filled(b) - filled(a) || b.date.localeCompare(a.date))[0] ?? null
  )
}

/** The most rows one search answers with. Beyond this it is an export. */
const SEARCH_CAP = 500

/**
 * Rows whose sub-order, either AWB or SKU contains the term.
 *
 * Case and padding are ignored on both sides: a number copied out of a
 * spreadsheet arrives with whatever casing and spaces it had, and none of that
 * says anything about whether the row is held.
 */
export const searchSnapdealRecords = async (
  term: string
): Promise<{ hits: SnapdealRecord[]; capped: boolean }> => {
  const wanted = term.trim().toUpperCase()
  const hits: SnapdealRecord[] = []

  for (const record of await readSnapdealRows('return')) {
    const haystack = `${record.subOrderCode}|${record.awb}|${record.reverseAwb}|${record.sku}`

    if (!haystack.toUpperCase().includes(wanted)) continue

    hits.push(record)

    if (hits.length >= SEARCH_CAP) return { hits, capped: true }
  }

  return { hits, capped: false }
}
