import { BrowserWindow } from 'electron'

/**
 * Pushes an event to the app's own windows.
 *
 * Not every BrowserWindow belongs to this app: session capture opens the
 * marketplace's real login page in one, and that window renders a third party's
 * document. Broadcasting to `getAllWindows()` would deliver app events — and
 * whatever they carry — straight into it.
 *
 * App windows are tagged at creation (`markAppWindow`), so membership is
 * explicit rather than inferred from a URL that changes as the user navigates.
 */

const APP_WINDOWS = new WeakSet<BrowserWindow>()

export const markAppWindow = (window: BrowserWindow): void => {
  APP_WINDOWS.add(window)
}

export const broadcast = (channel: string, payload: unknown): void => {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!APP_WINDOWS.has(window)) continue
    if (window.isDestroyed()) continue
    window.webContents.send(channel, payload)
  }
}
