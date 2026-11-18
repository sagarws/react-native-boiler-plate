import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { isMac, isWindows } from '../platform'
import { logger } from './logger'
import { unpacked } from './mediaTools.service'

const load = createRequire(import.meta.url)

/**
 * Where selenium-manager is on THIS machine, told to selenium-webdriver once at
 * startup.
 *
 * The same asar problem as ffmpeg (see mediaTools.service). selenium-webdriver
 * finds its manager next to its own files — inside app.asar in a packaged app —
 * and runs it with `spawnSync`, which, unlike `execFile`, Electron does NOT
 * redirect to app.asar.unpacked. The spawn fails, its result has no stdout, and
 * every script-based claim died with "Unable to obtain browser driver … Cannot
 * read properties of undefined (reading 'toString')" before a browser opened.
 *
 * `SE_MANAGER_PATH` is selenium-webdriver's own override, read before it looks
 * beside itself. An explicitly set value wins.
 */
export const initialiseSeleniumManager = (): void => {
  if (process.env['SE_MANAGER_PATH']) return

  try {
    const root = dirname(load.resolve('selenium-webdriver/package.json'))
    const binary = isWindows
      ? join('windows', 'selenium-manager.exe')
      : join(isMac ? 'macos' : 'linux', 'selenium-manager')
    const real = unpacked(join(root, 'bin', binary))

    if (!existsSync(real)) {
      logger.warn(`[selenium] selenium-manager is declared at ${real} but is not there`)

      return
    }

    process.env['SE_MANAGER_PATH'] = real
  } catch {
    // Not installed: script-based flows report their own error when they start.
  }
}
