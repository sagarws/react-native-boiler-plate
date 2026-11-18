import type { BackupArchiveExport, BackupArchiveImport } from '@shared/types/backupArchive'
import type { SnapdealRecord } from '@shared/types/snapdealBackup'
import { fail, ok, type Result } from '@shared/types/result'
import { readBackupZip, writeBackupZip, type ArchivedMonth } from './backupArchive'
import { readSnapdealRows, saveSnapdealRecords } from './snapdealBackup.store'
import { logger } from './logger'

/**
 * The Snapdeal backup, off this machine and back on — the Export and Import
 * buttons on its card, as AJIO's card has them.
 *
 * The zip is written and read by `backupArchive`; this file only knows what a
 * Snapdeal row is. Import is a MERGE through `saveSnapdealRecords`, the same
 * one a download uses, so an overlapping zip duplicates nothing.
 */

const REPORT = 'return' as const

let moving = false

/** A sheet row back into a stored row, or null when it is not one. */
const toRecord = (row: Record<string, string>, at: ArchivedMonth): SnapdealRecord | null => {
  const text = (field: string): string => String(row[field] ?? '').trim()
  const key = text('key')
  const subOrderCode = text('subOrderCode')

  if (!key || !subOrderCode) return null

  const year = Number(text('year')) || at.year
  const month = Number(text('month')) || at.month

  return {
    key,
    subOrderCode,
    awb: text('awb'),
    reverseAwb: text('reverseAwb'),
    sku: text('sku'),
    date: text('date'),
    year,
    month,
    savedAt: text('savedAt') || new Date().toISOString(),
    requestId: text('requestId') || null
  }
}

export const exportSnapdealBackup = async (): Promise<Result<BackupArchiveExport>> => {
  const result = await writeBackupZip({
    platform: 'snapdeal',
    label: 'Snapdeal returns',
    report: REPORT,
    rows: await readSnapdealRows(REPORT),
    dateOf: row => row.date || `${row.year}-${String(row.month).padStart(2, '0')}-01`
  })

  if (result.success) {
    logger.info(`[snapdeal-backup] exported ${result.data.rows} row(s) to ${result.data.path}`)
  }

  return result
}

export const importSnapdealBackup = async (): Promise<Result<BackupArchiveImport>> => {
  if (moving) return fail('VALIDATION_ERROR', 'An import is already running')

  moving = true

  try {
    const read = await readBackupZip({ platform: 'snapdeal', label: 'Snapdeal returns', report: REPORT })

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
        const record = toRecord(row, month)

        return record ? [record] : []
      })

      if (records.length === 0) continue

      const saved = await saveSnapdealRecords(REPORT, records)

      summary.added += saved.added
      summary.updated += saved.updated
      summary.skipped += saved.skipped
      summary.months += 1
    }

    logger.info(
      `[snapdeal-backup] imported ${summary.added} row(s) from ${summary.path} — ` +
        `${summary.updated} filled in, ${summary.skipped} already held, ${summary.failed} file(s) failed`
    )

    return ok(summary)
  } finally {
    moving = false
  }
}
