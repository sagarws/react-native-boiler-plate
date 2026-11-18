/**
 * The report table's own rules — paging and searching.
 *
 * Both are decisions about presentation, but neither is trivial enough to leave
 * inline and unchecked: an off-by-one in the page window sends an operator to
 * the wrong page of two hundred, and a search that stringifies wrongly silently
 * matches nothing. In `shared` so they can be tested at all.
 */

/** A page number to render, or the break between two runs of them. */
export type PageToken = number | 'gap'

/**
 * The page numbers to show, one-based, around the current one.
 *
 * Always shows the first and last page, a window either side of the current
 * one, and a gap where numbers were left out. Two hundred pages cannot be
 * listed and Previous/Next alone cannot reach page 137 — this is the middle
 * ground every paged table settles on.
 *
 * The width is CONSTANT. A window that shrank at the ends would move the
 * buttons under the cursor as an operator paged through, which is how a click
 * lands on the wrong number.
 *
 * @param current one-based, as the operator sees it
 * @param total   one-based count of pages
 * @param span    how many neighbours to show either side of `current`
 */
export const pageWindow = (current: number, total: number, span = 1): PageToken[] => {
  if (total <= 0) return []

  const page = Math.min(Math.max(1, current), total)
  // first + last + current + `span` either side + two gaps.
  const width = span * 2 + 5

  if (total <= width) return Array.from({ length: total }, (_, index) => index + 1)

  const tokens: PageToken[] = [1]

  // Slid away from the ends so the run keeps its width there too: near page 1
  // the window extends right, near the last it extends left.
  let from = Math.max(2, page - span)
  let to = Math.min(total - 1, page + span)

  if (page - span <= 2) to = Math.min(total - 1, width - 2)
  if (page + span >= total - 1) from = Math.max(2, total - width + 3)

  if (from > 2) tokens.push('gap')

  for (let number = from; number <= to; number++) tokens.push(number)

  if (to < total - 1) tokens.push('gap')

  tokens.push(total)

  return tokens
}

/**
 * Does this row match what was typed?
 *
 * Substring, case-insensitive, across every column ON SCREEN — so typing an AWB
 * finds it whether it is a return AWB or a forward one, and a SKU finds it in
 * whichever of the four identifier columns AJIO happened to fill in. Searching
 * hidden fields would find rows for reasons the operator cannot see.
 *
 * Filters the PAGE, not the report: AJIO's endpoints take no search term, so
 * this narrows the fifty rows in hand rather than pretending to search two
 * hundred pages.
 */
export const rowMatches = (
  row: Record<string, unknown>,
  columns: readonly { key: string }[],
  term: string
): boolean => {
  const wanted = term.trim().toLowerCase()

  if (!wanted) return true

  return columns.some(column => {
    const value = row[column.key]

    // Primitives only. An object cell would stringify to "[object Object]" and
    // make every row carrying one match the same meaningless term.
    if (typeof value === 'string') return value.toLowerCase().includes(wanted)
    if (typeof value === 'number' || typeof value === 'bigint' || typeof value === 'boolean') {
      return String(value).toLowerCase().includes(wanted)
    }

    return false
  })
}
