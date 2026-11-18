import { CLOSE_GUARD_CHANNELS, CLOSE_GUARD_EVENTS } from '@shared/constants/channels'
import type { CloseGuardQuit, CloseGuardRequest } from '@shared/types/closeGuard'
import type { Result } from '@shared/types/result'
import { invoke, subscribe } from './ipcClient'

export const closeGuardClient = {
  /** Tells main the dialog is on screen, so it does not fall back to the system box. */
  ack: (): Promise<Result<null>> => invoke<null>(CLOSE_GUARD_CHANNELS.ack),
  /** Stop the scheduler between steps and close the app. */
  quit: (payload: CloseGuardQuit): Promise<Result<null>> =>
    invoke<null>(CLOSE_GUARD_CHANNELS.quit, payload),
  /** Returns an unsubscribe function; callers must invoke it on unmount. */
  onRequested: (listener: (request: CloseGuardRequest) => void): (() => void) =>
    subscribe(CLOSE_GUARD_EVENTS.requested, (payload) => listener(payload as CloseGuardRequest))
}
