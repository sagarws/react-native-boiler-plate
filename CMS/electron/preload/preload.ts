import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { isAllowedChannel, isAllowedEventChannel } from '@shared/constants/channels'
import type { PlatformInfo, TrackVidBridge } from '@shared/types/ipc'
import type { Result } from '@shared/types/result'

/**
 * The only bridge between React and Electron.
 *
 * It exposes two functions plus static platform data - no ipcRenderer, no
 * require, no fs, no child_process. Channels are checked against the shared
 * allowlist here as well as in the main process.
 *
 * This file must stay CommonJS-compatible and free of Node APIs: the window runs
 * with sandbox: true.
 */
const invoke = async <T>(channel: string, payload?: unknown): Promise<Result<T>> => {
  if (!isAllowedChannel(channel)) {
    // Almost always a stale preload: the bundle is loaded once when the window
    // is created, so a channel added since launch is absent until restart.
    // "Request rejected" read like the server had refused the operation, which
    // sent a debugging session after the wrong thing entirely.
    return {
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: `"${channel}" is not available in this build. Restart the app; if it persists, the app needs updating.`
      }
    }
  }

  try {
    return (await ipcRenderer.invoke(channel, payload)) as Result<T>
  } catch {
    // Reaching here means the main process handler is missing or the app is
    // shutting down; surface it as a normal Result rather than a rejection.
    return { success: false, error: { code: 'INTERNAL_ERROR', message: 'The application is not responding. Please restart it.' } }
  }
}

/**
 * One-way subscription to a main-process push.
 *
 * Deliberately narrow: the channel must be on the *event* allowlist, which is
 * disjoint from the invoke allowlist, so this can never be used to call a
 * handler. The raw IpcRendererEvent is dropped rather than forwarded - it
 * carries a `sender` that would hand the renderer a way back into the main
 * process, which is exactly what contextIsolation exists to prevent.
 *
 * Returns an unsubscribe function; React components must call it on unmount or
 * the listener outlives the component.
 */
const subscribe = (channel: string, listener: (payload: unknown) => void): (() => void) => {
  if (!isAllowedEventChannel(channel)) return () => undefined

  const handler = (_event: IpcRendererEvent, payload: unknown): void => listener(payload)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

/**
 * The theme the main process loaded from disk, passed through argv by
 * mainWindow's additionalArguments. Read synchronously so the very first paint
 * already uses it - no flash of the default theme on launch.
 *
 * Wrapped: process.argv is available to a sandboxed preload, but this must not
 * be the thing that stops the bridge from being exposed if that ever changes.
 */
const readInitialTheme = (): string => {
  try {
    const prefix = '--initial-theme='
    const match = process.argv.find((argument) => argument.startsWith(prefix))
    return match ? match.slice(prefix.length) : ''
  } catch {
    return ''
  }
}

/**
 * Only the fields a sandboxed preload can read are filled in here. Version and
 * packaging details come from the main process over system:platform-info.
 */
const platformName = (): PlatformInfo['platform'] => {
  switch (process.platform) {
    case 'win32':
      return 'win32'
    case 'darwin':
      return 'darwin'
    case 'linux':
      return 'linux'
    default:
      return 'other'
  }
}

const platform: PlatformInfo = {
  platform: platformName(),
  arch: process.arch,
  appVersion: '',
  electronVersion: process.versions.electron ?? '',
  isPackaged: false
}

/** Same shape as the theme above, and the same reason: no flash at launch. */
const readArgument = (prefix: string): string => {
  try {
    const match = process.argv.find((argument) => argument.startsWith(prefix))

    return match ? decodeURIComponent(match.slice(prefix.length)) : ''
  } catch {
    return ''
  }
}

const bridge: TrackVidBridge = {
  invoke,
  subscribe,
  platform,
  initialTheme: readInitialTheme(),
  initialAppearance: readArgument('--initial-appearance=')
}

contextBridge.exposeInMainWorld('trackvid', bridge)
