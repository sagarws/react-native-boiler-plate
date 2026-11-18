/**
 * The Normal Bulk Claim spreadsheet, as it crosses IPC.
 *
 * The renderer knows what each platform's sheet must hold — the company's
 * platforms, their claim catalogues, the registry's per-platform fields — so it
 * DESCRIBES the template and the main process only writes it. Reading is the
 * same split the other way: the main process turns the workbook into plain
 * rows of text keyed by header, and the renderer decides what they mean.
 *
 * Neither direction carries anything the other could execute: headers, cell
 * text and row numbers only.
 */

export interface BulkSheetColumnSpec {
  /** The header as the operator sees it, without the required marker. */
  header: string
  required: boolean
  /** One line for the Instructions sheet. */
  hint?: string
}

export interface BulkSheetSpec {
  /** One sheet per platform, named after it. */
  name: string
  columns: BulkSheetColumnSpec[]
  /** Allowed values per column, written to the "Valid values" sheet. */
  options: { header: string; values: string[] }[]
}

export interface BulkTemplateSpec {
  /** Suggested file name for the save dialog. */
  fileName: string
  sheets: BulkSheetSpec[]
  /** Lines for the Instructions sheet. */
  instructions: string[]
}

export interface BulkSheetRow {
  /** The row's line number in the sheet, header included — what the operator scrolls to. */
  rowNumber: number
  /** Cell text keyed by the header, required marker stripped. */
  cells: Record<string, string>
}

export interface BulkWorkbook {
  fileName: string
  sheets: { name: string; rows: BulkSheetRow[] }[]
}

/** Sheets the template writes for the operator's benefit, never read back as claims. */
export const BULK_TEMPLATE_INFO_SHEETS = ['Instructions', 'Valid values'] as const

/** What marks a header as required in the template. Stripped on the way back in. */
export const BULK_REQUIRED_MARK = ' *'

/**
 * The Increff QC report's columns, as the Increff Bulk Claim template writes
 * them.
 *
 * A CONTRACT WITH TrackVid-BE, not a choice made here: `/cms/bulk-claim-check`
 * (BULK_CLAIM_HEADERS in its cms.controller.ts) reads the first sheet whose
 * header row carries all seven under exactly these names, lowercased, and
 * refuses the file when none does. So no ` *` marker on a header.
 * Change one here and the backend must accept it too.
 */
export const INCREFF_QC_COLUMNS: readonly { header: string; hint: string }[] = [
  { header: 'Return Order Type', hint: 'As Increff reports it, e.g. RTO or Customer Return.' },
  {
    header: 'Sales Channel',
    hint: 'The marketplace — Myntra, Ajio, Tata CliQ… Only channels enabled in Settings → Increff are read.'
  },
  { header: 'Return Gate Entry AWB', hint: 'The return AWB. Matched against VMS — a row without a recording is not filed.' },
  { header: 'QC Reason', hint: 'Why the return failed QC. Carried into the claim.' },
  { header: 'Client SKU ID / EAN', hint: 'The SKU or EAN of the returned item.' },
  { header: 'Forward AWB Number', hint: 'The AWB the order was shipped on.' },
  { header: 'Forward Unit Base Price', hint: 'The unit price, a number without the currency sign.' }
]

/** Columns of the Increff results workbook, one list per sheet — the same the modal and its PDF show. */
export const INCREFF_RESULT_SUCCESS_COLUMNS = [
  'Row #',
  'Return AWB',
  'Sales Channel',
  'QC Reason',
  'VMS Matches',
  'Status'
] as const
export const INCREFF_RESULT_FAILED_COLUMNS = [
  'Row #',
  'Return AWB',
  'Sales Channel',
  'QC Reason',
  'VMS Matches',
  'Reason'
] as const

/**
 * The Increff check/create results, as text cells in column order.
 *
 * Cells, not claim objects: the reasons are worded in the renderer (create
 * error > verify verdict > unmatched), and the workbook must say exactly what
 * the screen said.
 */
export interface IncreffResultsExport {
  /** The uploaded report's name without extension; names the saved file. */
  fileStem: string
  success: string[][]
  failed: string[][]
}
