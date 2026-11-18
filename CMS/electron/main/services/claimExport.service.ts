import { app, dialog } from 'electron'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import * as XLSX from 'xlsx'
import { exportColumns } from '@shared/constants/claimExport'
import type { CmsListQuery } from '@shared/types/cmsList'
import type { ClaimExportResult } from '@shared/types/claimExport'
import { fail, ok, type Result } from '@shared/types/result'
import { platformKey } from '@shared/utils/platformKey'
import { fetchCmsDocuments, usernameOf } from './cmsList.service'
import { logger } from './logger'

/**
 * Manage Claims → Export: the rows on screen, as an .xlsx.
 *
 * WHICH ROWS. The renderer sends the ids it is showing and the query that
 * loaded them; this refetches that page and keeps exactly those ids, in screen
 * order. The ids are needed because the screen also filters locally (the
 * Filter modal), and the query alone would export rows the operator hid.
 *
 * ONE SHEET PER PLATFORM. Columns follow each platform's Create Claim form, so
 * the All tab — Ajio beside Meesho beside Myntra — cannot share one header row
 * without a sheet full of blank columns. See `exportColumns`.
 */

/** At most 25 pages of 200 rows; anything far beyond that is not from the screen. */
const MAX_IDS = 5000

/** Pages refetched for one export — the header filters' "load next page" reach. */
const MAX_PAGES = 25

/** Excel's own limit on a sheet name, and the characters it refuses in one. */
const sheetNameOf = (label: string, taken: Set<string>): string => {
  const base = (label.replace(/[\\/?*[\]:]/g, ' ').trim() || 'Claims').slice(0, 31)
  let name = base

  for (let n = 2; taken.has(name.toLowerCase()); n += 1) {
    name = `${base.slice(0, 27)} (${n})`
  }

  taken.add(name.toLowerCase())

  return name
}

const pad = (n: number): string => String(n).padStart(2, '0')

/** "2026-10-07 14:05" in the operator's own time zone — what the grid shows. */
const formatDate = (value: string): string => {
  const date = new Date(value)

  if (Number.isNaN(date.getTime())) return value

  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}`
  )
}

/** A cell's value. Only text and numbers — an object here is a resource, and stays out. */
const cellOf = (doc: Record<string, unknown>, path: string): string | number => {
  if (path === 'account') return usernameOf(doc)

  let value: unknown = doc

  for (const key of path.split('.')) {
    value = value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined
  }

  if (typeof value === 'number') return Number.isFinite(value) ? value : ''
  if (typeof value !== 'string') return ''

  return path === 'createdAt' ? formatDate(value) : value.trim()
}

const sheetOf = (platform: string, docs: Record<string, unknown>[]): XLSX.WorkSheet => {
  const columns = exportColumns(platform)
  const rows = docs.map(doc => columns.map(column => cellOf(doc, column.path)))
  const sheet = XLSX.utils.aoa_to_sheet([columns.map(column => column.header), ...rows])

  // Wide enough for the header or the longest value, capped so one video URL
  // does not push every other column off the screen.
  sheet['!cols'] = columns.map((column, index) => ({
    wch: Math.min(
      60,
      Math.max(column.header.length, ...rows.map(row => String(row[index] ?? '').length)) + 2
    )
  }))

  return sheet
}

export const exportClaims = async (payload: unknown): Promise<Result<ClaimExportResult>> => {
  const request = (payload ?? {}) as { query?: unknown; ids?: unknown; pages?: unknown }
  const ids = Array.isArray(request.ids)
    ? request.ids.filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
    : []

  if (ids.length === 0) return fail('VALIDATION_ERROR', 'There are no claims on screen to export')
  if (ids.length > MAX_IDS) return fail('VALIDATION_ERROR', `Export at most ${MAX_IDS} claims at a time`)

  const query = (request.query && typeof request.query === 'object' ? request.query : {}) as CmsListQuery

  /*
   * WHICH PAGES. The current one, plus any later pages the header filters
   * loaded — a filtered table can show rows from all of them. Positive whole
   * numbers only, at most MAX_PAGES of them.
   */
  const asked = Array.isArray(request.pages)
    ? request.pages.filter((n): n is number => Number.isInteger(n) && n > 0)
    : []
  const pages = [...new Set(asked.length > 0 ? asked : [Math.max(1, Number(query.page) || 1)])]

  if (pages.length > MAX_PAGES) return fail('VALIDATION_ERROR', `Export at most ${MAX_PAGES} pages at a time`)

  // `_id` arrives as a string, the same one `toRow` hands the screen.
  const byId = new Map<string, Record<string, unknown>>()

  for (const page of pages) {
    const fetched = await fetchCmsDocuments({ ...query, page })

    if (!fetched.success) return fetched

    for (const doc of fetched.data) {
      if (typeof doc._id === 'string') byId.set(doc._id.trim(), doc)
    }
  }
  const docs = ids.map(id => byId.get(id)).filter((doc): doc is Record<string, unknown> => !!doc)

  if (docs.length === 0) {
    return fail('VALIDATION_ERROR', 'Those claims are no longer on this page — refresh and try again')
  }

  // Grouped by platform, in the order each platform first appears on screen.
  const groups = new Map<string, { label: string; docs: Record<string, unknown>[] }>()

  for (const doc of docs) {
    const label = typeof doc.eCommercePlatform === 'string' ? doc.eCommercePlatform.trim() : ''
    const key = platformKey(label) || 'other'
    const group = groups.get(key) ?? { label: label || 'Other', docs: [] }

    group.docs.push(doc)
    groups.set(key, group)
  }

  const today = formatDate(new Date().toISOString()).slice(0, 10)
  const scope = groups.size === 1 ? [...groups.values()][0]?.label ?? 'claims' : 'all-platforms'
  const chosen = await dialog.showSaveDialog({
    title: 'Export claims',
    defaultPath: join(
      app.getPath('downloads'),
      `claims-${scope.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${today}.xlsx`
    ),
    filters: [{ name: 'Spreadsheets', extensions: ['xlsx'] }]
  })

  // The renderer swallows this word: closing a save dialog is not a failure.
  if (chosen.canceled || !chosen.filePath) return fail('VALIDATION_ERROR', 'Cancelled')

  try {
    const book = XLSX.utils.book_new()
    const taken = new Set<string>()

    for (const [key, group] of groups) {
      XLSX.utils.book_append_sheet(book, sheetOf(key, group.docs), sheetNameOf(group.label, taken))
    }

    // A buffer and Node's own fs, as masterBackupTransfer does: SheetJS's
    // `writeFile` needs an fs handed to it once bundled.
    await writeFile(chosen.filePath, XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer)
  } catch (error) {
    return fail('INTERNAL_ERROR', error instanceof Error ? error.message : String(error))
  }

  logger.info(
    `[claim-export] wrote ${docs.length} claim(s) on ${groups.size} sheet(s) to ${chosen.filePath}`
  )

  return ok({
    path: chosen.filePath,
    rows: docs.length,
    sheets: groups.size,
    missing: ids.length - docs.length
  })
}
