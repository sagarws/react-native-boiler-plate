import type { BackupArchiveExport, BackupArchiveImport } from '@shared/types/backupArchive'
import type { FlipkartRecord, FlipkartReport } from '@shared/types/flipkartBackup'
import { fail, ok, type Result } from '@shared/types/result'
import { readBackupZip, writeBackupZip } from './backupArchive'
import { readFlipkartRows, saveFlipkartRecords } from './flipkartBackup.store'
import { logger } from './logger'

/**
 * The Flipkart backup, off this machine and back on — one report at a time,
 * the report chosen on the card, as AJIO's card does it.
 *
 * The zip is written and read by `backupArchive`; this file only knows what a
 * Flipkart row is. Import is a MERGE through `saveFlipkartRecords`, so an
 * overlapping zip duplicates nothing.
 */

const LABEL: Record<FlipkartReport, string> = { forward: 'Flipkart orders', return: 'Flipkart returns' }

const reportOf = (payload: unknown): FlipkartReport =>
  (payload as { report?: unknown } | null)?.report === 'forward' ? 'forward' : 'return'

let moving = false

const toRecord = (row: Record<string, string>): FlipkartRecord | null => {
  const text = (field: string): string => String(row[field] ?? '').trim()
  const key = text('key')

  if (!key) return null

  return {
    key,
    username: text('username'),
    orderItemId: text('orderItemId'),
    sku: text('sku'),
    awb: text('awb'),
    date: text('date'),
    savedAt: text('savedAt') || new Date().toISOString(),
    requestId: text('requestId') || null
  }
}

export const exportFlipkartBackup = async (payload: unknown): Promise<Result<BackupArchiveExport>> => {
  const report = reportOf(payload)
  const result = await writeBackupZip({
    platform: 'flipkart',
    label: LABEL[report],
    report,
    rows: await readFlipkartRows(report),
    dateOf: row => row.date
  })

  if (result.success) {
    logger.info(`[flipkart-backup] exported ${result.data.rows} ${report} row(s) to ${result.data.path}`)
  }

  return result
}

export const importFlipkartBackup = async (payload: unknown): Promise<Result<BackupArchiveImport>> => {
  if (moving) return fail('VALIDATION_ERROR', 'An import is already running')

  const report = reportOf(payload)

  moving = true

  try {
    const read = await readBackupZip({ platform: 'flipkart', label: LABEL[report], report })

    if (!read.success) return read

    const summary: BackupArchiveImport = {
      path: read.data.path,
      added: 0,
      updated: 0,
      skipped: 0,
      failed: read.data.unreadable.length,
      months: 0
    }

    for (const month of read.data.months) {
      const records = month.rows.flatMap(row => {
        const record = toRecord(row)

        return record ? [record] : []
      })

      if (records.length === 0) continue

      const saved = await saveFlipkartRecords(report, records)

      summary.added += saved.added
      summary.updated += saved.updated
      summary.skipped += saved.skipped
      summary.months += 1
    }

    logger.info(
      `[flipkart-backup] imported ${summary.added} ${report} row(s) from ${summary.path} — ` +
        `${summary.updated} filled in, ${summary.skipped} already held, ${summary.failed} file(s) failed`
    )

    return ok(summary)
  } finally {
    moving = false
  }
}
