import { describe, expect, it } from 'vitest'
import {
  DEFAULT_APPEARANCE,
  isStockAppearance,
  overridesFor,
  type AppearanceState
} from '@shared/types/appearance'
import { SEED_KEYS } from '@shared/utils/palette'

/**
 * The state behind the customiser.
 *
 * Two things matter here and neither is about colour. "Nothing changed yet" has
 * to mean exactly one thing, because it is what disables Reset all and what a
 * fresh install, a cleared file and Reset all itself all land on. And the
 * overrides are keyed by THEME, so editing Day must leave Night alone.
 */

const state = (over: Partial<AppearanceState> = {}): AppearanceState => ({
  ...DEFAULT_APPEARANCE,
  ...over
})

describe('isStockAppearance', () => {
  it('is true for the shipped state', () => {
    expect(isStockAppearance(DEFAULT_APPEARANCE)).toBe(true)
  })

  it('is true when a theme key survives with nothing in it', () => {
    // The provider drops an emptied key, but a file written by an older build
    // — or edited by hand — can still carry one. An empty object is not a
    // change, and Reset all must not look enabled because of one.
    expect(isStockAppearance(state({ overrides: { trackvid: {} } }))).toBe(true)
  })

  it('is false as soon as one colour is overridden', () => {
    expect(isStockAppearance(state({ overrides: { trackvid: { brand: '#ff0000' } } }))).toBe(false)
  })

  it('is false for a scale change, with no colour touched', () => {
    // Density and corners are as much a change as a colour, and Reset all puts
    // them back too.
    expect(isStockAppearance(state({ density: 'compact' }))).toBe(false)
    expect(isStockAppearance(state({ corner: 'rounded' }))).toBe(false)
    expect(isStockAppearance(state({ font: 'mono' }))).toBe(false)
  })
})

describe('overridesFor', () => {
  it('keeps the two themes apart', () => {
    const both = state({
      overrides: { trackvid: { brand: '#ff0000' }, 'trackvid-dark': { brand: '#00ff00' } }
    })

    expect(overridesFor(both, 'trackvid')).toEqual({ brand: '#ff0000' })
    expect(overridesFor(both, 'trackvid-dark')).toEqual({ brand: '#00ff00' })
  })

  it('answers with nothing for a theme that has never been edited', () => {
    expect(overridesFor(DEFAULT_APPEARANCE, 'trackvid-dark')).toEqual({})
  })
})

describe('the shipped default', () => {
  it('is empty, so theme.css alone renders the app', () => {
    // The rule the whole customiser rests on: with no overrides stored, nothing
    // is written to the document at all.
    expect(DEFAULT_APPEARANCE.overrides).toEqual({})
  })

  it('names every seed the derivation takes', () => {
    // A seed with no row in the panel is a colour nobody can change; a row with
    // no seed is a control wired to nothing.
    expect(SEED_KEYS.length).toBe(13)
  })
})
