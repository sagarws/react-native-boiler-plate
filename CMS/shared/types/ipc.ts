import type { Result } from './result'

/**
 * Platform identifiers are kept as a plain union (not NodeJS.Platform) because
 * the renderer type-checks without Node type definitions on purpose.
 */
export type PlatformName = 'win32' | 'darwin' | 'linux' | 'other'

export interface PlatformInfo {
  platform: PlatformName
  arch: string
  appVersion: string
  electronVersion: string
  isPackaged: boolean
}

/** Shape exposed on window by the preload bridge. */
export interface TrackVidBridge {
  invoke<T>(channel: string, payload?: unknown): Promise<Result<T>>
  /**
   * Listens to a main-process push. Returns an unsubscribe function that MUST be
   * called when the listener is no longer needed - see preload.ts.
   */
  subscribe(channel: string, listener: (payload: unknown) => void): () => void
  platform: PlatformInfo
  /**
   * Theme id the main process read from disk, available synchronously at first
   * paint. Empty string when it could not be determined; validate before use.
   */
  initialTheme: string
  /**
   * The operator's stored palette as JSON, or '' when there is none.
   *
   * A string rather than the object: argv carries strings, and parsing it in
   * the renderer keeps the preload free of the shape.
   */
  initialAppearance: string
}
