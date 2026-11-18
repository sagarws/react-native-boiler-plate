import { describe, expect, it } from 'vitest'
import { isOrderNumberOf, subOrderDecision } from '@shared/utils/subOrderMatch'

/**
 * The rule that decides whether a mapping run may overwrite a claim's sub-order
 * number. It is the only place in that run that can destroy data, so the four
 * cases are pinned down here rather than inferred from the sweep.
 */

describe('subOrderDecision', () => {
  it('fills a blank row', () => {
    expect(subOrderDecision('', '321630244519183296_1')).toBe('fill')
  })

  it('does nothing when they already agree', () => {
    expect(subOrderDecision('321630244519183296_1', '321630244519183296_1')).toBe('same')
    // Whitespace is not a disagreement.
    expect(subOrderDecision(' 321630244519183296_1 ', '321630244519183296_1')).toBe('same')
  })

  it('reports a disagreement rather than resolving it', () => {
    expect(subOrderDecision('321630244519183296', '321630244519183296_1')).toBe('conflict')
    expect(subOrderDecision('999999999999999999_1', '321630244519183296_1')).toBe('conflict')
  })

  it('writes nothing when the marketplace answered without one', () => {
    expect(subOrderDecision('321630244519183296_1', null)).toBe('none')
    expect(subOrderDecision('', '')).toBe('none')
  })
})

describe('isOrderNumberOf', () => {
  it('spots the commonest cause — the row holds the ORDER number', () => {
    // Meesho's returns row answers with both; they differ by the split suffix.
    expect(isOrderNumberOf('321630244519183296', '321630244519183296_1')).toBe(true)
  })

  it('does not call two unrelated numbers a prefix match', () => {
    expect(isOrderNumberOf('999999999999999999', '321630244519183296_1')).toBe(false)
    expect(isOrderNumberOf('', '321630244519183296_1')).toBe(false)
    // Same order, different split — a real disagreement, not a missing suffix.
    expect(isOrderNumberOf('321630244519183296_2', '321630244519183296_1')).toBe(false)
  })
})
