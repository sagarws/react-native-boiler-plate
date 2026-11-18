import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import { isAllowedChannel } from '@shared/constants/channels'
import { fail, type Result } from '@shared/types/result'
import { logger } from '../services/logger'

/**
 * Every IPC handler goes through here. It guarantees three things:
 *   1. the channel is on the shared allowlist (so preload and main cannot drift),
 *   2. the call comes from a frame this app created,
 *   3. a thrown error becomes a safe Result instead of an unhandled rejection.
 */
const allowedOrigins = new Set<string>()

export const allowIpcOrigin = (origin: string): void => {
  allowedOrigins.add(origin)
}

const isTrustedSender = (event: IpcMainInvokeEvent): boolean => {
  const url = event.senderFrame?.url
  if (!url) return false
  if (url.startsWith('file://')) return true
  return [...allowedOrigins].some((origin) => url.startsWith(origin))
}

export const registerHandler = <T>(
  channel: string,
  handler: (payload: unknown) => Promise<Result<T>>
): void => {
  if (!isAllowedChannel(channel)) {
    throw new Error(`Channel "${channel}" is not declared in shared/constants/channels.ts`)
  }

  ipcMain.handle(channel, async (event, payload: unknown): Promise<Result<T>> => {
    if (!isTrustedSender(event)) {
      logger.warn('Rejected IPC call from untrusted sender', { channel, url: event.senderFrame?.url })
      // Distinct wording from preload's allowlist rejection so the two are
      // told apart from the message alone.
      return fail('INTERNAL_ERROR', 'This request came from an untrusted window and was blocked.')
    }

    try {
      return await handler(payload)
    } catch (error) {
      logger.error(`Unhandled error in IPC channel ${channel}`, error)
      return fail('INTERNAL_ERROR', 'Something went wrong. Please try again.')
    }
  })
}
