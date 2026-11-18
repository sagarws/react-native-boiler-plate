import { app, dialog } from 'electron'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import JSZip from 'jszip'
import * as XLSX from 'xlsx'
import type { BackupArchiveExport } from '@shared/types/backupArchive'
import { fail, ok, type Result } from '@shared/types/result'
import { isRetainedMonth } from '@shared/utils/backupRetention'

/**
 * A local backup, off this machine and back on — for the backups whose rows
 * are flat (Snapdeal, Flipkart).
 *
 * The same idea as the AJIO export (masterBackupTransfer), which is the only
 * durable copy of a report the marketplace stops serving: one zip in
 * Downloads, laid out like the data, a spreadsheet per month and a manifest.
 *
 *   2026/09.xlsx      every row whose date falls in September 2026
 *   manifest.json     which platform, which report, when, how many rows
 *
 * A month per file rather than AJIO's page per file: these rows did not arrive
 * in pages, they arrived in report windows, and a month is how the coverage
 * calendar reads them.
 *
 * PLATFORM-NEUTRAL. It knows rows, dates and a filename stem; what a row means
 * and how it is merged back is the caller's.
 */

interface Manifest {
  platform: string
  report: string
  exportedAt: string
  rows: number
  months: { year: number; month: number; rows: number }[]
  app: string
}

const MONTH_PATH = /^(\d{4})\/(\d{2})\.xlsx$/

const stamp = (): string => new Date().toISOString().slice(0, 10)

/** `yyyy-MM-dd…` → year and month, or null for a row with no usable date. */
const monthOf = (date: string): { year: number; month: number } | null => {
  const match = /^(\d{4})-(\d{2})/.exec(date)

  if (!match) return null

  const year = Number(match[1])
  const month = Number(match[2])

  return month >= 1 && month <= 12 ? { year, month } : null
}

/**
 * Every row given, as a zip in the Downloads folder.
 *
 * Every field is written as TEXT, and read back as text: AWBs, sub-orders and
 * SKUs are long digit strings, and a spreadsheet allowed to guess turns them
 * into `8.90798e+12`.
 */
export const writeBackupZip = async <R extends object>(input: {
  platform: string
  /** What the operator calls it — "Snapdeal returns". */
  label: string
  report: string
  rows: R[]
  dateOf: (row: R) => string
}): Promise<Result<BackupArchiveExport>> => {
  if (input.rows.length === 0) return fail('VALIDATION_ERROR', `Nothing is backed up for ${input.label} yet`)

  const byMonth = new Map<string, R[]>()

  for (const row of input.rows) {
    const at = monthOf(input.dateOf(row))
    const key = at ? `${at.year}/${String(at.month).padStart(2, '0')}` : 'undated'
    const bucket = byMonth.get(key) ?? []

    bucket.push(row)
    byMonth.set(key, bucket)
  }

  const zip = new JSZip()
  const manifest: Manifest = {
    platform: input.platform,
    report: input.report,
    exportedAt: new Date().toISOString(),
    rows: 0,
    months: [],
    app: `TrackVid CMS ${app.getVersion()}`
  }

  for (const [key, rows] of [...byMonth.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const sheet = XLSX.utils.json_to_sheet(
      rows.map(row =>
        Object.fromEntries(
          Object.entries(row).map(([field, value]) => [field, value === null || value === undefined ? '' : String(value)])
        )
      )
    )
    const book = XLSX.utils.book_new()

    XLSX.utils.book_append_sheet(book, sheet, 'Rows')
    zip.file(`${key}.xlsx`, XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer)

    manifest.rows += rows.length

    const at = MONTH_PATH.exec(`${key}.xlsx`)

    if (at) manifest.months.push({ year: Number(at[1]), month: Number(at[2]), rows: rows.length })
  }

  zip.file('manifest.json', JSON.stringify(manifest, null, 2))

  const path = join(app.getPath('downloads'), `${input.platform}-${input.report}-backup-${stamp()}.zip`)
  const bytes = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })

  await writeFile(path, bytes)

  return ok({
    path,
    files: byMonth.size,
    rows: manifest.rows,
    months: manifest.months.length,
    bytes: bytes.byteLength
  })
}

/** One month's sheet, read back as text rows. */
export interface ArchivedMonth {
  name: string
  year: number
  month: number
  rows: Record<string, string>[]
}

/**
 * A zip chosen by the operator, read into months.
 *
 * Refuses a zip whose manifest names another platform or report — importing
 * Snapdeal returns into Flipkart orders would merge rows nothing can read.
 * Months before the retention window are dropped here: the next prune would
 * only delete them again.
 */
export const readBackupZip = async (input: {
  platform: string
  label: string
  report: string
}): Promise<Result<{ path: string; months: ArchivedMonth[]; unreadable: string[] }>> => {
  const chosen = await dialog.showOpenDialog({
    title: `Import a ${input.label} backup`,
    properties: ['openFile'],
    filters: [{ name: 'Backup archive', extensions: ['zip'] }],
    defaultPath: app.getPath('downloads')
  })

  if (chosen.canceled || !chosen.filePaths[0]) return fail('VALIDATION_ERROR', 'Cancelled')

  const path = chosen.filePaths[0]
  let zip: JSZip

  try {
    zip = await JSZip.loadAsync(await readFile(path))
  } catch (error) {
    return fail(
      'VALIDATION_ERROR',
      `That file could not be opened as a zip — ${error instanceof Error ? error.message : String(error)}`
    )
  }

  const manifestFile = zip.file('manifest.json')

  if (manifestFile) {
    try {
      const manifest = JSON.parse(await manifestFile.async('string')) as Partial<Manifest>

      if (manifest.platform && manifest.platform !== input.platform) {
        return fail('VALIDATION_ERROR', `That zip is a ${manifest.platform} backup, not ${input.platform}`)
      }
      if (manifest.report && manifest.report !== input.report) {
        return fail(
          'VALIDATION_ERROR',
          `That zip holds the ${manifest.report} report — choose that report on the card, then import`
        )
      }
    } catch {
      // A manifest that will not parse is not worth refusing the import over:
      // every file still names its own month.
    }
  }

  const months: ArchivedMonth[] = []
  const unreadable: string[] = []

  for (const [name, file] of Object.entries(zip.files)) {
    if (file.dir) continue

    const at = MONTH_PATH.exec(name)

    if (!at) continue

    const year = Number(at[1])
    const month = Number(at[2])

    if (!isRetainedMonth(year, month)) continue

    try {
      const book = XLSX.read(await file.async('nodebuffer'), { type: 'buffer' })
      const first = book.SheetNames[0]
      const sheet = first ? book.Sheets[first] : undefined

      if (!sheet) continue

      months.push({
        name,
        year,
        month,
        rows: XLSX.utils.sheet_to_json<Record<string, string>>(sheet, { defval: '', raw: false })
      })
    } catch {
      // One unreadable month must not lose the others; it is counted.
      unreadable.push(name)
    }
  }

  return ok({ path, months, unreadable })
}
