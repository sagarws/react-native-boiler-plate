import { read as readWorkbook, utils as sheetUtils } from 'xlsx'
import type { FlipkartReport } from '@shared/types/flipkartBackup'
import { loadCore } from '@main/automations/common/coreLoader'
import { storedSession } from '@main/services/sessionReuse.service'

/**
 * Asking Flipkart's Report Centre for a report, and fetching it once built.
 *
 * Every portal call is the core's (`platforms/flipkart/master-import/
 * api-based-flow/apiReportFlow`); this file is orchestration — the session,
 * and turning the downloaded workbook into rows.
 *
 * NEVER SIGNS IN. Flipkart's sign-in needs an emailed code per account, so a
 * sync that met a dead session and signed in would stop the run for an OTP.
 * The stored session is used as it is; without one the account is reported as
 * skipped, and the Login page is where it gets fixed.
 */

export interface FlipkartListRow {
  requestId: string | null
  reportName: string | null
  status: string
  createdAt: number | null
  from: string | null
  to: string | null
  sellerId: string | null
}

interface ReportFlow {
  REPORTS: Record<FlipkartReport, { reportName: string; sheet: string }>
  submitReport: (
    ctx: unknown,
    report: FlipkartReport,
    window: { from: string; to: string }
  ) => Promise<{ requestId: string; eta: string | null }>
  listReports: (ctx: unknown, options?: { pageSize?: number; pages?: number }) => Promise<FlipkartListRow[]>
  isReady: (row: FlipkartListRow) => boolean
  isFailed: (row: FlipkartListRow) => boolean
  downloadReport: (ctx: unknown, row: FlipkartListRow) => Promise<{ buffer: Buffer; filename: string }>
}

const flow = (): ReportFlow =>
  loadCore<ReportFlow>('platforms/flipkart/master-import/api-based-flow/apiReportFlow')

/** A stored session that could not stand in for a sign-in. */
export class FlipkartNoSessionError extends Error {}

/**
 * The API context (`{ jar, csrfToken, sellerId }`) rebuilt from the stored
 * session — the same context the claim flow uses. Throws when there is none.
 */
export const flipkartReportContext = async (username: string): Promise<unknown> => {
  const record = await storedSession('flipkart', username)
  const { claimContextFromSession } = loadCore<{
    claimContextFromSession: (platform: string, record: unknown) => unknown
  }>('common/claimContext')
  const context = record ? claimContextFromSession('flipkart', record) : null

  if (!context) {
    throw new FlipkartNoSessionError(
      `No usable Flipkart session for ${username} — update it on the Login page`
    )
  }

  return context
}

export const submitFlipkartReport = (
  ctx: unknown,
  report: FlipkartReport,
  window: { from: string; to: string }
): Promise<{ requestId: string; eta: string | null }> => flow().submitReport(ctx, report, window)

/** Enough pages to see `outstanding` requests, plus the account's own others. */
export const listFlipkartReports = (ctx: unknown, outstanding: number): Promise<FlipkartListRow[]> =>
  flow().listReports(ctx, { pageSize: 50, pages: Math.min(5, Math.ceil((outstanding + 10) / 50)) })

/** The Report Centre's own name for a report — what a list row's `reportName` carries. */
export const flipkartReportName = (report: FlipkartReport): string => flow().REPORTS[report].reportName

export const isFlipkartReportReady =(row: FlipkartListRow): boolean => flow().isReady(row)

export const isFlipkartReportFailed = (row: FlipkartListRow): boolean => flow().isFailed(row)

export const downloadFlipkartReport = (
  ctx: unknown,
  row: FlipkartListRow
): Promise<{ buffer: Buffer; filename: string }> => flow().downloadReport(ctx, row)

/**
 * The data sheet of a downloaded report, as rows.
 *
 * The first sheet of both files is a "Help" page of column descriptions, so the
 * data sheet is found by name ("Orders" / "Returns"), falling back to the last
 * sheet. Text cells stay text — order item ids and AWBs are long digit strings
 * a parser must not turn into floats — and date cells come out `yyyy-mm-dd`.
 */
export const parseFlipkartReport = (report: FlipkartReport, buffer: Buffer): Record<string, unknown>[] => {
  const book = readWorkbook(buffer, { type: 'buffer', cellDates: true, dateNF: 'yyyy-mm-dd' })
  const wanted = flow().REPORTS[report].sheet.toLowerCase()
  const name =
    book.SheetNames.find(sheet => sheet.trim().toLowerCase() === wanted) ?? book.SheetNames.at(-1)
  const sheet = name ? book.Sheets[name] : undefined

  if (!sheet) return []

  // THE FILE UNDERSTATES ITSELF. Flipkart's export writes a `<dimension>` of
  // `A1:AM1` — the header row alone — over a sheet holding thousands of rows,
  // and the parser trusts that tag, so every report read as zero rows while
  // the same file opened fine in Excel. The range is taken from the cells
  // actually present instead.
  const cells = Object.keys(sheet).filter(key => !key.startsWith('!'))

  if (cells.length > 0) {
    const range = { s: { r: Number.MAX_SAFE_INTEGER, c: Number.MAX_SAFE_INTEGER }, e: { r: 0, c: 0 } }

    for (const key of cells) {
      const { r, c } = sheetUtils.decode_cell(key)

      range.s.r = Math.min(range.s.r, r)
      range.s.c = Math.min(range.s.c, c)
      range.e.r = Math.max(range.e.r, r)
      range.e.c = Math.max(range.e.c, c)
    }

    sheet['!ref'] = sheetUtils.encode_range(range)
  }

  return sheetUtils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: '',
    raw: false,
    dateNF: 'yyyy-mm-dd'
  })
}
