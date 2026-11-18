import { app, dialog } from 'electron'
import { readFile, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import * as XLSX from 'xlsx'
import {
  BULK_REQUIRED_MARK,
  BULK_TEMPLATE_INFO_SHEETS,
  INCREFF_QC_COLUMNS,
  INCREFF_RESULT_FAILED_COLUMNS,
  INCREFF_RESULT_SUCCESS_COLUMNS,
  type BulkSheetRow,
  type BulkTemplateSpec,
  type BulkWorkbook
} from '@shared/types/bulkClaimSheet'
import { fail, ok, type Result } from '@shared/types/result'
import { logger } from './logger'

/**
 * The Normal Bulk Claim spreadsheet: writing the template, reading it back.
 *
 * DUMB ON PURPOSE. Which columns a Meesho sheet needs, and what a row means,
 * is the renderer's to decide — it holds the registry and the company's claim
 * catalogue. This file turns a description into a workbook and a workbook into
 * text, and validates both crossings, because both come from outside it.
 */

/** A report is hundreds of rows; anything near this is the wrong file. */
const MAX_ROWS = 5000
const MAX_BYTES = 15 * 1024 * 1024

const text = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : typeof value === 'number' ? String(value) : ''

/** Excel refuses `[]:*?/\` in a sheet name and anything past 31 characters. */
const sheetName = (raw: string, taken: Set<string>): string => {
  const base = raw.replace(/[[\]:*?/\\]/g, ' ').trim().slice(0, 31) || 'Sheet'
  let name = base

  for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${base.slice(0, 28)} ${n}`
  taken.add(name.toLowerCase())

  return name
}

const readSpec = (payload: unknown): BulkTemplateSpec | null => {
  const raw = (payload ?? {}) as Partial<BulkTemplateSpec>

  if (!Array.isArray(raw.sheets) || raw.sheets.length === 0) return null

  const sheets = raw.sheets
    .map(sheet => ({
      name: text(sheet?.name),
      columns: (Array.isArray(sheet?.columns) ? sheet.columns : [])
        .map(column => ({
          header: text(column?.header),
          required: column?.required === true,
          hint: text(column?.hint)
        }))
        .filter(column => column.header),
      options: (Array.isArray(sheet?.options) ? sheet.options : [])
        .map(option => ({
          header: text(option?.header),
          values: (Array.isArray(option?.values) ? option.values : []).map(text).filter(Boolean)
        }))
        .filter(option => option.header && option.values.length > 0)
    }))
    .filter(sheet => sheet.name && sheet.columns.length > 0)

  if (sheets.length === 0) return null

  return {
    fileName: text(raw.fileName).replace(/[\\/:*?"<>|]/g, '') || 'bulk-claim-template.xlsx',
    sheets,
    instructions: (Array.isArray(raw.instructions) ? raw.instructions : []).map(text)
  }
}

const buildTemplate = (spec: BulkTemplateSpec): Buffer => {
  const book = XLSX.utils.book_new()
  const taken = new Set<string>(BULK_TEMPLATE_INFO_SHEETS.map(name => name.toLowerCase()))

  // Instructions first, so it is what opens.
  const guide: string[][] = [['How to fill this workbook'], [], ...spec.instructions.map(line => [line]), []]

  for (const sheet of spec.sheets) {
    guide.push([`${sheet.name}`])
    for (const column of sheet.columns) {
      guide.push([
        `   ${column.header}${column.required ? BULK_REQUIRED_MARK : ''}`,
        column.hint ?? ''
      ])
    }
    guide.push([])
  }
  const guideSheet = XLSX.utils.aoa_to_sheet(guide)
  guideSheet['!cols'] = [{ wch: 48 }, { wch: 90 }]
  XLSX.utils.book_append_sheet(book, guideSheet, BULK_TEMPLATE_INFO_SHEETS[0])

  const optionColumns: string[][] = []

  for (const sheet of spec.sheets) {
    const headers = sheet.columns.map(c => `${c.header}${c.required ? BULK_REQUIRED_MARK : ''}`)
    const data = XLSX.utils.aoa_to_sheet([headers])
    data['!cols'] = headers.map(header => ({ wch: Math.max(16, header.length + 4) }))
    XLSX.utils.book_append_sheet(book, data, sheetName(sheet.name, taken))

    for (const option of sheet.options) {
      optionColumns.push([`${sheet.name} — ${option.header}`, ...option.values])
    }
  }

  // One column per (platform, field): the header, then every allowed value.
  const longest = optionColumns.reduce((max, column) => Math.max(max, column.length), 0)
  const valueRows: string[][] = []

  for (let row = 0; row < longest; row++) {
    valueRows.push(optionColumns.map(column => column[row] ?? ''))
  }
  const values = XLSX.utils.aoa_to_sheet(valueRows.length > 0 ? valueRows : [['No fixed values']])
  values['!cols'] = optionColumns.map(() => ({ wch: 40 }))
  XLSX.utils.book_append_sheet(book, values, BULK_TEMPLATE_INFO_SHEETS[1])

  return XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer
}

/** Writes the template where the operator chooses. */
export const downloadBulkClaimTemplate = async (
  payload: unknown
): Promise<Result<{ path: string }>> => {
  const spec = readSpec(payload)

  if (!spec) return fail('VALIDATION_ERROR', 'There are no platforms to build a template for.')

  const chosen = await dialog.showSaveDialog({
    title: 'Save the bulk claim template',
    defaultPath: join(app.getPath('downloads'), spec.fileName),
    filters: [{ name: 'Spreadsheets', extensions: ['xlsx'] }]
  })

  // Closing a save dialog is not a failure; the renderer swallows this word.
  if (chosen.canceled || !chosen.filePath) return fail('VALIDATION_ERROR', 'Cancelled')

  try {
    await writeFile(chosen.filePath, buildTemplate(spec))
    logger.info('Wrote the bulk claim template', { sheets: spec.sheets.length })

    return ok({ path: chosen.filePath })
  } catch (error) {
    return fail('INTERNAL_ERROR', error instanceof Error ? error.message : String(error))
  }
}

/**
 * A blank Increff QC report: the seven columns the backend reads, and how to
 * fill them.
 *
 * NOT `buildTemplate`. That one marks required headers with ` *`, and the
 * backend matches headers exactly — so the headers are bare here. The data
 * sheet goes first too, so it is what opens.
 * No example row either: one left in would be read as a claim.
 */
const buildIncreffTemplate = (): Buffer => {
  const book = XLSX.utils.book_new()
  const headers = INCREFF_QC_COLUMNS.map(column => column.header)
  const data = XLSX.utils.aoa_to_sheet([headers])

  data['!cols'] = headers.map(header => ({ wch: Math.max(18, header.length + 4) }))
  XLSX.utils.book_append_sheet(book, data, 'QC Report')

  const guide = XLSX.utils.aoa_to_sheet([
    ['How to fill this workbook'],
    [],
    ['Fill one row per return on the "QC Report" sheet. Leave its header row as it is.'],
    ['Every column must stay, under the same name. A row needs at least its Return Gate Entry AWB and Sales Channel.'],
    ['Type AWBs as text (start the cell with an apostrophe) so Excel does not turn them into 2.84E+13.'],
    ['A CSV with these same headers works too. At most 1000 rows are read.'],
    [],
    ['Column', 'What goes in it'],
    ...INCREFF_QC_COLUMNS.map(column => [column.header, column.hint])
  ])

  guide['!cols'] = [{ wch: 28 }, { wch: 100 }]
  XLSX.utils.book_append_sheet(book, guide, BULK_TEMPLATE_INFO_SHEETS[0])

  return XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer
}

/** Writes the blank Increff QC report where the operator chooses. */
export const downloadIncreffTemplate = async (): Promise<Result<{ path: string }>> => {
  const chosen = await dialog.showSaveDialog({
    title: 'Save the Increff QC template',
    defaultPath: join(app.getPath('downloads'), 'increff-qc-template.xlsx'),
    filters: [{ name: 'Spreadsheets', extensions: ['xlsx'] }]
  })

  // Closing a save dialog is not a failure; the renderer swallows this word.
  if (chosen.canceled || !chosen.filePath) return fail('VALIDATION_ERROR', 'Cancelled')

  try {
    await writeFile(chosen.filePath, buildIncreffTemplate())
    logger.info('Wrote the Increff QC template')

    return ok({ path: chosen.filePath })
  } catch (error) {
    return fail('INTERNAL_ERROR', error instanceof Error ? error.message : String(error))
  }
}

/** Text cells, or null when the payload is not rows of strings. Both sheets together are capped. */
const resultRows = (value: unknown, width: number): string[][] | null => {
  if (!Array.isArray(value)) return null

  const rows: string[][] = []

  for (const row of value) {
    if (!Array.isArray(row)) return null
    rows.push(Array.from({ length: width }, (_, i) => text(row[i])))
  }

  return rows
}

const resultSheet = (header: readonly string[], rows: string[][]): XLSX.WorkSheet => {
  const sheet = XLSX.utils.aoa_to_sheet([[...header], ...rows])

  // Wide enough for an AWB and a reason; Excel wraps nothing by default.
  sheet['!cols'] = header.map(name =>
    ({ wch: name === 'Reason' || name === 'Status' || name === 'VMS Matches' ? 60 : 20 })
  )

  return sheet
}

/**
 * Writes the Increff results — a Success and a Failed sheet — where the operator
 * chooses. Every cell is written as text, so an AWB stays an AWB rather than
 * becoming 4.88E+12.
 */
export const saveIncreffResults = async (payload: unknown): Promise<Result<{ path: string }>> => {
  const input = (payload ?? {}) as Record<string, unknown>
  const success = resultRows(input.success, INCREFF_RESULT_SUCCESS_COLUMNS.length)
  const failed = resultRows(input.failed, INCREFF_RESULT_FAILED_COLUMNS.length)

  if (!success || !failed) return fail('VALIDATION_ERROR', 'The results could not be read.')
  if (success.length + failed.length === 0) return fail('VALIDATION_ERROR', 'There are no rows to export.')
  if (success.length + failed.length > MAX_ROWS * 2) return fail('VALIDATION_ERROR', 'Too many rows to export.')

  // The stem comes from a file name the operator picked — kept to characters
  // every filesystem accepts.
  const stem = text(input.fileStem).replace(/[^\w.-]+/g, '-').slice(0, 80) || 'bulk-claim'
  const date = new Date().toISOString().slice(0, 10)

  const chosen = await dialog.showSaveDialog({
    title: 'Save the bulk claim results',
    defaultPath: join(app.getPath('downloads'), `${stem}-results-${date}.xlsx`),
    filters: [{ name: 'Spreadsheets', extensions: ['xlsx'] }]
  })

  if (chosen.canceled || !chosen.filePath) return fail('VALIDATION_ERROR', 'Cancelled')

  try {
    const book = XLSX.utils.book_new()

    XLSX.utils.book_append_sheet(book, resultSheet(INCREFF_RESULT_SUCCESS_COLUMNS, success), 'Success')
    XLSX.utils.book_append_sheet(book, resultSheet(INCREFF_RESULT_FAILED_COLUMNS, failed), 'Failed')
    await writeFile(chosen.filePath, XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer)
    logger.info(`Wrote the Increff results: ${success.length} success, ${failed.length} failed`)

    return ok({ path: chosen.filePath })
  } catch (error) {
    return fail('INTERNAL_ERROR', error instanceof Error ? error.message : String(error))
  }
}

const toBytes = (value: unknown): Uint8Array | null => {
  if (value instanceof Uint8Array) return value
  if (value instanceof ArrayBuffer) return new Uint8Array(value)
  if (Array.isArray(value)) return Uint8Array.from(value as number[])

  return null
}

const parseWorkbook = (bytes: Uint8Array, fileName: string): Result<BulkWorkbook> => {
  let book: XLSX.WorkBook

  try {
    book = XLSX.read(bytes, { type: 'array' })
  } catch (error) {
    return fail(
      'VALIDATION_ERROR',
      `That file could not be read — ${error instanceof Error ? error.message : String(error)}`
    )
  }

  const skip = new Set<string>(BULK_TEMPLATE_INFO_SHEETS.map(name => name.toLowerCase()))
  const sheets: BulkWorkbook['sheets'] = []
  let total = 0

  for (const name of book.SheetNames) {
    if (skip.has(name.trim().toLowerCase())) continue

    const sheet = book.Sheets[name]

    if (!sheet) continue

    const grid = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      raw: false,
      defval: '',
      blankrows: true
    })
    const headerIndex = grid.findIndex(row => Array.isArray(row) && row.some(cell => text(cell)))

    if (headerIndex < 0) continue

    const headers = (grid[headerIndex] as unknown[]).map(cell =>
      text(cell).replace(/\s*\*\s*$/, '').trim()
    )
    const rows: BulkSheetRow[] = []

    for (let index = headerIndex + 1; index < grid.length; index++) {
      const line = grid[index]

      if (!Array.isArray(line) || !line.some(cell => text(cell))) continue

      const cells: Record<string, string> = {}

      headers.forEach((header, column) => {
        if (header) cells[header] = text(line[column])
      })
      rows.push({ rowNumber: index + 1, cells })
    }

    total += rows.length
    if (total > MAX_ROWS) {
      return fail('VALIDATION_ERROR', `That workbook has more than ${MAX_ROWS} rows — split it up.`)
    }
    sheets.push({ name: name.trim(), rows })
  }

  return ok({ fileName, sheets })
}

/**
 * Reads a filled template.
 *
 * Bytes when the operator dropped a file on the modal; otherwise an open
 * dialog, so the renderer never names a path on this machine.
 */
export const readBulkClaimSheet = async (payload: unknown): Promise<Result<BulkWorkbook>> => {
  const { file } = (payload ?? {}) as { file?: { filename?: unknown; bytes?: unknown } }

  if (file) {
    const bytes = toBytes(file.bytes)

    if (!bytes || bytes.byteLength === 0) return fail('VALIDATION_ERROR', 'That file is empty.')
    if (bytes.byteLength > MAX_BYTES) return fail('VALIDATION_ERROR', 'That file is too large.')

    return parseWorkbook(bytes, text(file.filename) || 'upload.xlsx')
  }

  const chosen = await dialog.showOpenDialog({
    title: 'Choose the filled bulk claim workbook',
    properties: ['openFile'],
    filters: [{ name: 'Spreadsheets', extensions: ['xlsx', 'xls'] }]
  })
  const path = chosen.filePaths[0]

  if (chosen.canceled || !path) return fail('VALIDATION_ERROR', 'Cancelled')

  try {
    const bytes = await readFile(path)

    if (bytes.byteLength > MAX_BYTES) return fail('VALIDATION_ERROR', 'That file is too large.')

    return parseWorkbook(new Uint8Array(bytes), basename(path))
  } catch (error) {
    return fail('INTERNAL_ERROR', error instanceof Error ? error.message : String(error))
  }
}
