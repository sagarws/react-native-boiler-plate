import type { PaletteSeeds } from '@shared/utils/palette'
import type { ThemeId } from '@shared/types/theme'

/**
 * What the operator has changed about how the app looks.
 *
 * EVERYTHING HERE IS AN OVERRIDE, and the empty object is a complete, correct
 * app: styles/theme.css renders on its own and this layers on top. That is the
 * rule that keeps the customiser from becoming load-bearing — a corrupted
 * preferences file, a downgrade, a machine that has never opened Settings all
 * land in the same place, which is the palette the app ships with.
 *
 * PER THEME, not per app. Light and Dark are different palettes and an operator
 * who warms up their Day theme has said nothing about their Night one. Keying
 * the overrides by theme id is what lets both be held at once.
 *
 * Lives in `shared/` because the main process persists it and the renderer
 * applies it, and a second copy of this shape is how those two drift.
 */

/** How tight the type and spacing scales run. */
export type Density = 'compact' | 'default' | 'comfortable'

/** How much the corners are softened. */
export type Corner = 'square' | 'default' | 'rounded'

/**
 * The typeface, from stacks the machine already has.
 *
 * No downloaded fonts — the app has to look right offline and on a locked-down
 * machine, and a webfont that fails to load is a layout that moves after it
 * renders.
 */
export type FontChoice = 'system' | 'neutral' | 'mono'

/**
 * How the ported design system is set up: the customizer's answers.
 *
 * LIVES INSIDE THE APPEARANCE RECORD rather than beside it, and that is a
 * deliberate constraint rather than a filing decision. The appearance is the
 * one preference the preload already hands to the renderer at first paint, so
 * anything carried in here is on screen in the first frame — a mode or a
 * primary colour fetched over IPC instead would paint one frame of the default
 * and then snap, which is the flash the window's own background colour exists
 * to prevent.
 */
export type ThemeMode = 'light' | 'dark' | 'system'
export type ThemeSkin = 'default' | 'bordered'
export type ThemeContentWidth = 'compact' | 'wide'

/** Typefaces the app ships. No download, no network: see styles/fonts.css. */
export type ThemeFont = 'geist' | 'public-sans' | 'inter' | 'system'

export interface ThemeSettings {
  mode: ThemeMode
  skin: ThemeSkin
  /** A hex colour — one of the presets, or one the operator picked. */
  primaryColor: string
  contentWidth: ThemeContentWidth
  font: ThemeFont
}

export const THEME_MODES: readonly ThemeMode[] = ['light', 'dark', 'system']
export const THEME_SKINS: readonly ThemeSkin[] = ['default', 'bordered']
export const THEME_CONTENT_WIDTHS: readonly ThemeContentWidth[] = ['compact', 'wide']
export const THEME_FONTS: readonly ThemeFont[] = ['geist', 'public-sans', 'inter', 'system']

/** What a fresh installation looks like — the Vercel defaults. */
export const DEFAULT_THEME_SETTINGS: ThemeSettings = {
  mode: 'light',
  skin: 'default',
  // The FIRST preset in primaryColorConfig — the near-black Vercel accents
  // everything with, which is what the app now ships on.
  //
  // IT HAS TO STAY IN STEP WITH THAT LIST. This value decides what a fresh
  // machine renders; `defaultSettings()` in the ported settings context reads
  // `primaryColorConfig[0]` and decides what Reset puts back and whether the
  // card thinks anything has changed. They disagreed once — this said '#7367F0'
  // while the list started at another colour — and the result was a fresh
  // installation whose selected swatch was not the colour on screen. Moving the
  // default from teal to ink means BOTH had to move; if you put teal back, move
  // it back in both places.
  primaryColor: '#171717',
  contentWidth: 'compact',
  font: 'geist'
}

export interface AppearanceState {
  /**
   * Bumped only when an old file cannot be read as a new one. A file from
   * before this existed has no version and is read as "no overrides", which is
   * exactly right.
   */
  version: 1
  /** Seed overrides, by theme. A theme with none renders the stock palette. */
  overrides: Partial<Record<ThemeId, Partial<PaletteSeeds>>>
  density: Density
  corner: Corner
  font: FontChoice
  /** The ported design system's own settings — see ThemeSettings. */
  theme: ThemeSettings
}

export const DEFAULT_APPEARANCE: AppearanceState = {
  version: 1,
  overrides: {},
  density: 'default',
  corner: 'default',
  font: 'system',
  theme: DEFAULT_THEME_SETTINGS
}

export const DENSITIES: readonly { id: Density; label: string; hint: string }[] = [
  { id: 'compact', label: 'Compact', hint: 'More rows on screen' },
  { id: 'default', label: 'Default', hint: 'What the app ships with' },
  { id: 'comfortable', label: 'Comfortable', hint: 'Easier on a large display' }
]

export const CORNERS: readonly { id: Corner; label: string }[] = [
  { id: 'square', label: 'Square' },
  { id: 'default', label: 'Default' },
  { id: 'rounded', label: 'Rounded' }
]

export const FONTS: readonly { id: FontChoice; label: string; hint: string }[] = [
  { id: 'system', label: 'System', hint: 'Looks native on Windows and macOS' },
  { id: 'neutral', label: 'Neutral', hint: 'The same grotesque on both' },
  { id: 'mono', label: 'Monospace', hint: 'Every character the same width' }
]

/** Whether anything has been changed at all — what disables "Reset all". */
export const isStockAppearance = (state: AppearanceState): boolean =>
  state.density === 'default' &&
  state.corner === 'default' &&
  state.font === 'system' &&
  Object.values(state.overrides).every((seeds) => !seeds || Object.keys(seeds).length === 0)

/** The seeds overridden for one theme, or none. */
export const overridesFor = (
  state: AppearanceState,
  theme: ThemeId
): Partial<PaletteSeeds> => state.overrides[theme] ?? {}
