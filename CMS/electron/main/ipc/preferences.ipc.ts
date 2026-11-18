import { PREFERENCES_CHANNELS } from '@shared/constants/channels'
import { isThemeId } from '@shared/types/theme'
import { fail, ok } from '@shared/types/result'
import {
  getPreferences,
  setAppearance,
  setAutomationsOnAtLaunch,
  setMyntraHeadlessLogin,
  setShowLoginInfo,
  setAppMode,
  setTheme
} from '../services/preferences.service'
import { disableDevMode, verifyDevMode } from '../services/devMode.service'
import { applyNativeAppearance } from '../windows/nativeAppearance'
import { registerHandler } from './handler'

export const registerPreferencesIpc = (): void => {
  registerHandler(PREFERENCES_CHANNELS.get, () => Promise.resolve(ok(getPreferences())))
  registerHandler(PREFERENCES_CHANNELS.verifyDevMode, verifyDevMode)
  registerHandler(PREFERENCES_CHANNELS.disableDevMode, () => disableDevMode())

  registerHandler(PREFERENCES_CHANNELS.setMyntraHeadlessLogin, async (payload) => {
    // `=== true`, so anything malformed turns the headless path OFF rather
    // than on: off is the behaviour the machine already has, and a preference
    // that silently changed how a sign-in runs would be found out at 02:00.
    const enabled = (payload as { enabled?: unknown } | null)?.enabled === true

    return ok(await setMyntraHeadlessLogin(enabled))
  })

  registerHandler(PREFERENCES_CHANNELS.setAutomationsOnAtLaunch, async (payload) => {
    // Refused rather than coerced: unlike the Myntra switch, neither answer is
    // the safe one to fall to — a stray `false` would leave a machine idle all
    // night, a stray `true` would start work an operator had turned off.
    const enabled = (payload as { enabled?: unknown } | null)?.enabled

    if (typeof enabled !== 'boolean') {
      return fail('VALIDATION_ERROR', 'Say whether automations should be on at launch.')
    }

    return ok(await setAutomationsOnAtLaunch(enabled))
  })

  registerHandler(PREFERENCES_CHANNELS.setShowLoginInfo, async (payload) => {
    // `=== true`, so anything malformed HIDES the passwords: hidden is the
    // state that gives nothing away.
    const enabled = (payload as { enabled?: unknown } | null)?.enabled === true

    return ok(await setShowLoginInfo(enabled))
  })

  // Anything but 'vms' is CMS — see toAppMode.
  registerHandler(PREFERENCES_CHANNELS.setAppMode, async (payload) =>
    ok(await setAppMode((payload as { mode?: unknown } | null)?.mode))
  )

  registerHandler(PREFERENCES_CHANNELS.setAppearance, async (payload) => {
    // No validation here beyond taking the field: `setAppearance` sanitises
    // every seed name, every hex and every scale value itself, because the file
    // it writes outlives this renderer and is read by builds that know a
    // different set. One gate, in the place that also reads the file back.
    const appearance = (payload as { appearance?: unknown } | null)?.appearance
    const saved = await setAppearance(appearance)

    // The Mode control changes two things the app does not own: the title bar
    // and the traffic lights. Re-read from the store rather than from the
    // payload, so what the chrome follows is what was actually persisted after
    // sanitising — not what was asked for.
    applyNativeAppearance()

    return ok(saved)
  })

  registerHandler(PREFERENCES_CHANNELS.setTheme, async (payload) => {
    // Validated against the shared id list, so a malformed payload can never
    // write an unknown theme into preferences.json for the next launch to read.
    const theme = (payload as { theme?: unknown } | null)?.theme
    if (!isThemeId(theme)) return fail('VALIDATION_ERROR', 'Unknown theme')
    return ok(await setTheme(theme))
  })
}
