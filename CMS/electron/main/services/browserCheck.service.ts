import { dialog } from 'electron'
import { realChromeBinaryPath } from '@trackvid/automation-core/platforms/myntra/common/chromeBinary'
import type { BrowserCheck } from '@shared/types/browserCheck'
import { fail, ok, type Result } from '@shared/types/result'
import {
  chromeVersionOf,
  driverDownloadUrlFor,
  ensureDriverFor,
  importDriverFile
} from './browserProvision.service'
import { logger } from './logger'

/**
 * Checks the two things Myntra's sign-in needs from this machine: the
 * operator's installed Google Chrome, and a chromedriver of its major version.
 *
 * WHY ASK BEFORE A CAPTURE. Without either, the core quietly falls back to the
 * pinned Chrome for Testing — the window with the "only for automated testing"
 * banner — and Myntra answers it with "Network Error", which reads as a network
 * problem rather than a browser one. Asked once the operator is in the app, the
 * rail can say what is missing while there is still time to install it.
 *
 * The driver half is `ensureDriverFor`, the same call a capture makes: it
 * fetches the driver into the app's cache when it is missing, so a "ready"
 * here is the driver a capture will actually use, not a guess about it.
 *
 * Never throws and never fails: a check that cannot run reports "not found",
 * which is the answer that sends the operator to the install links.
 */
export interface BrowserCheckDeps {
  findChrome: () => string | null
  versionOf: (binary: string) => Promise<string | null>
  driverFor: (binary: string) => Promise<string | null>
  downloadUrlFor: (version: string) => Promise<string | null>
  now: () => Date
}

const defaultDeps: BrowserCheckDeps = {
  findChrome: () => realChromeBinaryPath(),
  versionOf: chromeVersionOf,
  driverFor: ensureDriverFor,
  downloadUrlFor: driverDownloadUrlFor,
  now: () => new Date()
}

export const runBrowserCheck = async (
  deps: BrowserCheckDeps = defaultDeps
): Promise<Result<BrowserCheck>> => {
  let path: string | null = null
  let version: string | null = null
  let driverReady = false
  let downloadUrl: string | null = null

  try {
    path = deps.findChrome()

    if (path) {
      version = await deps.versionOf(path)
      driverReady = Boolean(await deps.driverFor(path))

      // Only worth knowing when the operator has to fetch it themselves.
      if (!driverReady && version) downloadUrl = await deps.downloadUrlFor(version)
    }
  } catch (error) {
    logger.warn('Browser check could not complete', error)
  }

  const check: BrowserCheck = {
    chrome: { found: Boolean(path), path, version },
    driver: { ready: driverReady, downloadUrl },
    checkedAt: deps.now().toISOString()
  }

  if (!check.chrome.found) logger.warn('Browser check: no installed Google Chrome found')
  else if (!check.driver.ready) {
    logger.warn(`Browser check: no chromedriver for Chrome ${version ?? '(unknown version)'}`)
  } else logger.info(`Browser check: Chrome ${version ?? ''} and its chromedriver are ready`)

  return ok(check)
}

/**
 * The operator picks the ChromeDriver they downloaded; it is installed where
 * the check looks, and the check runs again so the rail updates at once.
 *
 * The path comes from the main process's own dialog, never from the renderer.
 */
export const importChromeDriver = async (): Promise<Result<BrowserCheck>> => {
  const binary = realChromeBinaryPath()
  const version = binary ? await chromeVersionOf(binary) : null

  if (!binary || !version) {
    return fail('NOT_FOUND', 'Google Chrome was not found, so there is no version to match.')
  }

  const chosen = await dialog.showOpenDialog({
    title: 'Choose the ChromeDriver you downloaded',
    properties: ['openFile'],
    // "All files" too: the macOS binary has no extension.
    filters: [
      { name: 'ChromeDriver (zip or program)', extensions: ['zip', 'exe'] },
      { name: 'All files', extensions: ['*'] }
    ]
  })
  const file = chosen.filePaths[0]

  if (chosen.canceled || !file) return fail('VALIDATION_ERROR', 'Cancelled')

  const result = await importDriverFile(file, version.split('.')[0] ?? version)

  if (!result.imported) return fail('VALIDATION_ERROR', result.reason)

  return runBrowserCheck()
}
