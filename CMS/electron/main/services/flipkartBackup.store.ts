import type {
  FlipkartBackupSettings,
  FlipkartBackupState,
  FlipkartRecord,
  FlipkartReport,
  FlipkartRequest
} from '@shared/types/flipkartBackup'
import { FLIPKART_REPORTS } from '@shared/types/flipkartBackup'
import { flipkartRecordDiffers, mergeFlipkartRecord } from '@shared/utils/flipkartRows'
import { dataDirectory } from '../database'
import { JsonCollection } from '../database/jsonStore'

/**
 * Where the Flipkart backup lives on this machine.
 *
 *   `flipkart-backup-settings`   when it last ran, how far each account got.
 *   `flipkart-backup-requests`   what was asked of Flipkart, and how it went.
 *   `flipkart-backup-forward`    the Orders report: order item, SKU, forward AWB.
 *   `flipkart-backup-return`     the Returns report: order item, SKU, return AWB.
 *
 * One table per report, not per month: a record is four short strings and a
 * date, the same reasoning as `snapdeal-backup-return`.
 */

const SETTINGS_COLLECTION = 'flipkart-backup-settings'
const REQUESTS_COLLECTION = 'flipkart-backup-requests'

let settings: JsonCollection<FlipkartBackupSettings & { id: string }> | null = null
let requests: JsonCollection<FlipkartRequest> | null = null

const tables = new Map<FlipkartReport, JsonCollection<FlipkartRecord>>()

export const initialiseFlipkartBackup = (): void => {
  settings = new JsonCollection({ name: SETTINGS_COLLECTION, directory: dataDirectory() })
  requests = new JsonCollection({ name: REQUESTS_COLLECTION, directory: dataDirectory() })
}

const table = (report: FlipkartReport): JsonCollection<FlipkartRecord> => {
  const open = tables.get(report)

  if (open) return open

  const collection = new JsonCollection<FlipkartRecord>({
    name: `flipkart-backup-${report}`,
    directory: dataDirectory()
  })

  tables.set(report, collection)

  return collection
}

/* -------------------------------------------------------------------------- *
 * Settings
 * -------------------------------------------------------------------------- */

const DEFAULTS: FlipkartBackupSettings = { lastRunAt: null, lastStoredAt: null }

export const readFlipkartSettings = async (): Promise<FlipkartBackupSettings> => {
  const records = await (settings?.read().catch(() => []) ?? Promise.resolve([]))
  const held = records[0]

  return held ? { ...DEFAULTS, ...held } : { ...DEFAULTS }
}

export const writeFlipkartSettings = async (
  patch: Partial<FlipkartBackupSettings>
): Promise<FlipkartBackupSettings> => {
  const target = settings

  if (!target) return { ...DEFAULTS, ...patch }

  return target.mutate(records => {
    const next = { ...DEFAULTS, ...records[0], ...patch, id: 'flipkart-backup' }

    return { records: [next], result: next }
  })
}

/* -------------------------------------------------------------------------- *
 * Requests
 * -------------------------------------------------------------------------- */

export const readFlipkartRequests = async (): Promise<FlipkartRequest[]> =>
  (await requests?.read().catch(() => [])) ?? []

/** Inserts or replaces one request row, by our id. Newest first. */
export const saveFlipkartRequest = async (request: FlipkartRequest): Promise<void> => {
  const target = requests

  if (!target) return

  await target.mutate(records => {
    const rest = records.filter(record => record.id !== request.id)

    return { records: [request, ...rest], result: undefined }
  })
}

/** Drops request rows that ended before `from` — the retention prune. */
const pruneRequestsBefore = async (from: string): Promise<void> => {
  const target = requests

  if (!target) return

  await target.mutate(records => ({ records: records.filter(record => record.to >= from), result: undefined }))
}

/* -------------------------------------------------------------------------- *
 * Rows
 * -------------------------------------------------------------------------- */

/**
 * Adds new rows and fills blanks on held ones (a return listed before its
 * pickup had a tracking id). Returns what changed.
 */
export const saveFlipkartRecords = async (
  report: FlipkartReport,
  incoming: FlipkartRecord[]
): Promise<{ added: number; updated: number; skipped: number }> => {
  if (incoming.length === 0) return { added: 0, updated: 0, skipped: 0 }

  return table(report).mutate(records => {
    const byKey = new Map(records.map((record, index) => [record.key, index]))
    const next = [...records]
    let added = 0
    let updated = 0
    let skipped = 0

    for (const record of incoming) {
      const at = byKey.get(record.key)

      if (at === undefined) {
        byKey.set(record.key, next.length)
        next.push(record)
        added += 1
        continue
      }

      const held = next[at] as FlipkartRecord
      const merged = mergeFlipkartRecord(held, record)

      if (flipkartRecordDiffers(held, merged)) {
        next[at] = merged
        updated += 1
      } else {
        skipped += 1
      }
    }

    return { records: next, result: { added, updated, skipped } }
  })
}

export const readFlipkartRows = async (report: FlipkartReport): Promise<FlipkartRecord[]> =>
  table(report)
    .read()
    .catch(() => [])

/** Removes rows dated before `from`, and the requests that only covered them. */
export const pruneFlipkartBefore = async (from: string): Promise<number> => {
  let removed = 0

  for (const report of FLIPKART_REPORTS) {
    removed += await table(report).mutate(records => {
      const kept = records.filter(record => !record.date || record.date >= from)

      return { records: kept, result: records.length - kept.length }
    })
  }

  await pruneRequestsBefore(from)

  return removed
}

/**
 * Every row of one report deleted, with the request rows that brought them
 * and how far each account had got — otherwise the next pass would believe the
 * erased windows were still held and never ask for them again. Outstanding
 * requests are kept: Flipkart is still building them, and collecting them is
 * how the backup refills.
 */
export const eraseFlipkartRows = async (report: FlipkartReport): Promise<number> => {
  const removed = await table(report).mutate(records => ({ records: [], result: records.length }))

  await requests?.mutate(records => ({
    records: records.filter(record => record.report !== report || record.status === 'requested'),
    result: undefined
  }))

  const { coveredToByAccount = {} } = await readFlipkartSettings()
  const cleared = Object.fromEntries(
    Object.entries(coveredToByAccount).map(([username, reports]) => {
      const rest = { ...reports }

      delete rest[report]

      return [username, rest]
    })
  )

  await writeFlipkartSettings({ coveredToByAccount: cleared })

  return removed
}

/** Removes one report's rows dated inside a range. */
export const deleteFlipkartRange = async (report: FlipkartReport, from: string, to: string): Promise<number> =>
  table(report)
    .mutate(records => {
      const keep = records.filter(record => record.date < from || record.date > to)

      return { records: keep, result: records.length - keep.length }
    })
    .catch(() => 0)

/**
 * Forgets one report's request rows touching a range, whatever their state, so
 * those windows can be asked for again. The stored rows are kept.
 */
export const forgetFlipkartRequests = async (report: FlipkartReport, from: string, to: string): Promise<number> =>
  (await requests
    ?.mutate(records => {
      const keep = records.filter(record => record.report !== report || record.to < from || record.from > to)

      return { records: keep, result: records.length - keep.length }
    })
    .catch(() => 0)) ?? 0

const same = (a: string, b: string): boolean => a.trim().toUpperCase() === b.trim().toUpperCase()

/**
 * Every row of one report carrying this AWB (forward or return), and every row
 * of the other report sharing an order item with them — the join Create Claim
 * fills from. Exact match, case-insensitive.
 */
export const findFlipkartByAwb = async (
  awb: string,
  side: FlipkartReport
): Promise<{ hits: FlipkartRecord[]; others: FlipkartRecord[] }> => {
  const hits = (await readFlipkartRows(side)).filter(record => record.awb && same(record.awb, awb))

  if (hits.length === 0) return { hits, others: [] }

  const items = new Set(hits.map(record => record.orderItemId.toUpperCase()))
  const other: FlipkartReport = side === 'forward' ? 'return' : 'forward'
  const others = (await readFlipkartRows(other)).filter(record => items.has(record.orderItemId.toUpperCase()))

  return { hits, others }
}

/** What is held, for the status line. */
export const readFlipkartState = async (): Promise<FlipkartBackupState> => {
  const reports = await Promise.all(
    FLIPKART_REPORTS.map(async report => {
      const rows = await readFlipkartRows(report)
      const dates = rows.map(record => record.date).filter(Boolean).sort()

      return { report, rows: rows.length, from: dates[0] ?? null, to: dates.at(-1) ?? null }
    })
  )
  const outstanding = (await readFlipkartRequests()).filter(record => record.status === 'requested').length
  const held = await readFlipkartSettings()

  return { reports, outstanding, lastRunAt: held.lastRunAt, lastStoredAt: held.lastStoredAt }
}
