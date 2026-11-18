import * as XLSX from 'xlsx'
import {
  NYKAA_DDR_ISSUE,
  NYKAA_RETURN_TYPES,
  type NykaaDdrBucketCounts,
  type NykaaDdrResultRow,
  type NykaaDdrSummary,
  type NykaaReturnType
} from '@shared/types/nykaaBulkDdr'

/**
 * The Nykaa DDR bulk claim sheet: reading it, sorting its rows, and writing the
 * template and the results report.
 *
 * Pure apart from the workbook I/O at the bottom, so every rule here is
 * testable without Electron.
 *
 * Headers are matched loosely — lower-cased with everything but letters and
 * digits removed — because they come from operators' own spreadsheets, and
 * "Return AWB", "return_awb" and "AWB (DTO/RTO)" all mean the same column.
 */

/** A sheet is hundreds of rows; anything near this is the wrong file. */
export const MAX_SHEET_ROWS = 5000

/** The columns the template hands the operator, in order. */
export const TEMPLATE_COLUMNS = ['Account', 'Vendor Code', 'SKU ID', 'Return AWB', 'Return Type', 'Description']

const RESULT_COLUMNS = [
  'Sheet Row',
  'Return AWB',
  'SKU ID',
  'Vendor Code',
  'Return Type',
  'Account',
  'Result',
  'Reason',
  'Ticket Number',
  'Attempt',
  'Timestamp'
]

type Field = 'account' | 'vendorCode' | 'sku' | 'awb' | 'returnType' | 'description'

const normaliseHeader = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]/g, '')

const HEADER_ALIASES: Record<Field, string[]> = {
  account: [
    'account',
    'accountname',
    'accountusername',
    'accountemail',
    'username',
    'login',
    'loginid',
    'email',
    'nykaaaccount',
    'nykaalogin'
  ],
  vendorCode: ['vendorcode', 'vendor', 'vendorid', 'sellercode'],
  sku: ['skuid', 'sku', 'sellersku', 'skucode', 'vendorsku'],
  awb: [
    'returnawb',
    'awbdtorto',
    'awbrtodto',
    'reverseawb',
    'rtoawb',
    'dtoawb',
    'awb',
    'awbnumber',
    'awbno',
    'returnawbnumber'
  ],
  returnType: ['returntype', 'rtodto', 'dtorto'],
  description: ['description', 'remark', 'remarks', 'comment', 'comments']
}

/** Fields a sheet cannot do without. Vendor code can come from the account. */
const REQUIRED: Field[] = ['sku', 'awb', 'returnType']

const FIELD_LABEL: Record<Field, string> = {
  account: 'Account',
  vendorCode: 'Vendor Code',
  sku: 'SKU ID',
  awb: 'Return AWB',
  returnType: 'Return Type',
  description: 'Description'
}

/**
 * A cell as text. AWBs are long digit strings that Excel often stores as
 * numbers, and `String(1.23456789012e11)` is not the AWB — so integers are
 * written out in full.
 */
export const cellText = (value: unknown): string => {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return ''

    return Number.isInteger(value)
      ? value.toLocaleString('en-US', { useGrouping: false, maximumFractionDigits: 0 })
      : String(value)
  }

  if (typeof value === 'string') return value.trim()
  if (typeof value === 'boolean') return String(value)

  // Dates and anything else a cell can hold are not an AWB, SKU or code.
  return ''
}

/** One sheet row, as read. */
export interface SheetRow {
  /** 1-based, as Excel numbers it. */
  sheetRow: number
  /** The Nykaa login (username) the operator chose for the row. Empty when not given. */
  account: string
  vendorCode: string
  sku: string
  awb: string
  returnType: string
  description: string
}

export interface SheetRead {
  rows: SheetRow[]
  /** Which optional columns were found — the modal says when vendor code is absent. */
  hasVendorCode: boolean
  hasDescription: boolean
}

/**
 * Turns a sheet's rows (as arrays of cells) into `SheetRow`s.
 *
 * The header is the first of the first ten rows that names a Return AWB
 * column — an operator's export often has a title line or two above it.
 * Throws, naming the missing columns and the headers it did find, when a
 * required column is absent: that message is what tells an operator what to fix.
 */
export const parseSheetRows = (matrix: readonly unknown[][]): SheetRead => {
  const headerIndex = matrix
    .slice(0, 10)
    .findIndex(row => row.some(cell => HEADER_ALIASES.awb.includes(normaliseHeader(cellText(cell)))))

  if (headerIndex === -1) {
    const seen = (matrix[0] ?? []).map(cellText).filter(Boolean)

    throw new Error(
      `No "Return AWB" column found. The sheet needs ${REQUIRED.map(f => `"${FIELD_LABEL[f]}"`).join(', ')}` +
        (seen.length ? ` — its first row has: ${seen.join(', ')}` : '') +
        '. Download the template to see the columns.'
    )
  }

  const header = (matrix[headerIndex] ?? []).map(cell => normaliseHeader(cellText(cell)))
  const column = {} as Record<Field, number>

  for (const field of Object.keys(HEADER_ALIASES) as Field[]) {
    // Alias order is preference order: "Return AWB" beats a bare "AWB".
    column[field] = -1

    for (const alias of HEADER_ALIASES[field]) {
      const at = header.indexOf(alias)

      if (at !== -1) {
        column[field] = at
        break
      }
    }
  }

  const missing = REQUIRED.filter(field => column[field] === -1)

  if (missing.length) {
    throw new Error(
      `The sheet is missing ${missing.map(f => `"${FIELD_LABEL[f]}"`).join(', ')}. ` +
        'Download the template to see the columns.'
    )
  }

  const at = (row: readonly unknown[], field: Field): string =>
    column[field] === -1 ? '' : cellText(row[column[field]])

  const rows: SheetRow[] = []

  for (let i = headerIndex + 1; i < matrix.length; i++) {
    const row = matrix[i] ?? []

    // A blank line between blocks is not a row anyone meant.
    if (!row.some(cell => cellText(cell) !== '')) continue

    rows.push({
      sheetRow: i + 1,
      account: at(row, 'account'),
      vendorCode: at(row, 'vendorCode'),
      sku: at(row, 'sku'),
      awb: at(row, 'awb'),
      returnType: at(row, 'returnType').toUpperCase(),
      description: at(row, 'description')
    })
  }

  if (rows.length > MAX_SHEET_ROWS) {
    throw new Error(`That sheet has ${rows.length} rows — split it into files of at most ${MAX_SHEET_ROWS}.`)
  }

  return { rows, hasVendorCode: column.vendorCode !== -1, hasDescription: column.description !== -1 }
}

/** The account side of the sort: just what matching needs. */
export interface NykaaAccount {
  username: string
  vendorCode: string
}

/** A row ready to file. */
export interface DdrEntry {
  sheetRow: number
  awb: string
  sku: string
  /** From the sheet, or from the account when the sheet has none. */
  vendorCode: string
  returnType: NykaaReturnType
  description: string
}

export interface DdrGroup {
  account: string
  entries: DdrEntry[]
}

export interface DdrSkip {
  row: SheetRow
  bucket: Exclude<keyof NykaaDdrBucketCounts, 'claimable'>
  reason: string
  /** No retry can change it. */
  final: boolean
}

export interface DdrPlan {
  groups: DdrGroup[]
  skipped: DdrSkip[]
  buckets: NykaaDdrBucketCounts
}

const codeKey = (code: string): string => code.trim().toUpperCase()

const isReturnType = (value: string): value is NykaaReturnType =>
  (NYKAA_RETURN_TYPES as readonly string[]).includes(value)

/**
 * Sorts the sheet's rows into one group per Nykaa login, and the rest into
 * skips with a reason. Pure, exported for tests.
 *
 * WHICH LOGIN FILES A ROW, first rule that applies:
 *   1. the Account column — the login's username, matched case-insensitively.
 *      The operator named it, so it wins; a name no login here has is skipped,
 *      never re-routed by vendor code.
 *   2. the login whose vendor code matches the row's.
 *   3. with a single Nykaa login on this machine, that login.
 * With several logins and neither column matching, the row is skipped rather
 * than guessed onto an account: a ticket raised from the wrong vendor account
 * is not one Nykaa will act on.
 *
 * The ticket's vendor code is the row's, or the chosen login's when the row
 * has none.
 */
export const planDdrRows = (rows: readonly SheetRow[], accounts: readonly NykaaAccount[]): DdrPlan => {
  const byCode = new Map<string, NykaaAccount>()

  for (const account of accounts) {
    const key = codeKey(account.vendorCode)

    if (key && !byCode.has(key)) byCode.set(key, account)
  }

  const byName = new Map<string, NykaaAccount>()

  for (const account of accounts) {
    const key = account.username.trim().toLowerCase()

    if (key && !byName.has(key)) byName.set(key, account)
  }

  const only = accounts.length === 1 ? accounts[0] : undefined
  const groups = new Map<string, DdrGroup>()
  const skipped: DdrSkip[] = []
  const seen = new Map<string, number>()

  const skip = (row: SheetRow, bucket: DdrSkip['bucket'], reason: string, final = false): void => {
    skipped.push({ row, bucket, reason, final })
  }

  for (const row of rows) {
    if (!row.awb) {
      skip(row, 'missingAwb', 'No Return AWB in the sheet')
      continue
    }

    if (!row.sku) {
      skip(row, 'missingSku', 'No SKU ID in the sheet')
      continue
    }

    if (!isReturnType(row.returnType)) {
      skip(
        row,
        'badReturnType',
        row.returnType ? `Return Type must be RTO or DTO, not "${row.returnType}"` : 'No Return Type (RTO / DTO) in the sheet'
      )
      continue
    }

    const key = `${row.awb.toLowerCase()}::${row.sku.toLowerCase()}`
    const first = seen.get(key)

    if (first !== undefined) {
      skip(row, 'duplicate', `Same Return AWB and SKU as sheet row ${first} — filed once, under that row`, true)
      continue
    }

    seen.set(key, row.sheetRow)

    let account: NykaaAccount | undefined

    if (row.account) {
      account = byName.get(row.account.trim().toLowerCase())
    } else if (row.vendorCode) {
      account = byCode.get(codeKey(row.vendorCode)) ?? (only && !only.vendorCode ? only : undefined)
    } else {
      account = only
    }

    if (!account) {
      skip(
        row,
        'noAccount',
        accounts.length === 0
          ? 'No Nykaa login on this machine — add one on the Login page'
          : row.account
            ? `No Nykaa login "${row.account}" on this machine — check the Account column`
            : row.vendorCode
              ? `No Nykaa login on this machine has vendor code ${row.vendorCode} — name the login in the Account column`
              : 'No Account or Vendor Code in the sheet, and there are several Nykaa logins here to choose from'
      )
      continue
    }

    const vendorCode = row.vendorCode || account.vendorCode

    if (!vendorCode) {
      skip(row, 'noAccount', `No Vendor Code in the sheet, and none is recorded on the login ${account.username}`)
      continue
    }

    const group = groups.get(account.username) ?? { account: account.username, entries: [] }

    group.entries.push({
      sheetRow: row.sheetRow,
      awb: row.awb,
      sku: row.sku,
      vendorCode,
      returnType: row.returnType,
      description: row.description
    })
    groups.set(account.username, group)
  }

  const list = [...groups.values()]
  const count = (bucket: DdrSkip['bucket']): number => skipped.filter(item => item.bucket === bucket).length

  return {
    groups: list,
    skipped,
    buckets: {
      claimable: list.reduce((sum, group) => sum + group.entries.length, 0),
      missingAwb: count('missingAwb'),
      missingSku: count('missingSku'),
      badReturnType: count('badReturnType'),
      noAccount: count('noAccount'),
      duplicate: count('duplicate')
    }
  }
}

const escapeHtml = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** Plain text → the `<div>` body the portal's editor sends, line breaks kept. */
export const descriptionHtml = (value: string): string =>
  `<div>${escapeHtml(value.trim()).replace(/\r?\n/g, '<br>')}</div>`

/** What `fileNykaaClaim` reads from a config entry. */
export interface NykaaTicketEntry {
  subject: string
  issue: string
  typeOfClaim: string
  vendorCode: string
  skuId: string
  sku: string
  reverseAwb: string
  awbNumber: string
  returnType: string
  description: string
  /** Deliberately empty: a DDR claim is raised without an evidence link. */
  evidenceUrl: string
}

/**
 * One entry → the ticket the core files.
 *
 * The subject and default body are AJIO's DDR ones (`subject`, `body`), passed
 * in so they stay owned by the core's template. A Description in the sheet
 * replaces the body for that row; it is escaped, because it is operator text
 * going into an HTML ticket body.
 */
export const ticketEntry = (entry: DdrEntry, template: { subject: string; body: string }): NykaaTicketEntry => ({
  subject: template.subject,
  issue: NYKAA_DDR_ISSUE,
  typeOfClaim: NYKAA_DDR_ISSUE,
  vendorCode: entry.vendorCode,
  skuId: entry.sku,
  sku: entry.sku,
  reverseAwb: entry.awb,
  awbNumber: entry.awb,
  returnType: entry.returnType,
  description: descriptionHtml(entry.description || template.body),
  evidenceUrl: ''
})

/** Counts the rows by outcome. Pure, exported for tests. */
export const summarise = (rows: readonly NykaaDdrResultRow[]): NykaaDdrSummary => ({
  total: rows.length,
  success: rows.filter(row => row.result === 'Success').length,
  alreadyFiled: rows.filter(row => row.result === 'Already Filed').length,
  failed: rows.filter(row => row.result === 'Failed').length,
  dryRun: rows.filter(row => row.result === 'Dry Run').length,
  skipped: rows.filter(row => row.result === 'Skipped').length,
  pending: rows.filter(row => row.result === 'Pending').length
})

// -----------------------------------------------------------------------------
// Workbook I/O
// -----------------------------------------------------------------------------

/** Reads the first sheet of a workbook on disk. */
export const readSheet = (filePath: string): SheetRead => {
  const workbook = XLSX.readFile(filePath, { cellDates: false })
  const first = workbook.SheetNames[0]
  const sheet = first ? workbook.Sheets[first] : undefined

  if (!sheet) throw new Error('That file has no sheets in it')

  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '', raw: true, blankrows: false })

  return parseSheetRows(matrix)
}

export const writeTemplate = (outputPath: string): void => {
  const workbook = XLSX.utils.book_new()
  // Headers only. A sample row would be filed as a real ticket by an operator
  // who uploads the template before deleting it.
  const sheet = XLSX.utils.aoa_to_sheet([TEMPLATE_COLUMNS])

  sheet['!cols'] = TEMPLATE_COLUMNS.map(() => ({ wch: 18 }))
  XLSX.utils.book_append_sheet(workbook, sheet, 'DDR')

  const notes = XLSX.utils.aoa_to_sheet([
    ['Column', 'Required', 'Notes'],
    [
      'Account',
      'If several Nykaa logins',
      'The username of the Nykaa login that files the row. Wins over Vendor Code. Optional with one login.'
    ],
    [
      'Vendor Code',
      'If the login has none recorded',
      'Sent on the ticket. Blank = the login’s own. Also picks the login when Account is blank.'
    ],
    ['SKU ID', 'Yes', ''],
    ['Return AWB', 'Yes', 'The RTO / DTO AWB. A ticket already on Nykaa for it is reported, not filed twice.'],
    ['Return Type', 'Yes', 'RTO or DTO'],
    ['Description', 'No', 'Replaces the standard DDR message for that row.'],
    [],
    ['Every row is raised with Issue "Delivered but Not Received" and the subject "Delivery dispute Returns".']
  ])

  notes['!cols'] = [{ wch: 14 }, { wch: 24 }, { wch: 80 }]
  XLSX.utils.book_append_sheet(workbook, notes, 'How to fill')
  XLSX.writeFile(workbook, outputPath)
}

export const writeResults = (outputPath: string, rows: readonly NykaaDdrResultRow[]): void => {
  const workbook = XLSX.utils.book_new()
  const sheet = XLSX.utils.aoa_to_sheet([
    RESULT_COLUMNS,
    ...rows.map(row => [
      row.sheetRow,
      row.awb,
      row.sku,
      row.vendorCode,
      row.returnType,
      row.account,
      row.result,
      row.reason,
      row.ticketNumber,
      row.attempt,
      row.timestamp
    ])
  ])

  sheet['!cols'] = RESULT_COLUMNS.map(name => ({ wch: name === 'Reason' ? 60 : 18 }))
  XLSX.utils.book_append_sheet(workbook, sheet, 'Results')
  XLSX.writeFile(workbook, outputPath)
}
