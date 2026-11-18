/** Manage Claims → Export, as the renderer sees the outcome. */
export interface ClaimExportResult {
  /** Where the workbook was written. */
  path: string
  /** Claims written. */
  rows: number
  /** One sheet per platform. */
  sheets: number
  /** Ids sent that were no longer on the page when it was refetched. */
  missing: number
}
