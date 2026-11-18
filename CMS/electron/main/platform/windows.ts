import type { PlatformAdapter } from './types'

export const windowsAdapter: PlatformAdapter = {
  name: 'win32',
  windowOptions: { frame: true },
  quitOnLastWindowClosed: true,
  modifierLabel: 'Ctrl',
  // The BrowserWindow icon is this platform's taskbar and window icon
  // already; there is no second place to put it.
  setAppIcon: () => {}
}
