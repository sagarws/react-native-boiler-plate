import { describe, expect, it } from 'vitest'
import { STOCK_SEEDS, contrast, derivePalette } from '@shared/utils/palette'

/**
 * "Where am I" has to survive the operator's own colours.
 *
 * The current sidebar item used to be the slab shifted a little, which is a
 * near-black chip on a near-black sidebar — two shades nobody can tell apart at
 * arm's length, and the shipped accent is now #171717. So the chip is fixed,
 * and its label is fixed with it: `sidebar-strong` is near-white on the dark
 * theme and would have vanished on a light chip.
 *
 * What is pinned here is that the pair stays readable whatever seeds are in
 * play, and that hover keeps a different answer from selected — a hover that
 * borrowed the chip would look like a second selected item.
 */

const READABLE = 4.5

describe('the sidebar’s current-item chip', () => {
  for (const tone of ['light', 'dark'] as const) {
    it(`is the same chip on the ${tone} theme, with a label that can be read on it`, () => {
      const { tokens } = derivePalette(STOCK_SEEDS[tone], tone)

      expect(tokens['--color-sidebar-active']).toBe('#ebebeb')
      expect(
        contrast(
          tokens['--color-sidebar-active-fg'] as string,
          tokens['--color-sidebar-active'] as string
        )
      ).toBeGreaterThanOrEqual(READABLE)
    })

    it(`keeps hover distinguishable from selected on the ${tone} theme`, () => {
      const { tokens } = derivePalette(STOCK_SEEDS[tone], tone)

      expect(tokens['--color-sidebar-hover']).not.toBe(tokens['--color-sidebar-active'])
    })
  }

  it('holds even when the operator picks a sidebar the chip would normally blend into', () => {
    // A near-black slab is exactly the case the derived version failed at, and
    // it is now the shipped accent's neighbourhood.
    const { tokens } = derivePalette({ ...STOCK_SEEDS.dark, sidebar: '#171717' }, 'dark')

    expect(tokens['--color-sidebar-active']).toBe('#ebebeb')
    expect(
      contrast(
        tokens['--color-sidebar-active'] as string,
        tokens['--color-sidebar'] as string
      )
    ).toBeGreaterThanOrEqual(READABLE)
  })
})
