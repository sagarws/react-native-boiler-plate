import { DEFAULT_BULK, type BulkSpec } from '../common/bulk'

/**
 * AJIO in Normal Bulk Claim: the default layout, plus the POB ID AJIO files a
 * return under. Left blank, it is taken from the return's master record when
 * the AWB matches exactly one.
 */
export const ajioBulk: BulkSpec = {
  refill: true,
  ...DEFAULT_BULK,
  columns: [
    {
      header: 'POB ID',
      path: 'pobId',
      hint: 'Optional — read from master data when the AWB has a single record.'
    }
  ]
}
