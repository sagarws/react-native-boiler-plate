import { SYSTEM_CHANNELS } from '@shared/constants/channels'
import type { Result } from '@shared/types/result'
import { invoke } from './ipcClient'

/**
 * Putting text on the clipboard, from the main process.
 *
 * `navigator.clipboard.writeText` is REFUSED in this renderer — it is not a
 * secure context in the browser's sense, so the permission is denied and the
 * only sign of it is "Write permission denied" at the moment somebody presses
 * a button. Electron's own clipboard has no such notion, and the main process
 * is the only place that can reach it.
 */
export const copyToClipboard = (text: string): Promise<Result<{ length: number }>> =>
  invoke<{ length: number }>(SYSTEM_CHANNELS.copyText, { text })
