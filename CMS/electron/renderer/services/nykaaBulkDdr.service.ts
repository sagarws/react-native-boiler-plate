import { NYKAA_BULK_DDR_CHANNELS, NYKAA_BULK_DDR_EVENTS } from '@shared/constants/channels'
import type { NykaaDdrRun, NykaaDdrUpload } from '@shared/types/nykaaBulkDdr'
import type { Result } from '@shared/types/result'
import { invoke, subscribe } from './ipcClient'

/** Renderer-side wrapper over the Nykaa DDR bulk claim channels. */

export const chooseDdrFile = (): Promise<Result<NykaaDdrUpload>> =>
  invoke<NykaaDdrUpload>(NYKAA_BULK_DDR_CHANNELS.chooseFile)

export const downloadDdrTemplate = (): Promise<Result<{ path: string }>> =>
  invoke<{ path: string }>(NYKAA_BULK_DDR_CHANNELS.downloadTemplate)

/** Files the sheet in the background; progress arrives through `onDdrProgress`. */
export const startDdrRun = (upload: NykaaDdrUpload): Promise<Result<NykaaDdrRun>> =>
  invoke<NykaaDdrRun>(NYKAA_BULK_DDR_CHANNELS.start, { upload })

/** Files every row of the last run without a ticket again, into that same run. */
export const retryDdrRun = (): Promise<Result<NykaaDdrRun>> => invoke<NykaaDdrRun>(NYKAA_BULK_DDR_CHANNELS.retry)

export const ddrRunStatus = (): Promise<Result<NykaaDdrRun | null>> =>
  invoke<NykaaDdrRun | null>(NYKAA_BULK_DDR_CHANNELS.status)

export const openDdrReport = (): Promise<Result<null>> => invoke<null>(NYKAA_BULK_DDR_CHANNELS.openReport)

/** Follows a run — the main process pushes every row as it finishes. */
export const onDdrProgress = (listener: (run: NykaaDdrRun) => void): (() => void) =>
  subscribe(NYKAA_BULK_DDR_EVENTS.progress, payload => listener(payload as NykaaDdrRun))
