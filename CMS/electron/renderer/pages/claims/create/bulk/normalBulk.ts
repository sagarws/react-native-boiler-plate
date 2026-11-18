import type { ECommercePlatformRecord } from '@shared/types/cmsCreate'
import type { BulkRefillResult, BulkRefillRow } from '@shared/types/bulkRefill'
import type {
  BulkSheetRow,
  BulkTemplateSpec,
  BulkWorkbook
} from '@shared/types/bulkClaimSheet'
import {
  createCMS,
  getOrderByAwb,
  getOrderScreenshots,
  uploadCmsImage,
  type OrderLookupItem,
  type OrderLookupRecord
} from '../api'
import { blankClaim } from '../blankClaim'
import { matchClaimTypeOption, selectableClaimTypes } from '../claimTypes'
import { createPdfFromImages_old } from '../imageToPdf'
import { placeholderSixSidePdf } from '../platforms/common/placeholderSixSidePdf'
import { PLATFORMS, platformDescriptor, type PlatformDescriptor } from '../platforms/registry'
import { fillBlank, isBlank, setIn, textOf, type BulkColumn } from '../platforms/common/bulk'
import { bareAwb, buildCreateFields } from '../platforms/common/createFields'
import type { ClaimValues } from '../platforms/common/payload'
import { getIn } from '../useClaimForm'

/**
 * Normal Bulk Claim: a spreadsheet of claims, filed as if each row had been
 * typed into the form.
 *
 * Each row goes through what the form does on an AWB — the VMS video and
 * screenshots, the master record, the platform's own lookups — then the
 * platform's own validator, then the same `/cms/createCMS` call with the same
 * field whitelist. Nothing here branches on a platform name: every difference
 * is the registry's `bulk` entry.
 *
 * Phases, and the operator decides at the last one: REFILL fills the blanks on
 * rows that carry little more than an AWB (platforms whose bulk spec opts in),
 * PREPARE reads and checks every row without filing anything, the operator
 * EDITS what is still wrong, and CREATE files the rows that passed.
 */

/** One company platform's sheet: who it files under, and its columns. */
export interface PlatformSheet {
  /** The sheet's name, and the platform's name as the operator knows it. */
  label: string
  record: ECommercePlatformRecord
  descriptor: PlatformDescriptor
  columns: BulkColumn[]
}

export type BulkRowStatus =
  | 'pending'
  | 'refilling'
  | 'preparing'
  | 'ready'
  | 'invalid'
  | 'creating'
  | 'created'
  | 'failed'

export interface BulkRow {
  id: string
  sheet: string
  rowNumber: number
  platformLabel: string
  awb: string
  claimType: string
  status: BulkRowStatus
  /** Why the row cannot be filed, or why filing failed. */
  errors: string[]
  /** What was found in VMS, for the results table. */
  videoFound: boolean
  screenshots: number
  cmsId?: string
  /** Set once prepared — the claim exactly as it will be filed. */
  values?: ClaimValues
  sideImages?: string[]
  cells: Record<string, string>
  /**
   * Refilled values with no column on this platform's sheet, by claim path —
   * Flipkart's order item id, kept in `subOrderNumber`. Refilled values that DO
   * have a column are written into `cells`, where the operator can see and
   * edit them.
   */
  refilled?: Record<string, string>
  /** What refill did for this row; absent when it was not refilled. */
  refill?: { source: BulkRefillResult['source']; filled: string[]; message: string | null }
  /** The platform sheet the row came from. */
  platform: PlatformSheet
}

const lower = (value: string): string => value.trim().toLowerCase()

/** The company's platforms, each with the columns its sheet carries. */
export const platformSheets = (
  platforms: ECommercePlatformRecord[],
  accountsOf: (platform: string) => string[],
  catalogue: { delhiveryDomestics: Record<string, string[]> } = { delhiveryDomestics: {} }
): PlatformSheet[] => {
  const known = new Map(PLATFORMS.map((entry) => [lower(entry.label), entry]))

  return platforms
    .filter((record) => record?.name)
    .map((record) => {
      const descriptor = platformDescriptor(record.name)
      const label = known.get(lower(record.name))?.label ?? record.name
      const claimTypes = selectableClaimTypes(record)
      const parents = Array.from(
        new Set(claimTypes.map((c) => c.parentSelection?.trim() || '').filter(Boolean))
      )
      const accounts = accountsOf(record.name)
      const columns: BulkColumn[] = [
        { header: 'Return AWB', path: 'AWBNumber', required: true }
      ]

      if (parents.length > 0) {
        columns.push({
          header: descriptor.cascade.parentLabel,
          path: 'otherClaimDetails.parentSelection',
          options: parents,
          hint: 'Optional when the claim type below belongs to only one of these.'
        })
      }
      columns.push({
        header: descriptor.cascade.childLabel,
        path: 'typeOfClaim',
        required: true,
        options: claimTypes.map((c) => c.name),
        hint: 'One of the claim types listed on the Valid values sheet.'
      })
      for (const field of descriptor.headerFields) {
        if (field.fixedValue !== undefined || !field.options) continue
        // A per-account list (Delhivery's Domestic) has no one account on a
        // sheet, so every account's values are valid, beside the static ones.
        const perAccount = field.optionsForAccount
          ? accounts.flatMap((account) => field.optionsForAccount?.(catalogue, account) ?? [])
          : []
        const options = [...new Set([...perAccount, ...field.options])]

        columns.push({ header: field.label, path: field.path, required: true, options })
      }
      if (descriptor.accountPath) {
        columns.push({
          header: 'Seller Account',
          path: descriptor.accountPath,
          options: accounts,
          hint:
            accounts.length === 1
              ? 'Optional — the company has one account, and it is used.'
              : 'The seller account to file under.'
        })
      }
      columns.push(
        {
          header: 'Forward AWB',
          path: 'forwardAWB',
          hint: 'Optional — read from master data when blank.'
        },
        { header: 'Customer Order Number', path: 'customerOrderNumber' },
        {
          header: 'SKU',
          path: 'skuName',
          hint: 'Needed only when the return holds more than one SKU.'
        },
        {
          header: 'Remark',
          path: 'remark',
          hint: "Optional — the claim type's own description when blank."
        },
        ...descriptor.bulk.columns
      )

      // A header can appear once; the first definition wins.
      const seen = new Set<string>()
      const unique = columns.filter((column) => {
        const key = lower(column.header)

        if (seen.has(key)) return false
        seen.add(key)

        return true
      })

      return { label, record, descriptor, columns: unique }
    })
}

/** What the main process needs to write the template. */
export const templateSpec = (sheets: PlatformSheet[]): BulkTemplateSpec => ({
  fileName: 'bulk-claim-template.xlsx',
  instructions: [
    'Fill one row per claim on the sheet named after its platform. Leave the header row as it is.',
    'Columns marked * are required. Fixed values for a column are on the "Valid values" sheet.',
    'The return video and every image are taken from VMS by Return AWB — a row whose AWB has no',
    'recording, or too few screenshots for its platform, is listed as failed and not filed.',
    'Rows you leave empty are ignored; sheets you do not use can stay empty.'
  ],
  sheets: sheets.map((sheet) => ({
    name: sheet.label,
    columns: sheet.columns.map((column) => ({
      header: column.header,
      required: column.required === true,
      ...(column.hint ? { hint: column.hint } : {})
    })),
    options: sheet.columns
      .filter((column) => column.options && column.options.length > 0)
      .map((column) => ({ header: column.header, values: [...(column.options ?? [])] }))
  }))
})

/** Turns the read workbook into rows waiting to be prepared. */
export const rowsFromWorkbook = (
  workbook: BulkWorkbook,
  sheets: PlatformSheet[]
): { rows: BulkRow[]; unknownSheets: string[] } => {
  const byName = new Map<string, PlatformSheet>()

  for (const sheet of sheets) {
    byName.set(lower(sheet.label), sheet)
    byName.set(lower(sheet.record.name), sheet)
  }

  const rows: BulkRow[] = []
  const unknownSheets: string[] = []

  for (const sheet of workbook.sheets) {
    if (sheet.rows.length === 0) continue

    const platform = byName.get(lower(sheet.name))

    if (!platform) {
      unknownSheets.push(sheet.name)
      continue
    }

    for (const row of sheet.rows) rows.push(pendingRow(platform, sheet.name, row))
  }

  return { rows, unknownSheets }
}

const cellOf = (cells: Record<string, string>, header: string): string => {
  const wanted = lower(header)

  for (const [key, value] of Object.entries(cells)) {
    if (lower(key) === wanted) return value.trim()
  }

  return ''
}

/* -------------------------------------------------------------------------- *
 * Refill
 * -------------------------------------------------------------------------- */

/** The claim paths refill answers, and the name each is shown under. */
const REFILL_PATHS: { key: keyof Omit<BulkRefillRow, 'id' | 'awb'>; path: (row: BulkRow) => string | null; label: string }[] = [
  { key: 'forwardAWB', path: () => 'forwardAWB', label: 'forward AWB' },
  { key: 'sku', path: () => 'skuName', label: 'SKU' },
  { key: 'subOrderNumber', path: () => 'subOrderNumber', label: 'sub-order' },
  { key: 'pobId', path: () => 'pobId', label: 'POB' },
  { key: 'account', path: (row) => row.platform.descriptor.accountPath ?? null, label: 'account' }
]

/** A row's current value for a claim path: its cell when the sheet has a column, else what refill kept. */
const valueAt = (row: BulkRow, path: string): string => {
  const column = row.platform.columns.find((entry) => entry.path === path)

  return (column ? cellOf(row.cells, column.header) : '') || row.refilled?.[path] || ''
}

/**
 * Does this row go through refill first?
 *
 * Only on a platform whose bulk spec opts in, only with an AWB to search by,
 * and only when a COLUMN refill could answer is blank — a fully filled row
 * costs nothing. A value with no column on the sheet (Flipkart's order item
 * id) is taken when the row is refilled anyway, but is not a reason to ask:
 * otherwise every row of that platform would be refilled forever.
 */
export const needsRefill = (row: BulkRow): boolean =>
  row.status === 'pending' &&
  row.platform.descriptor.bulk.refill === true &&
  !!row.awb &&
  REFILL_PATHS.some((entry) => {
    const path = entry.path(row)

    return (
      path !== null &&
      row.platform.columns.some((column) => column.path === path) &&
      !valueAt(row, path)
    )
  })

/** The row as the refill IPC takes it. */
export const refillRequestRow = (row: BulkRow): BulkRefillRow => {
  const at = (key: (typeof REFILL_PATHS)[number]['key']): string => {
    const path = REFILL_PATHS.find((entry) => entry.key === key)?.path(row)

    return path ? valueAt(row, path) : ''
  }

  return {
    id: row.id,
    awb: row.awb,
    account: at('account'),
    forwardAWB: at('forwardAWB'),
    subOrderNumber: at('subOrderNumber'),
    sku: at('sku'),
    pobId: at('pobId')
  }
}

/**
 * Writes refill's answers into the row — blanks only, into the cell when the
 * sheet has a column for it (so the table and the edit dialog show it), and
 * into `refilled` when it does not.
 */
export const applyRefill = (row: BulkRow, result: BulkRefillResult | undefined): BulkRow => {
  if (!result) return { ...row, status: 'pending' }

  const cells = { ...row.cells }
  const refilled = { ...(row.refilled ?? {}) }
  const filled: string[] = []

  for (const entry of REFILL_PATHS) {
    const value = result.values[entry.key]
    const path = entry.path(row)

    if (!value || !path || valueAt(row, path)) continue

    const column = row.platform.columns.find((candidate) => candidate.path === path)

    if (column) cells[column.header] = value
    else refilled[path] = value
    filled.push(entry.label)
  }

  return {
    ...row,
    status: 'pending',
    cells,
    refilled,
    refill: { source: result.source, filled, message: result.message }
  }
}

/** The row with the operator's edits, back to be checked again. */
export const editRow = (row: BulkRow, cells: Record<string, string>): BulkRow => ({
  ...row,
  cells,
  awb: bareAwb(cellOf(cells, 'Return AWB')).trim(),
  claimType: cellOf(cells, row.platform.descriptor.cascade.childLabel),
  status: 'pending',
  errors: []
})

/** The editable cells of a row: every column of its sheet, with what it holds now. */
export const editableCells = (row: BulkRow): { column: BulkColumn; value: string }[] =>
  row.platform.columns.map((column) => ({
    column,
    value: cellOf(row.cells, column.header) || row.refilled?.[column.path] || ''
  }))

const pendingRow = (platform: PlatformSheet, sheet: string, row: BulkSheetRow): BulkRow => {
  const result: BulkRow = {
    id: `${sheet}:${row.rowNumber}`,
    sheet,
    rowNumber: row.rowNumber,
    platformLabel: platform.label,
    awb: bareAwb(cellOf(row.cells, 'Return AWB')).trim(),
    claimType: cellOf(row.cells, platform.descriptor.cascade.childLabel),
    status: 'pending',
    errors: [],
    videoFound: false,
    screenshots: 0,
    cells: row.cells,
    platform
  }

  return result
}

/** Every message in a validator's nested error tree. */
const messagesOf = (errors: unknown): string[] => {
  if (typeof errors === 'string') return [errors.replace(/^\*/, '')]
  if (!errors || typeof errors !== 'object') return []

  return Object.values(errors as Record<string, unknown>).flatMap(messagesOf)
}

const errorText = (error: unknown): string =>
  (error as { response?: { data?: { displayMessage?: string } } })?.response?.data
    ?.displayMessage ||
  (error instanceof Error ? error.message : String(error))

/** Rows sharing a platform, Return AWB and claim type — only the first is kept. */
export const markDuplicates = (rows: BulkRow[]): BulkRow[] => {
  const first = new Map<string, BulkRow>()

  return rows.map((row) => {
    if (!row.awb) return row

    const key = `${lower(row.platformLabel)}|${lower(row.awb)}|${lower(row.claimType)}|${lower(
      cellOf(row.cells, 'SKU')
    )}`
    const earlier = first.get(key)

    if (!earlier) {
      first.set(key, row)

      return row
    }

    return {
      ...row,
      status: 'invalid',
      errors: [`Same claim as ${earlier.sheet} row ${earlier.rowNumber}`]
    }
  })
}

/**
 * Reads, looks up and checks one row. Files nothing.
 *
 * `accountsOf` answers the company's seller accounts for a platform — the same
 * list the form's account dropdown offers.
 */
export const prepareRow = async (
  row: BulkRow,
  accountsOf: (platform: string) => string[]
): Promise<BulkRow> => {
  const platform = row.platform
  const { descriptor, record } = platform
  const errors: string[] = []
  let values = blankClaim() as ClaimValues

  values = setIn(values, 'eCommercePlatform', record._id)

  // ── The cells ────────────────────────────────────────────────────────────
  for (const column of platform.columns) {
    if (column.path === 'typeOfClaim') continue

    const raw = cellOf(row.cells, column.header)

    if (!raw) continue

    let value = raw

    if (column.options && column.options.length > 0) {
      const match = column.options.find((option) => lower(option) === lower(raw))

      if (!match) {
        errors.push(`${column.header}: "${raw}" is not one of the valid values`)
        continue
      }
      value = match
    }

    values = setIn(values, column.path, column.toValue ? column.toValue(value) : value)
  }

  values = setIn(values, 'AWBNumber', row.awb)

  // Refilled values with no column on this sheet — blanks only.
  for (const [path, value] of Object.entries(row.refilled ?? {})) {
    values = fillBlank(values, path, value)
  }

  for (const field of descriptor.headerFields) {
    if (field.fixedValue !== undefined) values = setIn(values, field.path, field.fixedValue)
  }

  // ── The claim type, matched against this platform's catalogue ────────────
  const claimTypes = selectableClaimTypes(record)
  const parent = textOf(getIn(values, 'otherClaimDetails.parentSelection'))
  const candidates = parent
    ? claimTypes.filter((c) => (c.parentSelection || '') === parent)
    : claimTypes

  if (!row.claimType) {
    errors.push(`${descriptor.cascade.childLabel} is required`)
  } else {
    const matches = candidates.filter((c) => matchClaimTypeOption([c], row.claimType))
    const chosen = matches[0]

    if (!chosen) {
      errors.push(
        `${descriptor.cascade.childLabel}: "${row.claimType}" is not one of this platform's claim types` +
          (parent ? ` under "${parent}"` : '')
      )
    } else if (!parent && new Set(matches.map((c) => c.parentSelection || '')).size > 1) {
      errors.push(
        `"${row.claimType}" appears under several ${descriptor.cascade.parentLabel} values — fill that column`
      )
    } else {
      values = setIn(values, 'typeOfClaim', chosen.key || chosen.name)
      values = setIn(values, 'typeOfClaimName', chosen.name)
      values = fillBlank(values, 'remark', chosen.description)
      if (chosen.parentSelection) {
        values = fillBlank(values, 'otherClaimDetails.parentSelection', chosen.parentSelection)
      }
    }
  }

  // ── The seller account ───────────────────────────────────────────────────
  if (descriptor.accountPath) {
    const accounts = accountsOf(record.name)
    const named = textOf(getIn(values, descriptor.accountPath)).trim()

    if (!named && descriptor.autoSelectSoleAccount && accounts.length === 1) {
      values = setIn(values, descriptor.accountPath, accounts[0])
    }
  }

  if (!row.awb) {
    return { ...row, status: 'invalid', errors: ['Return AWB is required', ...errors] }
  }

  // ── What the form fetches on an AWB ──────────────────────────────────────
  try {
    const response = await getOrderByAwb(row.awb, 'Return')
    const item = (response.data?.data?.[0] ?? {}) as OrderLookupItem
    const records = (response.data?.records ?? []) as OrderLookupRecord[]
    const skus = Array.from(
      new Set([...(response.data?.skus ?? []), ...records.map((r) => r.sku)].filter(Boolean))
    )

    values = fillBlank(values, 'returnVideoLink', item.return_video_link)
    values = fillBlank(values, 'forwardAWB', item.forward_awb)
    values = fillBlank(values, 'customerOrderNumber', item.customerOrderNumber)

    if (skus.length === 1) values = fillBlank(values, 'skuName', skus[0])
    else if (skus.length > 1 && isBlank(values.skuName)) {
      errors.push(`This return holds several SKUs (${skus.join(', ')}) — fill the SKU column`)
    }

    const sku = String(values.skuName ?? '')
    const record = records.length === 1 ? records[0] : records.find((r) => r.sku === sku)

    if (record?.pobId) values = fillBlank(values, 'pobId', record.pobId)
  } catch {
    // No master record is normal; the video check below reports what matters.
  }

  if (!isBlank(values.forwardAWB)) {
    values = setIn(values, 'forwardAWB', bareAwb(String(values.forwardAWB)).trim())
    try {
      const response = await getOrderByAwb(String(values.forwardAWB), 'Forward')
      const item = (response.data?.data?.[0] ?? {}) as OrderLookupItem

      values = fillBlank(values, 'forwardVideoLink', item.forward_video_link)
    } catch {
      // A forward recording is optional.
    }
  }

  if (descriptor.bulk.enrich) values = await descriptor.bulk.enrich(values)

  const videoFound = !isBlank(values.returnVideoLink)

  let screenshots: string[] = []

  try {
    const response = await getOrderScreenshots(row.awb, 'Return')

    screenshots = (response.data?.data ?? []).filter(
      (url): url is string => typeof url === 'string' && url.length > 0
    )
  } catch {
    // None recorded — the validator names the slots left empty.
  }

  const placed = descriptor.bulk.place(values, screenshots)

  values = placed.values
  if (descriptor.bulk.finalize) values = descriptor.bulk.finalize(values)

  // ── The platform's own rules, as the form runs them on Save ──────────────
  for (const message of messagesOf(descriptor.validate([])(values))) {
    if (!errors.includes(message)) errors.push(message)
  }

  if (
    descriptor.requiresSixSidePdf &&
    !descriptor.sixSidePlaceholderPdf &&
    placed.sideImages.length < 3
  ) {
    errors.push(
      `Needs at least three product side images from VMS; found ${placed.sideImages.length}`
    )
  }

  return {
    ...row,
    status: errors.length > 0 ? 'invalid' : 'ready',
    errors,
    videoFound,
    screenshots: screenshots.length,
    values,
    sideImages: placed.sideImages
  }
}

/** Files one prepared row through `/cms/createCMS`, as the form's Save does. */
export const createRow = async (row: BulkRow, feedId: string): Promise<BulkRow> => {
  const { descriptor } = row.platform

  if (!row.values) return { ...row, status: 'failed', errors: ['Row was not prepared'] }

  try {
    const form = new FormData()

    if (descriptor.requiresSixSidePdf) {
      const pdf = descriptor.sixSidePlaceholderPdf
        ? placeholderSixSidePdf()
        : await createPdfFromImages_old(row.sideImages ?? [])
      const upload = new FormData()

      upload.append('file', pdf)
      upload.append('feedId', feedId || '')

      const key = (await uploadCmsImage(upload))?.data?.data?.key

      if (!key) throw new Error('Six-side images upload failed')
      form.append('sixSideImages', key)
    }

    if (feedId) form.append('feedId', feedId)
    for (const [key, value] of buildCreateFields(row.values, descriptor)) form.append(key, value)

    const response = await createCMS(form)
    const data = response.data?.data as { _id?: string } | undefined

    return {
      ...row,
      status: 'created',
      errors: [],
      ...(data?._id ? { cmsId: data._id } : {})
    }
  } catch (error) {
    return { ...row, status: 'failed', errors: [errorText(error)] }
  }
}

/**
 * Runs `task` over `items`, `limit` at a time, reporting each result as it
 * lands. Stops starting new items once `cancelled()` answers true.
 */
export const runPool = async <T,>(
  items: T[],
  limit: number,
  task: (item: T) => Promise<T>,
  onResult: (result: T, index: number) => void,
  cancelled: () => boolean
): Promise<void> => {
  let next = 0

  const worker = async (): Promise<void> => {
    while (next < items.length && !cancelled()) {
      const index = next++
      const result = await task(items[index] as T)

      if (cancelled()) return
      onResult(result, index)
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()))
}
