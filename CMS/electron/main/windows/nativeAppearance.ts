import { nativeTheme } from 'electron'
import { getPreferences } from '../services/preferences.service'

/**
 * Makes the OS-drawn chrome agree with the app's own Light/Dark choice.
 *
 * The title bar, the traffic lights, the scrollbars macOS draws over native
 * surfaces and the colour of a system context menu are all painted by the OS,
 * which asks `nativeTheme`, not the app's stylesheet. Left alone it follows the
 * SYSTEM appearance — so an operator running the app in Dark on a machine set
 * to Light got a white title bar over a dark window, which is the seam this
 * closes.
 *
 * The three values line up exactly with the customiser's Mode, including
 * `system`, which is Electron's own default and means "keep following the OS".
 * Anything unrecognised — an older preferences file, a hand-edit — lands on
 * `system` rather than guessing.
 */
export const applyNativeAppearance = (): void => {
  const mode = getPreferences().appearance?.theme?.mode

  nativeTheme.themeSource = mode === 'dark' ? 'dark' : mode === 'light' ? 'light' : 'system'
}
