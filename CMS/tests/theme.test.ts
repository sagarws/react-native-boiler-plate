import { describe, expect, it } from 'vitest'
import { DEFAULT_THEME, isThemeId, THEME_IDS, THEMES, toThemeId } from '@shared/types/theme'

describe('theme registry', () => {
  it('describes every id exactly once, in the same order', () => {
    // Guards the drift that breaks Settings silently: an id with no metadata
    // renders nothing, and metadata with no id can never be selected.
    expect(THEMES.map((theme) => theme.id)).toEqual([...THEME_IDS])
  })

  it('gives every theme three preview colours', () => {
    for (const theme of THEMES) {
      expect(theme.swatch).toHaveLength(3)
      expect(theme.name.length).toBeGreaterThan(0)
    }
  })

  it('ships at least one dark theme', () => {
    expect(THEMES.filter((theme) => theme.tone === 'dark').length).toBeGreaterThan(0)
  })

  it('gives every dark theme a dark base colour', () => {
    // baseColor paints the window before the renderer loads. A dark theme with
    // a light one flashes white on every launch — the exact thing baseColor
    // exists to prevent — and no test would otherwise catch it.
    const luminance = (hex: string): number => {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)

      return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0)
    }

    for (const theme of THEMES) {
      const value = luminance(theme.baseColor)

      if (theme.tone === 'dark') expect(value).toBeLessThan(0.3)
      else expect(value).toBeGreaterThan(0.7)
    }
  })

  it('has a default that is a real theme', () => {
    expect(isThemeId(DEFAULT_THEME)).toBe(true)
  })
})

describe('toThemeId', () => {
  it('passes through a known id', () => {
    expect(toThemeId('trackvid-dark')).toBe('trackvid-dark')
  })

  it('falls back to the default for anything else', () => {
    // A stored value from a newer build, or an empty argv, must not brick the UI.
    for (const value of ['', 'neon', null, undefined, 42, {}]) {
      expect(toThemeId(value)).toBe(DEFAULT_THEME)
    }
  })
})

/**
 * Seven themes became two (see DESIGN.md). A machine that stored one of the
 * five retired ones still has it in preferences on the next launch.
 */
describe('retired themes', () => {
  // Flipping a dark-theme user to light on upgrade is jarring and reads as a
  // bug, so the mapping follows TONE rather than falling back to the default.
  it('keeps a dark preference dark', () => {
    expect(toThemeId('midnight')).toBe('trackvid-dark')
  })

  it('maps the retired light themes to the light one', () => {
    for (const id of ['slate', 'ocean', 'forest', 'sunset']) {
      expect(toThemeId(id)).toBe('trackvid')
    }
  })

  it('falls back to the default for anything else', () => {
    expect(toThemeId('nonsense')).toBe(DEFAULT_THEME)
    expect(toThemeId(null)).toBe(DEFAULT_THEME)
    expect(toThemeId({ id: 'midnight' })).toBe(DEFAULT_THEME)
  })

  it('offers exactly two themes, one light and one dark', () => {
    expect(THEME_IDS).toHaveLength(2)
    expect(THEMES.map(t => t.tone).sort()).toEqual(['dark', 'light'])
  })
})
