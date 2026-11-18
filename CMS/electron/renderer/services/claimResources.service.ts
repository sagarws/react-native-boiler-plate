import { CLAIM_RESOURCE_CHANNELS } from '@shared/constants/channels'
import type { ClaimResourceRequest, ClaimResourceResult } from '@shared/types/claimResources'
import type { Result } from '@shared/types/result'
import { invoke } from './ipcClient'

/** Zips one claim's evidence for manual filing; main asks where to save it. */
export const downloadClaimResources = (request: ClaimResourceRequest): Promise<Result<ClaimResourceResult>> =>
  invoke<ClaimResourceResult>(CLAIM_RESOURCE_CHANNELS.download, request)
