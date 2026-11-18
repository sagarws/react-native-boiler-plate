import { IMPORT_SCHEDULE_CHANNELS, IMPORT_SCHEDULE_EVENTS } from '@shared/constants/channels'
import type { ImportScheduleState } from '@shared/types/importSchedule'
import type { Result } from '@shared/types/result'
import { invoke, subscribe } from './ipcClient'

/** Renderer-side wrapper over the import-schedule channels. */

export const scheduleState = (): Promise<Result<ImportScheduleState>> =>
  invoke<ImportScheduleState>(IMPORT_SCHEDULE_CHANNELS.state)

export const refreshSchedule = (): Promise<Result<ImportScheduleState>> =>
  invoke<ImportScheduleState>(IMPORT_SCHEDULE_CHANNELS.refresh)

/** `null` turns the schedule off. */
export const setSyncTime = (syncTime: string | null): Promise<Result<ImportScheduleState>> =>
  invoke<ImportScheduleState>(IMPORT_SCHEDULE_CHANNELS.setTime, { syncTime })

export const onScheduleChanged = (listener: (state: ImportScheduleState) => void): (() => void) =>
  subscribe(IMPORT_SCHEDULE_EVENTS.state, payload => listener(payload as ImportScheduleState))
