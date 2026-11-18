import type { BulkSpfResultRow } from '@shared/types/bulkSpf'

/**
 * What a bulk claim's Retry re-files, as the operator picks it in the Retry
 * popup.
 *
 *   failed   Failed and Help Center Failed — AJIO may say yes next time —
 *            Pending, a row a crashed run never reached, and Not Claimable.
 *   skipped  Skipped: something outside AJIO stopped it — no login held its
 *            POB, the sheet had no POB, the run was switched off — and that may
 *            have been fixed since. A retry re-reads the sheet, and a row still
 *            unfileable keeps its reason.
 *   both     Either.
 *
 * EVERY ROW THAT WAS NOT FILED, whatever its reason — by the operator's call.
 * Not Claimable and `final` rows used to be left out as answers no retry could
 * change; but AJIO's verdicts do move (a return becomes claimable once its
 * window opens, a "final" skip is fixed in the sheet), and the operator, not
 * this rule, is the one who knows. Only a filed claim (Success) and a dry run
 * are never retried.
 */
export type BulkRetryScope = 'failed' | 'skipped' | 'both'

export const BULK_RETRY_SCOPES: BulkRetryScope[] = ['failed', 'skipped', 'both']

const FAILED = new Set<BulkSpfResultRow['result']>(['Failed', 'Help Center Failed', 'Pending', 'Not Claimable'])

/** One rule, read by the main process (what is re-filed) and the popup (its counts). */
export const isRetryableRow = (
  row: Pick<BulkSpfResultRow, 'result'>,
  scope: BulkRetryScope = 'both'
): boolean => {
  const failed = FAILED.has(row.result)
  const skipped = row.result === 'Skipped'

  return scope === 'failed' ? failed : scope === 'skipped' ? skipped : failed || skipped
}

export const isRetryScope = (value: unknown): value is BulkRetryScope =>
  typeof value === 'string' && (BULK_RETRY_SCOPES as string[]).includes(value)
