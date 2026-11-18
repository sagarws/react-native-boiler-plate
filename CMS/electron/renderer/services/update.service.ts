import { UPDATE_CHANNELS, UPDATE_EVENTS } from '@shared/constants/channels'
import type { Result } from '@shared/types/result'
import type { UpdateLogEntry, UpdateState } from '@shared/types/update'
import { invoke, subscribe } from './ipcClient'

export const updateClient = {
  /** Current state, for a component that mounted after the first events fired. */
  status: (): Promise<Result<UpdateState>> => invoke<UpdateState>(UPDATE_CHANNELS.status),
  check: (): Promise<Result<UpdateState>> => invoke<UpdateState>(UPDATE_CHANNELS.check),
  install: (): Promise<Result<{ installing: boolean }>> =>
    invoke<{ installing: boolean }>(UPDATE_CHANNELS.install),
  /** Download this release again and reinstall it — the app quits and relaunches. */
  reinstall: (): Promise<Result<{ version: string }>> => invoke<{ version: string }>(UPDATE_CHANNELS.reinstall),
  /** What the updater did and saw, for the details dialog on a failure. */
  log: (): Promise<Result<UpdateLogEntry[]>> => invoke<UpdateLogEntry[]>(UPDATE_CHANNELS.log),
  /** Returns an unsubscribe function; callers must invoke it on unmount. */
  onStatusChange: (listener: (state: UpdateState) => void): (() => void) =>
    subscribe(UPDATE_EVENTS.status, (payload) => listener(payload as UpdateState))
}
