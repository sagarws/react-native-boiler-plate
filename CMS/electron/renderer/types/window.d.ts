import type { TrackVidBridge } from '@shared/types/ipc'

declare global {
  interface Window {
    /** Injected by electron/preload/preload.ts via contextBridge. */
    trackvid: TrackVidBridge
  }
}

export {}
