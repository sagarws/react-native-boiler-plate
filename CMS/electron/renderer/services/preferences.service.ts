import { PREFERENCES_CHANNELS } from '@shared/constants/channels'
import type { AppearanceState } from '@shared/types/appearance'
import { DEFAULT_APPEARANCE } from '@shared/types/appearance'
import type { Result } from '@shared/types/result'
import type { ThemeId } from '@shared/types/theme'
import { invoke } from './ipcClient'

export interface Preferences {
  theme: ThemeId
  /** Developer mode, unlocked with the password the server holds. */
  devMode: boolean
  /**
   * Sign Myntra in without a window, by submitting its login request from
   * inside the page instead of clicking the button. Per installation.
   */
  myntraHeadlessLogin: boolean
  /** Whether the Automations switch comes up on when the app opens. */
  automationsOnAtLaunch: boolean
  /** Whether the Login page shows each login's password, with a copy button. */
  showLoginInfo: boolean
  /** Which half of the app opens: the CMS, or the VMS recorder. */
  appMode: 'cms' | 'vms'
  /** The operator's own palette, type scale and corners. */
  appearance: AppearanceState
}

export const preferencesClient = {
  get: (): Promise<Result<Preferences>> => invoke<Preferences>(PREFERENCES_CHANNELS.get),
  setTheme: (theme: ThemeId): Promise<Result<Preferences>> =>
    invoke<Preferences>(PREFERENCES_CHANNELS.setTheme, { theme }),
  /** Myntra's sign-in: submit from the page (true) or click the button (false). */
  setMyntraHeadlessLogin: (enabled: boolean): Promise<Result<Preferences>> =>
    invoke<Preferences>(PREFERENCES_CHANNELS.setMyntraHeadlessLogin, { enabled }),
  /** Automations on (true) or off (false) when the app next opens. */
  setAutomationsOnAtLaunch: (enabled: boolean): Promise<Result<Preferences>> =>
    invoke<Preferences>(PREFERENCES_CHANNELS.setAutomationsOnAtLaunch, { enabled }),
  /** Show (true) or hide (false) passwords on the Login page. */
  setShowLoginInfo: (enabled: boolean): Promise<Result<Preferences>> =>
    invoke<Preferences>(PREFERENCES_CHANNELS.setShowLoginInfo, { enabled }),
  setAppMode: (mode: 'cms' | 'vms'): Promise<Result<Preferences>> =>
    invoke<Preferences>(PREFERENCES_CHANNELS.setAppMode, { mode }),
  /** The whole override set. Sanitised again in the main process. */
  setAppearance: (appearance: AppearanceState): Promise<Result<Preferences>> =>
    invoke<Preferences>(PREFERENCES_CHANNELS.setAppearance, { appearance }),

  /**
   * Asks the SERVER whether this is the developer-mode password.
   *
   * What was typed goes out; the password never comes in. A wrong one comes
   * back as a plain failure, not a 401 — a typo must not read as a dead session
   * and sign the operator out.
   */
  verifyDevMode: (password: string): Promise<Result<{ devMode: boolean; configured: boolean }>> =>
    invoke(PREFERENCES_CHANNELS.verifyDevMode, { password }),

  disableDevMode: (): Promise<Result<{ devMode: boolean }>> =>
    invoke(PREFERENCES_CHANNELS.disableDevMode)
}

/** Theme handed over by the preload at first paint; '' when unavailable. */
export const initialTheme = (): string => window.trackvid?.initialTheme ?? ''

/**
 * The appearance handed over by the preload at first paint.
 *
 * SAME REASON THE THEME RIDES ALONG. Reading it over IPC means a frame of the
 * stock palette before the operator's own arrives — a flash of the wrong colour
 * on every launch, which is exactly what the window's background paint exists
 * to prevent. Anything unreadable falls back to the shipped look, which is a
 * complete app rather than a broken one.
 */
export const initialAppearance = (): AppearanceState => {
  const raw = window.trackvid?.initialAppearance

  if (!raw) return DEFAULT_APPEARANCE

  try {
    return JSON.parse(raw) as AppearanceState
  } catch {
    return DEFAULT_APPEARANCE
  }
}
