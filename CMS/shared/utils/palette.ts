import type { ThemeTone } from '@shared/types/theme'

/**
 * Thirteen colours in, a whole theme out.
 *
 * WHY DERIVE AT ALL. The app renders from about a hundred tokens. Nobody is
 * going to sit and pick a hundred colours, and anybody who tried would produce
 * a set that does not hang together — a border darker than the text it sits
 * beside, a warning tint you cannot read a warning on. So the operator edits
 * the thirteen decisions that actually differ between palettes and this file
 * works out the rest, the same way every time.
 *
 * PURE, AND IN `shared/`. No DOM, no Electron, no React: seeds in, tokens out.
 * That is what makes it testable, and the tests are the only thing standing
 * between a customiser and an unreadable app.
 *
 * CONTRAST IS ENFORCED, NOT HOPED FOR. Every derived foreground is checked
 * against the surface it will actually sit on, and moved until it clears the
 * minimum. When that happens the caller is told, so the UI can say "we moved
 * this" rather than shipping something nobody can read. Clamping beats
 * refusing: an operator who picked a pale grey for body text gets readable
 * text and a note, not an error and no theme.
 */

/* -------------------------------------------------------------------------- *
 * Colour arithmetic. sRGB hex in, sRGB hex out, linear-light in between.
 * -------------------------------------------------------------------------- */

interface Rgb {
  r: number
  g: number
  b: number
}

/** `#abc` and `#aabbcc`, with or without the hash. Anything else is null. */
export const parseHex = (value: string): Rgb | null => {
  const text = value.trim().replace(/^#/, '')

  if (!/^([0-9a-f]{3}|[0-9a-f]{6})$/i.test(text)) return null

  const full =
    text.length === 3
      ? text
          .split('')
          .map((c) => c + c)
          .join('')
      : text

  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16)
  }
}

/** What the hex input accepts. Exported so the field and the parser agree. */
export const isHex = (value: string): boolean => parseHex(value) !== null

const clamp255 = (n: number): number => Math.max(0, Math.min(255, Math.round(n)))

export const toHex = ({ r, g, b }: Rgb): string =>
  `#${[r, g, b].map((n) => clamp255(n).toString(16).padStart(2, '0')).join('')}`

/**
 * Mixing happens in LINEAR light, not in sRGB.
 *
 * Averaging two sRGB values is the classic way to get a muddy midpoint: sRGB is
 * gamma-encoded, so halfway between black and white in those numbers is much
 * darker than the halfway a person sees. Every ramp in here is a mix, so doing
 * it wrong would show up everywhere at once.
 */
const toLinear = (channel: number): number => {
  const c = channel / 255

  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

const fromLinear = (channel: number): number =>
  255 * (channel <= 0.0031308 ? channel * 12.92 : 1.055 * channel ** (1 / 2.4) - 0.055)

export const mix = (from: string, to: string, amount: number): string => {
  const a = parseHex(from)
  const b = parseHex(to)

  if (!a || !b) return from

  const t = Math.max(0, Math.min(1, amount))
  const channel = (x: number, y: number): number => fromLinear(toLinear(x) * (1 - t) + toLinear(y) * t)

  return toHex({ r: channel(a.r, b.r), g: channel(a.g, b.g), b: channel(a.b, b.b) })
}

const WHITE = '#ffffff'
const BLACK = '#000000'

/*
 * The sidebar's CURRENT-ITEM chip, and the ink on it.
 *
 * Fixed rather than derived from the slab: see `--color-sidebar-active` below.
 * They live here with the other absolutes so `theme.css` and a customised
 * palette cannot disagree about what "selected" looks like.
 */
const SIDEBAR_CHIP = '#ebebeb'
const SIDEBAR_CHIP_FG = '#171717'

export const lighten = (colour: string, amount: number): string => mix(colour, WHITE, amount)
export const darken = (colour: string, amount: number): string => mix(colour, BLACK, amount)

/** WCAG relative luminance. */
export const luminance = (colour: string): number => {
  const rgb = parseHex(colour)

  if (!rgb) return 0

  return 0.2126 * toLinear(rgb.r) + 0.7152 * toLinear(rgb.g) + 0.0722 * toLinear(rgb.b)
}

/** WCAG contrast ratio, 1 (identical) to 21 (black on white). */
export const contrast = (a: string, b: string): number => {
  const la = luminance(a)
  const lb = luminance(b)

  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

/**
 * Moves a foreground until it is readable on its background.
 *
 * TOWARDS WHICHEVER END HAS FURTHER TO GIVE, decided by asking both rather
 * than by thresholding the background's luminance. A threshold looks right
 * until the background sits near it: a mid-tint that reads as "dark" sends a
 * white foreground towards white, which moves it nowhere and leaves it
 * unreadable. Asking which of black or white contrasts better with this
 * particular background cannot make that mistake.
 *
 * Steps rather than solving for the exact value: the answer is not analytic
 * once both ends move, and 2% steps land within a hair of the minimum while
 * keeping the operator's hue.
 */
export const readableOn = (foreground: string, background: string, minimum: number): string => {
  if (contrast(foreground, background) >= minimum) return foreground

  const towards = contrast(BLACK, background) >= contrast(WHITE, background) ? BLACK : WHITE

  for (let step = 1; step <= 50; step += 1) {
    const candidate = mix(foreground, towards, step * 0.02)

    if (contrast(candidate, background) >= minimum) return candidate
  }

  // Nothing in the hue clears it — take the end of the road rather than
  // returning something unreadable.
  return towards
}

/**
 * A tint of a hue, at a lightness we choose.
 *
 * NOT A MIX TOWARDS WHITE. Mixing desaturates: 20% of amber into white gives a
 * putty grey, not the warm tint a banner wants. What a designer means by "a
 * light amber" is the same hue and saturation at a higher LIGHTNESS, which is
 * an HSL move — so that is what this does, and it is why the status surfaces
 * read as coloured rather than as dirty white.
 *
 * Saturation is held up at the pale end, where HSL otherwise flattens a hue
 * into the background it is supposed to stand out from.
 */
const toHsl = ({ r, g, b }: Rgb): { h: number; s: number; l: number } => {
  const [rd, gd, bd] = [r / 255, g / 255, b / 255] as [number, number, number]
  const max = Math.max(rd, gd, bd)
  const min = Math.min(rd, gd, bd)
  const l = (max + min) / 2
  const d = max - min

  if (d === 0) return { h: 0, s: 0, l }

  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  const h =
    max === rd
      ? ((gd - bd) / d + (gd < bd ? 6 : 0)) / 6
      : max === gd
        ? ((bd - rd) / d + 2) / 6
        : ((rd - gd) / d + 4) / 6

  return { h, s, l }
}

const fromHsl = (h: number, s: number, l: number): string => {
  if (s === 0) return toHex({ r: l * 255, g: l * 255, b: l * 255 })

  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  const channel = (t: number): number => {
    const x = (t + 1) % 1

    if (x < 1 / 6) return p + (q - p) * 6 * x
    if (x < 1 / 2) return q
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6

    return p
  }

  return toHex({ r: channel(h + 1 / 3) * 255, g: channel(h) * 255, b: channel(h - 1 / 3) * 255 })
}

/** How light a colour is, 0–1, in HSL terms rather than perceptual luminance. */
export const lightnessOf = (colour: string): number => {
  const rgb = parseHex(colour)

  return rgb ? toHsl(rgb).l : 0
}

/**
 * A step lighter or darker, keeping the hue.
 *
 * `mix` towards white or black is the obvious way and the wrong one for small
 * steps: in linear light, three per cent of white into a near-black surface is
 * a visible jump, and the same amount into a near-white one does nothing. A
 * lightness delta behaves the same at both ends, which is what a hover state
 * needs.
 */
export const shift = (colour: string, delta: number): string =>
  atLightness(colour, lightnessOf(colour) + delta)

/** The same hue and saturation, at the lightness asked for. */
export const atLightness = (colour: string, lightness: number, minSaturation = 0): string => {
  const rgb = parseHex(colour)

  if (!rgb) return colour

  const { h, s } = toHsl(rgb)

  return fromHsl(h, Math.max(s, minSaturation), Math.max(0, Math.min(1, lightness)))
}

/* -------------------------------------------------------------------------- *
 * The seeds
 * -------------------------------------------------------------------------- */

/**
 * The thirteen. Grouped exactly as the Settings panel groups them, because the
 * grouping IS the explanation: an operator changing "Page background" should
 * not have to know it also moves six ramp steps.
 */
export interface PaletteSeeds {
  /** BRAND */
  brand: string
  brandSecondary: string
  /** STATUS */
  success: string
  warning: string
  danger: string
  info: string
  /** SURFACES */
  canvas: string
  surface: string
  border: string
  /** TEXT */
  text: string
  textMuted: string
  /** CHROME */
  sidebar: string
  sidebarText: string
}

export const SEED_KEYS: readonly (keyof PaletteSeeds)[] = [
  'brand',
  'brandSecondary',
  'success',
  'warning',
  'danger',
  'info',
  'canvas',
  'surface',
  'border',
  'text',
  'textMuted',
  'sidebar',
  'sidebarText'
]

export const isSeedKey = (value: string): value is keyof PaletteSeeds =>
  (SEED_KEYS as readonly string[]).includes(value)

/**
 * What the app ships with, per tone — the same values styles/theme.css states,
 * so "Reset all" and "no overrides at all" land in exactly the same place.
 */
export const STOCK_SEEDS: Record<ThemeTone, PaletteSeeds> = {
  light: {
    brand: '#005e7c',
    brandSecondary: '#3f8fae',
    success: '#1c8a53',
    warning: '#d2852d',
    danger: '#d92d3a',
    info: '#0088a3',
    canvas: '#f3f9fc',
    surface: '#ffffff',
    border: '#a4c9db',
    text: '#092531',
    textMuted: '#466574',
    sidebar: '#daf1fe',
    sidebarText: '#466574'
  },
  dark: {
    brand: '#5cb8d6',
    brandSecondary: '#3f8fae',
    success: '#3fbf7f',
    warning: '#e0a53d',
    danger: '#e26a5f',
    info: '#6a9ff0',
    canvas: '#0b1220',
    surface: '#121b2e',
    border: '#31466a',
    text: '#eaf1f7',
    textMuted: '#8fa2b8',
    sidebar: '#0e1828',
    sidebarText: '#8fa2b8'
  }
}

/* -------------------------------------------------------------------------- *
 * Derivation
 * -------------------------------------------------------------------------- */

/** A foreground that had to be moved to stay readable. */
export interface PaletteWarning {
  /** The seed the operator can do something about. */
  seed: keyof PaletteSeeds
  token: string
  /** What it would have been, and what it became. */
  wanted: string
  used: string
  ratio: number
  minimum: number
  message: string
}

export interface DerivedPalette {
  /** CSS custom property name → colour. Applied on top of theme.css. */
  tokens: Record<string, string>
  warnings: PaletteWarning[]
}

/** Body text has to clear AA; a label or an icon is large or non-essential. */
const TEXT_MINIMUM = 4.5
const MUTED_MINIMUM = 3

/**
 * Seeds in, the full token set out.
 *
 * The ORDER of what follows is the dependency order: surfaces first, because
 * every foreground is checked against one; then the ramp those surfaces imply;
 * then the things that sit on them.
 */
export const derivePalette = (seeds: PaletteSeeds, tone: ThemeTone): DerivedPalette => {
  const warnings: PaletteWarning[] = []
  const dark = tone === 'dark'
  const toward = dark ? WHITE : BLACK

  const keep = (
    seed: keyof PaletteSeeds,
    token: string,
    wanted: string,
    background: string,
    minimum: number,
    message: string
  ): string => {
    const used = readableOn(wanted, background, minimum)

    if (used !== wanted) {
      warnings.push({
        seed,
        token,
        wanted,
        used,
        ratio: Math.round(contrast(wanted, background) * 100) / 100,
        minimum,
        message
      })
    }

    return used
  }

  const { surface, canvas, border, text, textMuted } = seeds

  // TEXT, against the surface it is read on rather than against the page.
  const primary = keep(
    'text',
    '--color-neutral-900',
    text,
    surface,
    TEXT_MINIMUM,
    'Body text was too close to the card surface to read, so it was darkened.'
  )
  const muted = keep(
    'textMuted',
    '--color-neutral-600',
    textMuted,
    surface,
    MUTED_MINIMUM,
    'Muted text was too close to the card surface, so it was moved until labels stayed legible.'
  )

  // THE NEUTRAL RAMP, spanning surface → text, with the operator's own canvas
  // and border pinned at the steps that carry them.
  /*
   * SEVEN LIGHT STEPS BEFORE THE INK, because the screens need them: a card
   * surface, a hover, the page, a chip fill, a row divider, a card ring and an
   * input outline are all different weights of "not text yet". A ramp that
   * jumped from the page colour straight to a border made the divider inside a
   * card and the ring around it the same line.
   *
   * The operator's `border` seed is the CARD RING — the heaviest line they see
   * — and the two lighter lines are mixed back towards the page from it.
   */
  const neutral: Record<string, string> = {
    '--color-neutral-0': surface,
    /*
     * The hover step LIFTS. On a light theme a card's hover sits between it and
     * the page, which is darker — but on a dark theme the page is darker still,
     * so mixing towards it made every hover DIM. A row you point at should come
     * forward in both.
     */
    '--color-neutral-50': dark ? shift(surface, 0.035) : mix(surface, canvas, 0.5),
    '--color-neutral-100': canvas,
    '--color-neutral-200': mix(canvas, border, 0.4),
    '--color-neutral-300': mix(canvas, border, 0.75),
    '--color-neutral-400': border,
    '--color-neutral-500': mix(border, muted, 0.45),
    '--color-neutral-600': muted,
    '--color-neutral-700': mix(muted, primary, 0.35),
    '--color-neutral-800': mix(muted, primary, 0.7),
    '--color-neutral-900': primary,
    '--color-neutral-950': mix(primary, toward, 0.25)
  }

  // BRAND. 600 is the action, 700 its hover — which moves AWAY from the page on
  // a dark theme, because a hover that darkens on near-black reads as disabled.
  const brand = seeds.brand
  /*
   * A LIGHTNESS LADDER, not a mix with the surface.
   *
   * The soft accent fills — the chip behind a selected row, the tint on a
   * quick filter — were mixed towards the card, which desaturates: eight per
   * cent of a deep teal into white is grey, not a pale teal. They are the same
   * hue at a higher lightness, exactly like the status tints.
   *
   * The ladder also has to run the right way round. `darken` for the top of
   * the ramp is a light-theme habit: on a dark ground the accent gets LIGHTER
   * as it goes up, or a hover reads as disabled.
   */
  const accentStep = (lightness: number, floor = 0.35): string =>
    atLightness(brand, lightness, floor)

  const brandTokens: Record<string, string> = {
    '--color-brand-50': accentStep(dark ? 0.16 : 0.95, 0.55),
    '--color-brand-100': accentStep(dark ? 0.21 : 0.91, 0.5),
    '--color-brand-200': accentStep(dark ? 0.27 : 0.85, 0.45),
    '--color-brand-300': accentStep(dark ? 0.4 : 0.68),
    '--color-brand-400': seeds.brandSecondary,
    '--color-brand-500': dark ? seeds.brandSecondary : accentStep(0.28),
    '--color-brand-600': brand,
    // The hover moves AWAY from the page: lighter on dark, deeper on light.
    '--color-brand-700': dark ? lighten(brand, 0.2) : darken(brand, 0.14),
    '--color-brand-800': dark ? lighten(brand, 0.35) : darken(brand, 0.28),
    '--color-brand-900': dark ? lighten(brand, 0.5) : darken(brand, 0.42),
    // Whichever end is actually readable on the button, not whichever is habit.
    /*
     * The two ends of THIS palette, not white and black. On a dark theme the
     * darkest ink is the lightest colour in the set, so comparing against it
     * picked white for a pale blue button and put 2:1 text on it.
     */
    '--color-on-accent': contrast(surface, brand) >= contrast(primary, brand) ? surface : primary
  }

  // STATUS. Four roles per hue, and the foreground is checked against the tint
  // it will actually sit on — which is the pairing that goes wrong by hand.
  const statusSeeds: [keyof PaletteSeeds, string][] = [
    ['success', 'success'],
    ['warning', 'warning'],
    ['danger', 'danger'],
    ['info', 'info']
  ]

  const status: Record<string, string> = {}

  for (const [seedKey, name] of statusSeeds) {
    const hue = seeds[seedKey]
    /*
     * The tint is kept shallow and the foreground pushed a long way off it,
     * because this pairing is the one that fails. At a 22% tint the stock
     * amber cleared 4.5 by six hundredths — technically passing, and one
     * nudge of a seed away from being clamped on a palette nobody had
     * customised. These amounts leave every stock hue around 5:1 in both
     * tones, which is margin rather than luck.
     */
    /*
     * A tint, a ring and a foreground, all at the hue's OWN saturation. The
     * lightnesses are the design's: a banner you can read a warning on, a ring
     * that shows without shouting, and text with real daylight over the tint.
     */
    const tint = atLightness(hue, dark ? 0.14 : 0.93, 0.85)
    const ring = atLightness(hue, dark ? 0.28 : 0.76, 0.5)
    const wantedFg = atLightness(hue, dark ? 0.72 : 0.27, 0.4)

    status[`--color-${name}-surface`] = tint
    status[`--color-${name}-border`] = ring
    status[`--color-${name}-fg`] = keep(
      seedKey,
      `--color-${name}-fg`,
      wantedFg,
      tint,
      TEXT_MINIMUM,
      `${name[0]?.toUpperCase()}${name.slice(1)} text was not readable on its own tint, so it was moved.`
    )
    status[`--color-${name}-solid`] = hue
  }

  // CHROME. The sidebar is its own surface in both themes and does not follow
  // the neutral ramp, so its text is checked against the slab, not the page.
  const sidebar = seeds.sidebar
  const sidebarFg = keep(
    'sidebarText',
    '--color-sidebar-fg',
    seeds.sidebarText,
    sidebar,
    MUTED_MINIMUM,
    'Sidebar text was not readable on the sidebar, so it was moved.'
  )

  /*
   * A SIDEBAR CAN BE PALE. Everything below used to assume a dark slab —
   * "strong" was the fg lightened, which on a pale sidebar walks the most
   * important label towards the background it sits on. Strong means FURTHER
   * from the slab, and which way that is depends on the slab.
   */
  const sidebarIsDark = luminance(sidebar) < 0.35

  const chrome: Record<string, string> = {
    '--color-sidebar': sidebar,
    /*
     * THE CURRENT ITEM IS A LIGHT CHIP, fixed rather than derived.
     *
     * It used to be the slab shifted a little, which on a near-black sidebar is
     * a near-black chip — "where am I" answered by two shades nobody can tell
     * apart at arm's length. The same chip on both themes also means the answer
     * does not change shape when the mode does.
     *
     * Its label is fixed with it: `sidebar-strong` is near-white on a dark
     * theme and would disappear on the chip. Hover keeps the derived lift, so
     * the two states still read differently.
     */
    '--color-sidebar-active': SIDEBAR_CHIP,
    '--color-sidebar-active-fg': readableOn(SIDEBAR_CHIP_FG, SIDEBAR_CHIP, TEXT_MINIMUM),
    '--color-sidebar-hover': shift(sidebar, sidebarIsDark ? 0.06 : -0.06),
    '--color-sidebar-fg': sidebarFg,
    '--color-sidebar-muted': mix(sidebar, sidebarFg, 0.75),
    '--color-sidebar-strong': readableOn(
      atLightness(sidebarFg, sidebarIsDark ? 0.95 : 0.12, 0.1),
      sidebar,
      TEXT_MINIMUM
    ),
    '--color-overlay': darken(canvas, dark ? 0.4 : 0.8),
    /*
     * The inverted chip — a tooltip — is built from the INK, not the sidebar.
     * It used to take the sidebar, which was right while every theme had a
     * dark slab; a pale sidebar turned the tooltip pale too, and pale on pale
     * is not a tooltip. The darkest thing in any palette is its text.
     */
    '--color-surface-inverted': primary,
    '--color-surface-inverted-border': mix(primary, muted, 0.35),
    // Whichever end reads on the chip, the same way a button picks its label.
    '--color-on-inverted':
      contrast(WHITE, primary) >= contrast(surface, primary) ? WHITE : surface,
    '--color-inverse': readableOn(sidebarIsDark ? WHITE : primary, sidebar, TEXT_MINIMUM)
  }

  return { tokens: { ...neutral, ...brandTokens, ...status, ...chrome }, warnings }
}

/**
 * The page colour Electron paints the window with before the renderer loads.
 *
 * Hex only — `backgroundColor` rejects `oklch()` — and the one token that has
 * to survive outside CSS. See mainWindow.
 */
export const canvasHex = (seeds: PaletteSeeds): string => seeds.canvas
