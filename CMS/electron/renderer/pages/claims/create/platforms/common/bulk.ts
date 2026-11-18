import { setIn } from '../../useClaimForm'
import type { ClaimValues } from './payload'

/**
 * How a platform takes part in Normal Bulk Claim.
 *
 * The single form learns a claim from an operator clicking through it: the AWB
 * fetches the video and screenshots, the platform's form places each
 * screenshot in a slot, a few platforms look the order up in master data. A
 * spreadsheet row has to arrive at the same values without anyone clicking —
 * so each platform says, in its own folder, the same three things its form
 * does: which text it needs, where its screenshots go, and what else it looks
 * up. The registry is what hands the right answer to the bulk pipeline.
 */

/** One column of a platform's sheet. */
export interface BulkColumn {
  /** The header as written in the template, and matched on the way back. */
  header: string
  /** Dotted path into the claim's values. */
  path: string
  /**
   * Required in the TEMPLATE — a hint to the operator. Whether a row can
   * actually be filed is the platform's validator's call, run on the finished
   * values, so a required field filled from master data is not a failure.
   */
  required?: boolean
  /** The only values accepted, listed on the "Valid values" sheet. */
  options?: readonly string[]
  /** Turns the cell text into what the form stores (a label into an id, say). */
  toValue?: (raw: string) => string
  /** One line for the Instructions sheet. */
  hint?: string
}

/** A row's values once its VMS screenshots are in place. */
export interface BulkPlacement {
  values: ClaimValues
  /**
   * The six-side grid, for platforms that build a PDF from it. URLs, which
   * `createPdfFromImages_old` reads as readily as files.
   */
  sideImages: string[]
}

export interface BulkSpec {
  /** Columns this platform adds to the shared ones. */
  columns: readonly BulkColumn[]
  /** Where the VMS screenshots go — the same placement the form's auto-fill makes. */
  place: (values: ClaimValues, screenshots: string[]) => BulkPlacement
  /** Lookups the form makes on an AWB besides the VMS one. Fills blanks only. */
  enrich?: (values: ClaimValues) => Promise<ClaimValues>
  /** Values the form derives from others, stamped just before validation. */
  finalize?: (values: ClaimValues) => ClaimValues
  /**
   * Refill a row that is missing its forward AWB, SKU, sub-order or account
   * before it is verified — this machine's report backup first, then the
   * marketplace (main process, `bulkRefill.service`). Without it a row that
   * carries only an AWB is checked as it stands.
   */
  refill?: boolean
}

/** The key the backend stores for a VMS screenshot is the last segment of its URL. */
export const keyOf = (url: string | undefined): string => (url ? url.split('/').pop() || '' : '')

/** A stored value as text — only the primitives a field holds, never "[object Object]". */
export const textOf = (value: unknown): string =>
  typeof value === 'string' ? value : typeof value === 'number' ? String(value) : ''

export const isBlank = (value: unknown): boolean =>
  typeof value !== 'string' || value.trim() === ''

/** Sets `path` only when it is empty — a cell the operator filled always wins. */
export const fillBlank = (values: ClaimValues, path: string, value: unknown): ClaimValues => {
  const current = path
    .split('.')
    .reduce<unknown>((node, key) => (node as Record<string, unknown> | undefined)?.[key], values)

  if (!isBlank(current) || value === undefined || value === null || value === '') return values

  return setIn(values, path, value)
}

export { setIn }

/** The default layout — AJIO, Nykaa, Shopify and every company platform. */
export const sixSidePlacement: BulkSpec['place'] = (values, screenshots) => {
  // 1st → Return Product; last → Forward Sent; middle → side slots (max nine).
  const first = screenshots[0]
  const last = screenshots.length > 1 ? screenshots[screenshots.length - 1] : ''
  const middle = screenshots.length > 2 ? screenshots.slice(1, -1).slice(0, 9) : []
  let next = values

  if (first) next = setIn(next, 'returnProductImage', keyOf(first))
  if (last) next = setIn(next, 'forwardSentProductImage', keyOf(last))

  return { values: next, sideImages: middle }
}

export const DEFAULT_BULK: BulkSpec = { columns: [], place: sixSidePlacement }
