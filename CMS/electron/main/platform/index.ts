import { fallbackAdapter } from './fallback'
import { macosAdapter } from './macos'
import { windowsAdapter } from './windows'
import type { PlatformAdapter } from './types'

const resolveAdapter = (): PlatformAdapter => {
  switch (process.platform) {
    case 'win32':
      return windowsAdapter
    case 'darwin':
      return macosAdapter
    default:
      return fallbackAdapter
  }
}

export const platform: PlatformAdapter = resolveAdapter()

export const isWindows = platform.name === 'win32'
export const isMac = platform.name === 'darwin'

export type { PlatformAdapter }
