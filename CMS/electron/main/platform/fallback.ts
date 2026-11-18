import type { PlatformAdapter } from './types'

/**
 * Linux is not an officially supported target, but a defined fallback keeps
 * `npm run dev` usable there instead of crashing on an unknown platform.
 */
export const fallbackAdapter: PlatformAdapter = {
  name: 'linux',
  windowOptions: { frame: true },
  quitOnLastWindowClosed: true,
  modifierLabel: 'Ctrl',
  // The BrowserWindow icon is this platform's taskbar and window icon
  // already; there is no second place to put it.
  setAppIcon: () => {}
}
