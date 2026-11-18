import { join } from 'node:path'
import { app } from 'electron'

/**
 * Where this app's local data lives.
 *
 * Resolved through app.getPath('userData') so it is correct on Windows
 * (%APPDATA%) and macOS (~/Library/Application Support) with no hard-coded
 * path, and so it survives an upgrade untouched by the installer.
 *
 * The stores that use it (the claim queue, marketplace sessions, the import
 * schedule) each own their own collection; there is no shared registry to
 * initialise.
 */
export const dataDirectory = (): string => join(app.getPath('userData'), 'data')

/**
 * Development only: give this checkout its own userData folder.
 *
 * Two checkouts of this repo share one package name, so they share one
 * userData folder — and with it the single-instance lock, which makes the
 * second `npm run dev` quit silently. Setting MAIN_VITE_DEV_PROFILE (e.g.
 * "dev2") in `.env` moves this checkout to `<userData>-dev2`: its own lock,
 * its own stores, its own login.
 *
 * Ignored in a packaged app, so a value left in `.env` at build time cannot
 * move an operator's data. Must run before anything reads userData and
 * before `requestSingleInstanceLock()`.
 */
export const applyDevProfile = (): void => {
  if (app.isPackaged) return
  const profile = (import.meta.env.MAIN_VITE_DEV_PROFILE ?? '').toLowerCase().replace(/[^a-z0-9-]/g, '')
  if (!profile) return
  app.setPath('userData', `${app.getPath('userData')}-${profile}`)
}
