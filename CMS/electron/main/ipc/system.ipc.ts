import { app, clipboard } from 'electron'
import { SYSTEM_CHANNELS } from '@shared/constants/channels'
import type { PlatformInfo } from '@shared/types/ipc'
import { fail, ok } from '@shared/types/result'
import { platform } from '../platform'
import { importChromeDriver, runBrowserCheck } from '../services/browserCheck.service'
import { homeRendered } from '../services/startupGate.service'
import { registerHandler } from './handler'

export const buildPlatformInfo = (): PlatformInfo => ({
  platform: platform.name,
  arch: process.arch,
  appVersion: app.getVersion(),
  electronVersion: process.versions.electron ?? 'unknown',
  isPackaged: app.isPackaged
})

export const registerSystemIpc = (): void => {
  registerHandler(SYSTEM_CHANNELS.getPlatformInfo, () => Promise.resolve(ok(buildPlatformInfo())))
  registerHandler(SYSTEM_CHANNELS.homeRendered, () => {
    homeRendered()

    return Promise.resolve(ok(true))
  })

  registerHandler(SYSTEM_CHANNELS.copyText, (payload) => {
    const text = typeof (payload as { text?: unknown })?.text === 'string'
      ? ((payload as { text: string }).text)
      : ''

    if (!text) return Promise.resolve(fail('VALIDATION_ERROR', 'Nothing to copy'))

    clipboard.writeText(text)

    return Promise.resolve(ok({ length: text.length }))
  })

  // No payload to validate: the check takes nothing from the renderer.
  registerHandler(SYSTEM_CHANNELS.checkBrowser, () => runBrowserCheck())
  // No payload either: the file comes from the main process's own dialog.
  registerHandler(SYSTEM_CHANNELS.importChromeDriver, () => importChromeDriver())
}
