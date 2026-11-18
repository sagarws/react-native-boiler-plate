import { readFileSync } from 'node:fs'
import { mkdir, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app } from 'electron'
import type { AppearanceState } from '@shared/types/appearance'
import {
  DEFAULT_APPEARANCE,
  DEFAULT_THEME_SETTINGS,
  THEME_CONTENT_WIDTHS,
  THEME_FONTS,
  THEME_MODES,
  THEME_SKINS
} from '@shared/types/appearance'
import type { ThemeId } from '@shared/types/theme'
import { DEFAULT_THEME, isThemeId, toThemeId } from '@shared/types/theme'
import { isHex, isSeedKey, type PaletteSeeds } from '@shared/utils/palette'
import { devModePersistsAcrossRestarts } from '../config/devModePolicy'
import { logger } from './logger'

/**
 * User interface preferences, persisted in userData/preferences.json.
 *
 * Deliberately NOT localStorage: on a packaged build the renderer runs from a
 * file:// origin, where web storage is easy to lose, and the whole point of
 * this file is to survive an auto-update replacing the app directory. userData
 * is untouched by the installer.
 *
 * The initial read is synchronous and happens before the first window is
 * created, so the chosen theme can be handed to the renderer at startup rather
 * than arriving a frame later as a visible flash of the wrong colours.
 */
export interface Preferences {
  theme: ThemeId
  /**
   * Developer mode, unlocked with the password held on the server.
   *
   * Per INSTALLATION, not per account: it says "this machine belongs to someone
   * who wants the extra screens", which is a property of the machine and of the
   * person at it. Persisted so it survives a restart, because a mode that had
   * to be re-unlocked every launch would be turned on once and then worked
   * around.
   */
  devMode: boolean
  /**
   * Sign Myntra in without a window, by submitting its login request from
   * inside the page instead of clicking the button.
   *
   * PER INSTALLATION AND OFF BY DEFAULT. Myntra is the one platform whose
   * scripted sign-in needs a screen: its LOG IN button ignores a synthetic
   * click, so the established path finishes with a real mouse click at screen
   * coordinates. The headless path issues the same POST the click produces (see
   * the core's platforms/myntra/common/headlessLogin) and needs no window at
   * all — but the login page also loads reCAPTCHA, which is invisible until it
   * is not, and a headless browser is what tends to provoke it.
   *
   * So it is a choice an operator makes for their machine, and a machine that
   * has not chosen keeps the behaviour it has today.
   */
  myntraHeadlessLogin: boolean
  /**
   * Whether the Automations switch comes up ON when the app opens.
   *
   * ON BY DEFAULT, because that is what every launch did before this existed:
   * off for two seconds, then on (see `switchOnAtLaunch`). Off means the app
   * opens with the switch off — the same off an operator sets by hand, so it
   * stays off until somebody moves it.
   *
   * Read once, at launch. Changing it does not move the switch now; that is
   * what the switch is for.
   */
  automationsOnAtLaunch: boolean
  /**
   * Show each login's password under its username on the Login page, with a
   * copy button.
   *
   * OFF BY DEFAULT, and per installation. A password on screen is readable by
   * anyone standing behind the operator, so it is something a machine opts
   * into. The main process reads this before it hands a password out — the
   * renderer hiding a value it was given anyway would be no gate at all.
   */
  showLoginInfo: boolean
  /**
   * The operator's own palette, type scale and corners.
   *
   * AN OVERRIDE SET, never a theme: the empty value is a complete, correct app,
   * because styles/theme.css renders on its own. That is what lets anything
   * unreadable here fall back to the shipped look instead of to a broken one.
   */
  appearance: AppearanceState
}

interface PersistedPreferences {
  version: 1
  theme: string
  devMode?: boolean
  myntraHeadlessLogin?: boolean
  automationsOnAtLaunch?: boolean
  showLoginInfo?: boolean
  appearance?: unknown
}

/**
 * Reads a stored appearance back, keeping only what this build understands.
 *
 * NOTHING HERE THROWS. This file is read before the first window exists, so a
 * hand-edited JSON, a downgrade from a build with more seeds, or a half-written
 * file must all end at the shipped look rather than at a stack trace with no
 * window to show it in. Every unknown key, wrong type and malformed hex is
 * dropped silently — the operator sees the stock palette, which is the same
 * thing a fresh install sees.
 */
const readAppearance = (raw: unknown): AppearanceState => {
  if (!raw || typeof raw !== 'object') return DEFAULT_APPEARANCE

  const input = raw as Record<string, unknown>
  const overrides: AppearanceState['overrides'] = {}
  const stored = input.overrides

  if (stored && typeof stored === 'object') {
    for (const [theme, seeds] of Object.entries(stored as Record<string, unknown>)) {
      if (!isThemeId(theme) || !seeds || typeof seeds !== 'object') continue

      const kept: Partial<PaletteSeeds> = {}

      for (const [key, value] of Object.entries(seeds as Record<string, unknown>)) {
        if (isSeedKey(key) && typeof value === 'string' && isHex(value)) kept[key] = value
      }

      if (Object.keys(kept).length > 0) overrides[theme] = kept
    }
  }

  const oneOf = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
    typeof value === 'string' && (allowed as readonly string[]).includes(value)
      ? (value as T)
      : fallback

  /*
   * The customizer's answers, each checked against the list THIS build knows.
   * A file from a later build naming a skin this one has never heard of falls
   * back to the shipped look, rather than leaving the theme in a state no
   * stylesheet describes.
   */
  const storedTheme = input.theme as Record<string, unknown> | undefined
  const picked = storedTheme?.primaryColor

  return {
    version: 1,
    overrides,
    density: oneOf(input.density, ['compact', 'default', 'comfortable'] as const, 'default'),
    corner: oneOf(input.corner, ['square', 'default', 'rounded'] as const, 'default'),
    font: oneOf(input.font, ['system', 'neutral', 'mono'] as const, 'system'),
    theme: {
      mode: oneOf(storedTheme?.mode, THEME_MODES, DEFAULT_THEME_SETTINGS.mode),
      skin: oneOf(storedTheme?.skin, THEME_SKINS, DEFAULT_THEME_SETTINGS.skin),
      // A colour the operator PICKED, so it is checked as a colour rather than
      // against a list of five.
      primaryColor:
        typeof picked === 'string' && isHex(picked) ? picked : DEFAULT_THEME_SETTINGS.primaryColor,
      contentWidth: oneOf(
        storedTheme?.contentWidth,
        THEME_CONTENT_WIDTHS,
        DEFAULT_THEME_SETTINGS.contentWidth
      ),
      font: oneOf(storedTheme?.font, THEME_FONTS, DEFAULT_THEME_SETTINGS.font)
    }
  }
}

const FILE = 'preferences.json'

const filePath = (): string => join(app.getPath('userData'), FILE)

let current: Preferences = {
  theme: DEFAULT_THEME,
  devMode: false,
  myntraHeadlessLogin: false,
  automationsOnAtLaunch: true,
  showLoginInfo: false,
  appearance: DEFAULT_APPEARANCE
}

export const getPreferences = (): Preferences => current

/**
 * Called once during startup, before createMainWindow(). Any failure - missing
 * file on first run, malformed JSON, an unknown theme id from a downgrade -
 * falls back to defaults rather than blocking the app from starting.
 */
export const initialisePreferences = (): void => {
  try {
    const raw = readFileSync(filePath(), 'utf8')
    const parsed = JSON.parse(raw) as Partial<PersistedPreferences>
    // `=== true`, so a file written before this existed — or one an editor has
    // been at — reads as off. Off is the state that hides things, which is the
    // safe way for an unreadable value to fall.
    current = {
      theme: toThemeId(parsed.theme),
      // Remembered only in a build with DEV_MODE_PERSIST=true. Otherwise every
      // launch opens with it off — the stored value is left as it is, and
      // switching it on again works for the rest of that session.
      devMode: parsed.devMode === true && devModePersistsAcrossRestarts(),
      // `=== true` for the same reason as devMode: a file written before
      // this existed reads as off, and off is the behaviour this machine
      // already has.
      myntraHeadlessLogin: parsed.myntraHeadlessLogin === true,
      // `!== false`, the other way round: a file written before this existed
      // must keep the launch behaviour it has always had, which is ON.
      automationsOnAtLaunch: parsed.automationsOnAtLaunch !== false,
      // `=== true`: hidden is the safe way for an unreadable value to fall.
      showLoginInfo: parsed.showLoginInfo === true,
      appearance: readAppearance(parsed.appearance)
    }
    logger.info('Preferences loaded', {
      theme: current.theme,
      devMode: current.devMode,
      myntraHeadlessLogin: current.myntraHeadlessLogin,
      automationsOnAtLaunch: current.automationsOnAtLaunch,
      showLoginInfo: current.showLoginInfo,
      // The palette itself is noise in a log line; whether there IS one is not.
      customised: Object.keys(current.appearance.overrides).length > 0
    })
  } catch (error) {
    const missing = (error as { code?: string }).code === 'ENOENT'
    if (!missing) logger.warn('Preferences unreadable; using defaults', { theme: DEFAULT_THEME })
    current = {
      theme: DEFAULT_THEME,
      devMode: false,
      myntraHeadlessLogin: false,
      automationsOnAtLaunch: true,
      showLoginInfo: false,
      appearance: DEFAULT_APPEARANCE
    }
  }
}

/** Atomic write: temp file + rename, matching how every other store here persists. */
const persist = async (next: Preferences): Promise<void> => {
  const record: PersistedPreferences = {
    version: 1,
    theme: next.theme,
    devMode: next.devMode,
    myntraHeadlessLogin: next.myntraHeadlessLogin,
    automationsOnAtLaunch: next.automationsOnAtLaunch,
    showLoginInfo: next.showLoginInfo,
    appearance: next.appearance
  }
  const target = filePath()
  const temp = `${target}.tmp`

  await mkdir(app.getPath('userData'), { recursive: true })
  await writeFile(temp, JSON.stringify(record, null, 2), 'utf8')
  await rename(temp, target)
}

export const setTheme = async (theme: ThemeId): Promise<Preferences> => {
  current = { ...current, theme }
  try {
    await persist(current)
    logger.info('Theme changed', { theme })
  } catch (error) {
    // The change still applies for this session; only the persistence failed.
    logger.error('Could not persist preferences', error)
  }
  return current
}

/**
 * Turns developer mode on or off for this installation.
 *
 * The VERIFICATION is not here — it happens on the server, which holds the
 * password and never sends it. This only records the answer.
 */
export const setDevMode = async (devMode: boolean): Promise<Preferences> => {
  current = { ...current, devMode }

  try {
    await persist(current)
    logger.info(`Developer mode ${devMode ? 'enabled' : 'disabled'}`)
  } catch (error) {
    // A preference that could not be written is worth saying so about, but not
    // worth refusing the change the operator just made — it simply will not
    // survive a restart.
    logger.warn('Could not persist developer mode', {
      error: error instanceof Error ? error.message : String(error)
    })
  }

  return current
}

/**
 * Turns the headless Myntra sign-in on or off for this installation.
 *
 * Reported back rather than assumed at: the Sessions page and the nightly job
 * both read `getPreferences()` when they capture, so the next sign-in takes
 * whichever path is set at the time — nothing is cached against this value.
 */
export const setMyntraHeadlessLogin = async (enabled: boolean): Promise<Preferences> => {
  current = { ...current, myntraHeadlessLogin: enabled }

  try {
    await persist(current)
    logger.info(`Myntra headless sign-in ${enabled ? 'enabled' : 'disabled'}`)
  } catch (error) {
    // Applies for this session either way; only the persistence failed.
    logger.warn('Could not persist the Myntra sign-in preference', {
      error: error instanceof Error ? error.message : String(error)
    })
  }

  return current
}

/**
 * Whether the Automations switch comes up on at the next launch.
 *
 * Only the NEXT launch: the switch as it stands now is left where it is.
 */
export const setAutomationsOnAtLaunch = async (enabled: boolean): Promise<Preferences> => {
  current = { ...current, automationsOnAtLaunch: enabled }

  try {
    await persist(current)
    logger.info(`Automations will be ${enabled ? 'on' : 'off'} at launch`)
  } catch (error) {
    // Applies for this session either way; only the persistence failed.
    logger.warn('Could not persist the automations-at-launch preference', {
      error: error instanceof Error ? error.message : String(error)
    })
  }

  return current
}

/**
 * Whether the Login page shows each login's password, for this installation.
 *
 * Takes effect at once: the reveal handler reads `getPreferences()` on every
 * request, so switching it off stops the next password going out.
 */
export const setShowLoginInfo = async (enabled: boolean): Promise<Preferences> => {
  current = { ...current, showLoginInfo: enabled }

  try {
    await persist(current)
    logger.info(`Login info ${enabled ? 'shown' : 'hidden'} on the Login page`)
  } catch (error) {
    // Applies for this session either way; only the persistence failed.
    logger.warn('Could not persist the login-info preference', {
      error: error instanceof Error ? error.message : String(error)
    })
  }

  return current
}

/**
 * Records the operator's palette, type scale and corners.
 *
 * Sanitised on the way IN as well as on the way out: the renderer validates
 * before it applies, but this file outlives the renderer that wrote it and is
 * read by a later build that may know fewer seeds.
 */
export const setAppearance = async (appearance: unknown): Promise<Preferences> => {
  current = { ...current, appearance: readAppearance(appearance) }

  try {
    await persist(current)
  } catch (error) {
    // Applies for this session either way; only the persistence failed.
    logger.warn('Could not persist the appearance', {
      error: error instanceof Error ? error.message : String(error)
    })
  }

  return current
}
