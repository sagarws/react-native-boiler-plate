import { SYSTEM_CHANNELS } from '@shared/constants/channels'
import type { Result } from '@shared/types/result'
import { invoke } from './ipcClient'

/**
 * Tells the main process the home page has rendered. Background work queued at
 * launch and at sign-in starts a few seconds after this (startupGate.service).
 */
export const reportHomeRendered = (): Promise<Result<boolean>> => invoke<boolean>(SYSTEM_CHANNELS.homeRendered)
