/**
 * Colour themes.
 *
 * A theme is applied by setting `data-theme` on <html>. Every Tailwind utility
 * compiles to a `var(--color-*)` reference, so redefining those variables under
 * a `[data-theme]` selector retints the entire app - no component knows which
 * theme is active, and adding a sixth theme is a CSS block plus one entry here.
 */
/**
 * Two themes, Day and Night. That is the whole set — see DESIGN.md.
 *
 * There were seven (slate, midnight, ocean, forest, sunset alongside these
 * two), which meant every new component had five palettes to look right in and
 * in practice was checked against one. The status colours are the evidence: no
 * theme block ever redefined them, so warnings rendered as near-white slabs on
 * every dark palette.
 *
 * Removing an id is not enough on its own — a machine that stored `ocean` still
 * has it in preferences. `toThemeId` below maps anything unknown onto the
 * survivor with the same tone, so an operator's screen keeps its brightness
 * rather than flipping to light on the next launch.
 */
export const THEME_IDS = ['trackvid', 'trackvid-dark'] as const

export type ThemeId = (typeof THEME_IDS)[number]

/**
 * TrackVid brand colours, so a fresh install already looks like the product
 * rather than a neutral shell someone has to go and theme.
 */
export const DEFAULT_THEME: ThemeId = 'trackvid'

/**
 * Light or dark, which is the only thing a derived palette needs to know about
 * a theme: whether a hover lightens or darkens, whether a tint is a wash of
 * white or of black. Named because the customiser derives per tone.
 */
export type ThemeTone = 'light' | 'dark'

export interface ThemeMeta {
  id: ThemeId
  name: string
  description: string
  /** Drives the contrast of the preview card in Settings. */
  tone: ThemeTone
  /** Three representative colours: sidebar, surface, accent. */
  swatch: readonly [string, string, string]
  /**
   * The page background as sRGB hex, matching this theme's --color-slate-100.
   * The BrowserWindow paints this before the renderer has loaded, so a launch
   * never flashes a colour from a different theme. Hex because Electron's
   * backgroundColor does not accept oklch().
   */
  baseColor: string
}

export const THEMES: readonly ThemeMeta[] = [
  {
    id: 'trackvid',
    name: 'Day',
    description: 'Light mode — the palette from the TrackVid web app.',
    tone: 'light',
    swatch: ['#0a0f22', '#f6f8fa', '#0088a3'],
    baseColor: '#f6f8fa'
  },
  {
    id: 'trackvid-dark',
    name: 'Night',
    description: 'Dark mode — the web app’s dark palette, same brand teal.',
    tone: 'dark',
    swatch: ['#0e1428', '#121831', '#35a9a5'],
    baseColor: '#0a0f22'
  }
]

export const isThemeId = (value: unknown): value is ThemeId =>
  typeof value === 'string' && (THEME_IDS as readonly string[]).includes(value)

/**
 * The tone each retired theme had. Five themes were removed (see THEME_IDS);
 * this is how a preference stored under one of them keeps its brightness.
 */
const RETIRED_TONE: Record<string, ThemeId> = {
  slate: 'trackvid',
  ocean: 'trackvid',
  forest: 'trackvid',
  sunset: 'trackvid',
  midnight: 'trackvid-dark'
}

/**
 * Coerces any stored value to a theme that exists.
 *
 * Falls back rather than throwing: a bad stored value must not brick the UI.
 *
 * A machine that stored one of the five retired themes still has it in
 * preferences, so those are mapped by TONE — a dark-theme user must not be
 * flipped to light by an upgrade. That is jarring and reads as a bug.
 */
/** The tone a theme id has. The customiser derives per tone, not per id. */
export const toneOf = (theme: ThemeId): ThemeTone =>
  THEMES.find((entry) => entry.id === theme)?.tone ?? 'light'

export const toThemeId = (value: unknown): ThemeId => {
  if (isThemeId(value)) return value

  // Only a string can name a theme; anything else is a corrupted preference.
  const retired = typeof value === 'string' ? RETIRED_TONE[value.trim()] : undefined

  return retired ?? DEFAULT_THEME
}
