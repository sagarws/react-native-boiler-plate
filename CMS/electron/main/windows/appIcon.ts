import { join } from 'node:path'
import { app } from 'electron'

/**
 * Where the product mark lives on disk, for the places the OS draws it.
 *
 * ONLY WHEN UNPACKAGED, and that is the whole subtlety. A packaged build does
 * not need this: electron-builder turns `build/icon.png` into the .icns inside
 * the .app bundle and the icon resource inside the .exe, and the OS reads those
 * directly. `build/` is a build resource, so it is not inside the asar either —
 * pointing at it from a packaged app would resolve to nothing.
 *
 * What it fixes is the run an operator actually sees during development, where
 * the dock and the taskbar fall back to Electron's own atom.
 *
 * `app.getAppPath()` rather than a written-out path: this file has no idea
 * where the checkout lives, and must not.
 */
export const devAppIconPath = (): string | undefined =>
  app.isPackaged ? undefined : join(app.getAppPath(), 'build', 'icon.png')
