import type { Result } from '@shared/types/result'

/**
 * The single point where the renderer touches the preload bridge. No component
 * calls window.trackvid directly, which keeps the surface auditable and makes
 * the whole UI testable against a stub.
 */
export const invoke = async <T>(channel: string, payload?: unknown): Promise<Result<T>> => {
  const bridge = window.trackvid
  if (!bridge) {
    return {
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Application bridge unavailable. Please restart the app.' }
    }
  }
  return bridge.invoke<T>(channel, payload)
}

/**
 * Subscribes to a main-process push. Returns an unsubscribe function - always a
 * callable, even when the bridge is missing, so callers can use it in a React
 * cleanup without a null check.
 */
export const subscribe = (channel: string, listener: (payload: unknown) => void): (() => void) => {
  const bridge = window.trackvid
  if (!bridge) return () => undefined
  return bridge.subscribe(channel, listener)
}

export const platformInfo = (): typeof window.trackvid.platform | null => window.trackvid?.platform ?? null
