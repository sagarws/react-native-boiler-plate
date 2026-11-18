/**
 * What to do with the sub-order number a mapping run just read off the
 * marketplace, given what the claim already holds.
 *
 * Meesho's claim form is filled BY the sub-order number and its ticket found
 * again by searching for it, so a row carrying the wrong one cannot be filed —
 * and the failure names neither field. The commonest way to hold the wrong one
 * is to hold the ORDER number: Meesho's returns row answers with both, and they
 * differ only by the `_1` suffix (`3216302445191832960` vs `…_1`).
 *
 * Pure, and in `shared`, because the rule decides whether data gets overwritten
 * and that deserves to be testable without a marketplace.
 */

export type SubOrderDecision =
  /** The row has none — write it, whatever the mode. */
  | 'fill'
  /** The row already says the same thing. Nothing to do. */
  | 'same'
  /** They disagree: replace it (auto-mapping on) or ask (off). */
  | 'conflict'
  /** The marketplace did not answer with one — nothing to write. */
  | 'none'

export const subOrderDecision = (existing: string, fetched: string | null): SubOrderDecision => {
  const had = (existing ?? '').trim()
  const got = (fetched ?? '').trim()

  if (!got) return 'none'
  if (!had) return 'fill'

  return had === got ? 'same' : 'conflict'
}

/**
 * Is the stored value the ORDER number of the sub-order the marketplace
 * returned? Not a rule the code acts on — the operator is still asked — but it
 * is the sentence that makes the choice obvious when they are.
 */
export const isOrderNumberOf = (existing: string, fetched: string): boolean => {
  const had = (existing ?? '').trim()
  const got = (fetched ?? '').trim()

  return had.length > 0 && got.startsWith(`${had}_`)
}
