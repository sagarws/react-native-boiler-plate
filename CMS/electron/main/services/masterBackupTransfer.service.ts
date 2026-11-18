import { app, dialog } from 'electron'
import { writeFile, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import JSZip from 'jszip'
import * as XLSX from 'xlsx'
import type {
  BackupEraseSummary,
  BackupExportSummary,
  BackupImportSummary,
  BackupRecord,
  BackupReport
} from '@shared/types/masterBackup'
import { fail, ok, type Result } from '@shared/types/result'
import {
  pagePath,
  parsePagePath,
  recordToSheetRow,
  sheetRowToRecord
} from '@shared/utils/backupRows'
import { eraseReport, readCoverage, readMonth, saveRecords } from './masterBackup.store'
import { isRetainedMonth } from '@shared/utils/backupRetention'
import { logger } from './logger'

/**
 * Taking the backup off this machine, and putting it back.
 *
 * The backup is the only durable copy of reports AJIO itself stops serving, and
 * it lives in one app's data directory on one laptop. That is a single point of
 * failure with no answer until it can be moved: to another machine, to a drive,
 * to whoever asks for the year's returns.
 *
 * ONE ZIP, LAID OUT LIKE THE DATA:
 *
 *   2026/09/1.xlsx        one page, as AJIO served it — a hundred rows
 *   2026/09/2.xlsx
 *   manifest.json         which report, when, how many rows
 *
 * Year, then month, then page, because that is how it was fetched and how it is
 * stored. A zip that mirrors the partitions can be read against the Coverage
 * calendar by eye, and a missing page is a missing FILE rather than rows that
 * quietly are not there.
 *
 * XLSX RATHER THAN JSON, because the reason to take data out of an app is
 * usually to look at it or send it to somebody who will. The round trip is
 * lossless either way: every field AJIO returned is a column, and the three
 * added ones say where the row sat.
 *
 * IMPORT IS A MERGE, not a replace. It goes through the same AWB + EAN skip a
 * sync does, so importing a zip that overlaps what is already held costs
 * nothing and duplicates nothing — and a laptop can be rebuilt from a colleague's
 * export without anybody comparing dates first.
 */

/** What the zip says about itself, for an import that should not have to guess. */
interface Manifest {
  report: BackupReport
  exportedAt: string
  rows: number
  months: { year: number; month: number; rows: number }[]
  app: string
}

const REPORT_NAMES: Record<BackupReport, string> = {
  forward: 'forward',
  return: 'return'
}

const stamp = (): string => new Date().toISOString().slice(0, 10)

/** One page's rows as a workbook, in memory. */
const pageWorkbook = (records: BackupRecord[]): Buffer => {
  const sheet = XLSX.utils.json_to_sheet(records.map(recordToSheetRow))
  const book = XLSX.utils.book_new()

  XLSX.utils.book_append_sheet(book, sheet, 'Rows')

  return XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer
}

/**
 * Everything held for one report, as a zip in the Downloads folder.
 *
 * Written straight there rather than through a save dialog: an export of a
 * whole backup is a background chore, not a decision, and the toast names the
 * file.
 */
export const exportBackup = async (payload: unknown): Promise<Result<BackupExportSummary>> => {
  const report = ((payload ?? {}) as { report?: unknown }).report as BackupReport

  if (report !== 'forward' && report !== 'return') {
    return fail('VALIDATION_ERROR', 'Choose which report to export')
  }

  const coverage = await readCoverage(report)

  if (coverage.months.length === 0) {
    return fail('VALIDATION_ERROR', `Nothing is backed up for the ${REPORT_NAMES[report]} report yet`)
  }

  const zip = new JSZip()
  const manifest: Manifest = {
    report,
    exportedAt: new Date().toISOString(),
    rows: 0,
    months: [],
    app: `TrackVid CMS ${app.getVersion()}`
  }
  let files = 0

  for (const month of coverage.months) {
    const records = await readMonth(report, month.year, month.month)

    if (records.length === 0) continue

    // Grouped by the page each row ARRIVED in, so the export is the fetch
    // played back — not a hundred-row slice of something re-sorted here.
    const pages = new Map<number, BackupRecord[]>()

    for (const record of records) {
      const page = pages.get(record.page) ?? []

      page.push(record)
      pages.set(record.page, page)
    }

    for (const [page, rows] of [...pages.entries()].sort((a, b) => a[0] - b[0])) {
      zip.file(pagePath(month.year, month.month, page), pageWorkbook(rows))
      files += 1
    }

    manifest.rows += records.length
    manifest.months.push({ year: month.year, month: month.month, rows: records.length })
  }

  zip.file('manifest.json', JSON.stringify(manifest, null, 2))

  const path = join(
    app.getPath('downloads'),
    `ajio-${REPORT_NAMES[report]}-backup-${stamp()}.zip`
  )
  const bytes = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })

  await writeFile(path, bytes)

  logger.info(`[ajio-backup] exported ${manifest.rows} row(s) in ${files} file(s) to ${path}`)

  return ok({
    report,
    path,
    files,
    rows: manifest.rows,
    months: manifest.months.length,
    bytes: bytes.byteLength
  })
}

/**
 * The same zip, back in.
 *
 * The REPORT comes from the manifest where there is one, because a zip that
 * says what it holds cannot be imported into the wrong half of the backup by
 * somebody who picked the wrong dropdown. Without a manifest — a hand-made zip,
 * or one edited in Finder — the caller's choice stands, and the path of each
 * file still says which month and page it belongs to.
 */
export const importBackup = async (payload: unknown): Promise<Result<BackupImportSummary>> => {
  const request = (payload ?? {}) as { report?: unknown; path?: unknown }
  const fallbackReport = request.report as BackupReport
  let path = typeof request.path === 'string' ? request.path : ''

  if (!path) {
    const chosen = await dialog.showOpenDialog({
      title: 'Import an AJIO backup',
      properties: ['openFile'],
      filters: [{ name: 'Backup archive', extensions: ['zip'] }],
      defaultPath: app.getPath('downloads')
    })

    if (chosen.canceled || !chosen.filePaths[0]) return fail('VALIDATION_ERROR', 'Cancelled')

    path = chosen.filePaths[0]
  }

  let zip: JSZip

  try {
    zip = await JSZip.loadAsync(await readFile(path))
  } catch (error) {
    return fail(
      'VALIDATION_ERROR',
      `That file could not be opened as a zip — ${error instanceof Error ? error.message : String(error)}`
    )
  }

  let report = fallbackReport === 'forward' || fallbackReport === 'return' ? fallbackReport : 'return'
  const manifestFile = zip.file('manifest.json')

  if (manifestFile) {
    try {
      const manifest = JSON.parse(await manifestFile.async('string')) as Partial<Manifest>

      if (manifest.report === 'forward' || manifest.report === 'return') report = manifest.report
    } catch {
      // A manifest that will not parse is not worth failing the import over:
      // every file still carries its own year, month and page in its path.
    }
  }

  let added = 0
  let skipped = 0
  let failed = 0
  const months = new Set<string>()

  for (const [name, file] of Object.entries(zip.files)) {
    if (file.dir) continue

    const at = parsePagePath(name)

    if (!at) continue
    // Older than the five months kept: importing it would only be pruned again.
    if (!isRetainedMonth(at.year, at.month)) {
      logger.info(`[ajio-backup] import: ${name} skipped — before the retention window`)

      continue
    }

    try {
      const book = XLSX.read(await file.async('nodebuffer'), { type: 'buffer' })
      const first = book.SheetNames[0]
      const sheet = first ? book.Sheets[first] : null

      if (!sheet) continue

      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' })
      const records = rows.map(row => sheetRowToRecord(row, at))
      const saved = await saveRecords(report, at.year, at.month, records)

      added += saved.added
      skipped += saved.skipped
      months.add(`${at.year}-${at.month}`)
    } catch (error) {
      // One unreadable page must not lose the other eleven: it is counted and
      // named, and re-importing the same zip fills it if it was a transient
      // read rather than a corrupt file.
      failed += 1
      logger.warn(`[ajio-backup] could not import ${name}`, error)
    }
  }

  logger.info(
    `[ajio-backup] imported ${added} row(s) from ${path} — ${skipped} already held, ${failed} file(s) failed`
  )

  return ok({ report, path, added, skipped, failed, months: months.size })
}

/**
 * Everything held for one report, deleted.
 *
 * THE ONE IRREVERSIBLE THING ON THIS CARD, and the only one that asks first.
 * AJIO's reports are a live window: a month erased here may be a month nobody
 * can fetch again, so the question names the report, the rows and the size —
 * what is about to be lost, not "are you sure" — and the confirming button says
 * what it does rather than "OK".
 *
 * The export beside it is the answer to a mis-press, which is why the prompt
 * points at it.
 */
export const eraseBackup = async (payload: unknown): Promise<Result<BackupEraseSummary>> => {
  const report = ((payload ?? {}) as { report?: unknown }).report as BackupReport

  if (report !== 'forward' && report !== 'return') {
    return fail('VALIDATION_ERROR', 'Choose which report to erase')
  }

  const coverage = await readCoverage(report)

  if (coverage.rows === 0) {
    return fail('VALIDATION_ERROR', `Nothing is held for the ${REPORT_NAMES[report]} report`)
  }

  const size = coverage.bytes > 0 ? ` (${(coverage.bytes / 1024 / 1024).toFixed(1)} MB)` : ''
  const answer = await dialog.showMessageBox({
    type: 'warning',
    // Destructive second, and the default is Cancel: the dangerous button
    // should never be the one a stray Return key presses.
    buttons: ['Cancel', `Erase ${coverage.rows.toLocaleString()} rows`],
    defaultId: 0,
    cancelId: 0,
    title: 'Erase this backup?',
    message: `Erase the whole ${REPORT_NAMES[report]} report backup?`,
    detail:
      `${coverage.rows.toLocaleString()} row(s) across ${coverage.months.length} month(s)${size} ` +
      'will be deleted from this machine.\n\n' +
      "AJIO's reports are a live window — a month erased here may be a month that cannot be " +
      'fetched again. Export first if you might want it back. This cannot be undone.'
  })

  if (answer.response !== 1) return fail('VALIDATION_ERROR', 'Cancelled')

  const removed = await eraseReport(report)

  logger.info(`[ajio-backup] erased ${removed} row(s) of the ${REPORT_NAMES[report]} report`)

  return ok({ report, removed })
}
