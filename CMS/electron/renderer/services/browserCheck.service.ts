import { SYSTEM_CHANNELS } from '@shared/constants/channels'
import type { BrowserCheck } from '@shared/types/browserCheck'
import type { Result } from '@shared/types/result'
import { invoke } from './ipcClient'

/** Is the operator's Chrome installed, with a matching chromedriver? */
export const checkBrowser = (): Promise<Result<BrowserCheck>> =>
  invoke<BrowserCheck>(SYSTEM_CHANNELS.checkBrowser)

/** Picks a downloaded ChromeDriver, installs it, and answers with a fresh check. */
export const importChromeDriver = (): Promise<Result<BrowserCheck>> =>
  invoke<BrowserCheck>(SYSTEM_CHANNELS.importChromeDriver)
