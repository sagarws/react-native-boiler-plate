import type { BulkSpfPlanRow } from '@shared/types/bulkSpf'

/**
 * Picking rows of the Selected Proceed review by their number in the # column.
 *
 * Numbers are 1-based positions in the plan as shown. Claimable rows come first
 * in a plan, so a range over the top of the table is a range of fileable claims;
 * any skipped rows a range reaches are never ticked.
 */

/** A positive whole number typed into a box, or null. */
export const whole = (value: string): number | null => {
  const n = Number(value.trim())

  return Number.isInteger(n) && n > 0 ? n : null
}

/**
 * The keys of the claimable rows numbered `from`…`to` (1-based, inclusive, the
 * numbers shown in the # column). Out-of-range ends are clamped; a reversed range
 * is read the right way round.
 */
export const keysInRange = (rows: readonly BulkSpfPlanRow[], from: number, to: number): string[] => {
  const low = Math.max(1, Math.min(from, to))
  const high = Math.min(rows.length, Math.max(from, to))

  return rows.slice(low - 1, high).filter(row => row.claimable).map(row => row.key)
}

/** The keys of the last `count` claimable rows. */
export const lastClaimableKeys = (rows: readonly BulkSpfPlanRow[], count: number): string[] => {
  const claimable = rows.filter(row => row.claimable)

  return claimable.slice(Math.max(0, claimable.length - count)).map(row => row.key)
}
