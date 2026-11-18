import { describe, expect, it } from 'vitest'
import {
  contrast,
  derivePalette,
  isHex,
  lighten,
  luminance,
  mix,
  parseHex,
  readableOn,
  SEED_KEYS,
  STOCK_SEEDS,
  toHex,
  type PaletteSeeds
} from '@shared/utils/palette'

/**
 * Thirteen colours in, a whole theme out.
 *
 * This is the only thing standing between a colour picker and an unreadable
 * app. An operator can pick pale grey for body text, or a yellow for the
 * primary action, and the app still has to come back legible — so what is
 * pinned here is not that the maths is pretty but that every foreground the
 * function emits clears a contrast floor against the surface it will actually
 * sit on, for every seed set anyone can produce.
 */

const seeds = (over: Partial<PaletteSeeds> = {}, tone: 'light' | 'dark' = 'light'): PaletteSeeds => ({
  ...STOCK_SEEDS[tone],
  ...over
})

describe('hex parsing', () => {
  it('takes both shorthands, with or without the hash', () => {
    expect(parseHex('#abc')).toEqual({ r: 170, g: 187, b: 204 })
    expect(parseHex('aabbcc')).toEqual({ r: 170, g: 187, b: 204 })
    expect(parseHex('#AABBCC')).toEqual({ r: 170, g: 187, b: 204 })
  })

  it('refuses anything else rather than guessing', () => {
    // The hex field shows an inline error on these; a parser that returned a
    // colour for `#gg` would apply garbage instead.
    for (const bad of ['', '#', '#ab', '#abcd', '#abcde', 'rgb(0,0,0)', '#gggggg', 'white']) {
      expect(parseHex(bad), bad).toBeNull()
      expect(isHex(bad), bad).toBe(false)
    }
  })

  it('round-trips', () => {
    expect(toHex(parseHex('#0088a3')!)).toBe('#0088a3')
  })
})

describe('mixing', () => {
  /**
   * sRGB is gamma-encoded, so averaging the stored numbers gives a midpoint far
   * darker than the one a person sees. Every ramp in the palette is a mix, so
   * getting this wrong would show up in every token at once.
   */
  it('mixes in linear light, not in sRGB numbers', () => {
    const half = mix('#000000', '#ffffff', 0.5)

    // The naive sRGB average is #808080; perceptually the midpoint is lighter.
    expect(half).not.toBe('#808080')
    expect(luminance(half)).toBeCloseTo(0.5, 2)
  })

  it('returns the ends unchanged', () => {
    expect(mix('#0088a3', '#ffffff', 0)).toBe('#0088a3')
    expect(mix('#0088a3', '#ffffff', 1)).toBe('#ffffff')
  })

  it('clamps rather than extrapolating past either end', () => {
    expect(mix('#0088a3', '#ffffff', -1)).toBe('#0088a3')
    expect(mix('#0088a3', '#ffffff', 5)).toBe('#ffffff')
  })
})

describe('contrast', () => {
  it('matches the WCAG anchors', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 1)
    expect(contrast('#ffffff', '#ffffff')).toBeCloseTo(1, 5)
  })

  it('moves a foreground away from its background until it is readable', () => {
    // Pale grey on white: unreadable, and the direction to fix it is darker.
    const fixed = readableOn('#dddddd', '#ffffff', 4.5)

    expect(contrast(fixed, '#ffffff')).toBeGreaterThanOrEqual(4.5)
    expect(luminance(fixed)).toBeLessThan(luminance('#dddddd'))
  })

  it('moves the other way on a dark background', () => {
    const fixed = readableOn('#222222', '#0a0f22', 4.5)

    expect(contrast(fixed, '#0a0f22')).toBeGreaterThanOrEqual(4.5)
    expect(luminance(fixed)).toBeGreaterThan(luminance('#222222'))
  })

  it('leaves a foreground that already clears the bar alone', () => {
    expect(readableOn('#0a0f22', '#ffffff', 4.5)).toBe('#0a0f22')
  })
})

describe('derivePalette', () => {
  it('ships the stock seeds with nothing to warn about', () => {
    // If the values the app ships with cannot clear their own floor, the floor
    // or the values are wrong — and every operator would open Settings to a
    // warning they did not cause.
    for (const tone of ['light', 'dark'] as const) {
      expect(derivePalette(STOCK_SEEDS[tone], tone).warnings, tone).toEqual([])
    }
  })

  it('emits the whole token set, not just what the seeds name', () => {
    const { tokens } = derivePalette(seeds(), 'light')

    // The ramp, the brand, four statuses at four roles each, the chrome.
    expect(Object.keys(tokens).length).toBeGreaterThan(40)
    for (const name of [
      '--color-neutral-0',
      '--color-neutral-950',
      '--color-brand-600',
      '--color-on-accent',
      '--color-success-surface',
      '--color-warning-fg',
      '--color-danger-border',
      '--color-info-solid',
      '--color-sidebar',
      '--color-surface-inverted'
    ]) {
      expect(tokens[name], name).toMatch(/^#[0-9a-f]{6}$/)
    }
  })

  it('pins the operator’s own seeds at the steps that carry them', () => {
    const { tokens } = derivePalette(
      seeds({ surface: '#fffdf7', canvas: '#f4efe4', border: '#e3dccb' }),
      'light'
    )

    expect(tokens['--color-neutral-0']).toBe('#fffdf7')
    expect(tokens['--color-neutral-100']).toBe('#f4efe4')
    // The border seed is the CARD RING, the heaviest line — 400, not 200.
    expect(tokens['--color-neutral-400']).toBe('#e3dccb')
  })

  /**
   * The case the whole file exists for. Pale grey body text on a white card is
   * a perfectly reasonable thing to pick out of a colour wheel and a perfectly
   * unreadable thing to ship.
   */
  it('clamps unreadable body text and says which seed caused it', () => {
    const { tokens, warnings } = derivePalette(seeds({ text: '#e8e8e8' }), 'light')

    expect(contrast(tokens['--color-neutral-900']!, '#ffffff')).toBeGreaterThanOrEqual(4.5)

    const warning = warnings.find((entry) => entry.seed === 'text')

    expect(warning).toBeDefined()
    expect(warning?.wanted).toBe('#e8e8e8')
    expect(warning?.used).not.toBe('#e8e8e8')
    expect(warning?.message).toMatch(/body text/i)
  })

  it('keeps every status foreground readable on its own tint', () => {
    // Deliberately awkward: a yellow warning and a pale green are the two that
    // go wrong when someone pairs them by eye.
    const { tokens } = derivePalette(
      seeds({ warning: '#ffe600', success: '#b6f5d0', danger: '#ff0000', info: '#00e5ff' }),
      'light'
    )

    for (const name of ['success', 'warning', 'danger', 'info']) {
      expect(
        contrast(tokens[`--color-${name}-fg`]!, tokens[`--color-${name}-surface`]!),
        name
      ).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('picks the foreground for a button by contrast, not by habit', () => {
    // White on a pale yellow action is the classic. `on-accent` is derived, so
    // it flips to the dark end instead.
    const pale = derivePalette(seeds({ brand: '#ffe600' }), 'light')
    const deep = derivePalette(seeds({ brand: '#0f3d91' }), 'light')

    expect(contrast(pale.tokens['--color-on-accent']!, '#ffe600')).toBeGreaterThan(4.5)
    expect(deep.tokens['--color-on-accent']).toBe('#ffffff')
  })

  it('keeps sidebar text readable on the sidebar, not on the page', () => {
    const { tokens } = derivePalette(seeds({ sidebar: '#101010', sidebarText: '#1a1a1a' }), 'light')

    expect(contrast(tokens['--color-sidebar-fg']!, '#101010')).toBeGreaterThanOrEqual(3)
  })

  it('hovers away from the page on dark, and into it on light', () => {
    const light = derivePalette(seeds({}, 'light'), 'light')
    const dark = derivePalette(seeds({}, 'dark'), 'dark')

    // A hover that darkens on near-black reads as disabled.
    expect(luminance(dark.tokens['--color-brand-700']!)).toBeGreaterThan(
      luminance(dark.tokens['--color-brand-600']!)
    )
    expect(luminance(light.tokens['--color-brand-700']!)).toBeLessThan(
      luminance(light.tokens['--color-brand-600']!)
    )
  })

  /**
   * The guarantee the UI leans on: whatever anybody types into thirteen boxes,
   * the app comes back readable. Not a fuzz test with a seed — a spread of the
   * shapes that actually break contrast.
   */
  it('never emits unreadable text, for any seed set', () => {
    const awkward: Partial<PaletteSeeds>[] = [
      { text: '#ffffff', surface: '#ffffff' },
      { text: '#000000', surface: '#000000' },
      { textMuted: '#fefefe' },
      { surface: '#0a0a0a', canvas: '#000000', text: '#050505' },
      { brand: '#ffffff' },
      { sidebar: '#ffffff', sidebarText: '#fdfdfd' },
      { success: '#ffffff', warning: '#ffffff', danger: '#ffffff', info: '#ffffff' }
    ]

    for (const tone of ['light', 'dark'] as const) {
      for (const over of awkward) {
        const { tokens } = derivePalette(seeds(over, tone), tone)
        const surface = tokens['--color-neutral-0']!

        expect(contrast(tokens['--color-neutral-900']!, surface), JSON.stringify(over)).toBeGreaterThanOrEqual(4.5)
        expect(contrast(tokens['--color-neutral-600']!, surface), JSON.stringify(over)).toBeGreaterThanOrEqual(3)

        for (const name of ['success', 'warning', 'danger', 'info']) {
          expect(
            contrast(tokens[`--color-${name}-fg`]!, tokens[`--color-${name}-surface`]!),
            `${name} ${JSON.stringify(over)}`
          ).toBeGreaterThanOrEqual(4.5)
        }
      }
    }
  })

  /**
   * Three ways the derivation used to assume a light theme. Each looked right
   * on Day and produced something unusable on Night, which is the failure mode
   * a single-tone eye never catches.
   */
  it('gives the hover step a direction that works on each tone', () => {
    for (const tone of ['light', 'dark'] as const) {
      const { tokens } = derivePalette(seeds({}, tone), tone)
      const hover = tokens['--color-neutral-50']!
      const surface = tokens['--color-neutral-0']!

      // Visible, and only just — a hover that jumps is a hover that flickers.
      expect(hover, tone).not.toBe(surface)
      expect(contrast(hover, surface), tone).toBeLessThan(1.35)
    }

    // The two tones move OPPOSITE ways, and that is the point. On light the
    // card is the brightest thing, so a hover settles towards the page. On
    // dark the page is darker still, so the same move would sink the row into
    // the background — it has to lift instead.
    const light = derivePalette(seeds({}, 'light'), 'light').tokens
    const dark = derivePalette(seeds({}, 'dark'), 'dark').tokens

    expect(luminance(light['--color-neutral-50']!)).toBeLessThan(
      luminance(light['--color-neutral-0']!)
    )
    expect(luminance(dark['--color-neutral-50']!)).toBeGreaterThan(
      luminance(dark['--color-neutral-0']!)
    )
  })

  it('puts a readable label on the primary button in both tones', () => {
    for (const tone of ['light', 'dark'] as const) {
      const { tokens } = derivePalette(seeds({}, tone), tone)

      expect(
        contrast(tokens['--color-on-accent']!, tokens['--color-brand-600']!),
        tone
      ).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('keeps the strongest sidebar label away from the slab, pale or dark', () => {
    // A pale sidebar is a real palette — the shipped Day theme is one — and
    // "strong" used to mean "lighter", which walks the label into the slab.
    for (const sidebar of ['#daf1fe', '#0e1828']) {
      const { tokens } = derivePalette(seeds({ sidebar, sidebarText: '#466574' }), 'light')

      expect(
        contrast(tokens['--color-sidebar-strong']!, tokens['--color-sidebar']!),
        sidebar
      ).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('keeps the accent tints coloured rather than grey', () => {
    // Mixing a deep teal towards white gives putty. The soft accent fills are
    // the same hue at a higher lightness, so they still read as the brand.
    const { tokens } = derivePalette(seeds({ brand: '#005e7c' }), 'light')
    const soft = parseHex(tokens['--color-brand-50']!)!

    // Blue channel clearly ahead of red: still teal, not grey.
    expect(soft.b - soft.r).toBeGreaterThan(12)
  })

  it('is pure — the same seeds give the same tokens', () => {
    const a = derivePalette(seeds({ brand: '#123456' }), 'dark')
    const b = derivePalette(seeds({ brand: '#123456' }), 'dark')

    expect(a.tokens).toEqual(b.tokens)
  })
})

describe('the seed list', () => {
  it('is the thirteen the panel edits, and nothing else', () => {
    expect(SEED_KEYS).toHaveLength(13)
    expect([...SEED_KEYS].sort()).toEqual(Object.keys(STOCK_SEEDS.light).sort())
  })

  it('describes both tones with the same keys', () => {
    expect(Object.keys(STOCK_SEEDS.light).sort()).toEqual(Object.keys(STOCK_SEEDS.dark).sort())
  })

  it('ships hex the picker can show', () => {
    // `<input type="color">` takes #rrggbb and nothing else.
    for (const tone of ['light', 'dark'] as const) {
      for (const [key, value] of Object.entries(STOCK_SEEDS[tone])) {
        expect(value, `${tone}.${key}`).toMatch(/^#[0-9a-f]{6}$/)
      }
    }
  })
})

describe('lighten', () => {
  it('moves toward white without passing it', () => {
    expect(lighten('#000000', 1)).toBe('#ffffff')
    expect(luminance(lighten('#0088a3', 0.3))).toBeGreaterThan(luminance('#0088a3'))
  })
})
