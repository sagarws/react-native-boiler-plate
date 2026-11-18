import { CLAIM_QUEUE_CHANNELS, CLAIM_QUEUE_EVENTS } from '@shared/constants/channels'
import type {
  BlockedAccount,
  ClaimDispatch,
  ClaimSocketState,
  ClaimStatusTab,
  ClaimSupport,
  QueuedClaim
} from '@shared/types/claimQueue'
import type { ClaimBatchProgress } from '@shared/types/claimQueue'
import type { Result } from '@shared/types/result'
import { invoke, subscribe } from './ipcClient'

/** Renderer-side wrapper over the claim-queue channels. */

export const listClaims = (): Promise<Result<QueuedClaim[]>> =>
  invoke<QueuedClaim[]>(CLAIM_QUEUE_CHANNELS.list)

export const socketState = (): Promise<Result<ClaimSocketState>> =>
  invoke<ClaimSocketState>(CLAIM_QUEUE_CHANNELS.socketState)

/**
 * Which platforms this machine may file a claim for — and, when it may not,
 * enough to say why.
 */
export const supportedPlatforms = (): Promise<Result<ClaimSupport>> =>
  invoke<ClaimSupport>(CLAIM_QUEUE_CHANNELS.supported)

/**
 * Which of these accounts the marketplace will not accept right now.
 *
 * Asked before a batch starts, because the stored-expiry check this page runs
 * first cannot see a session that is still in date and no longer works — the
 * case where a run opens a browser, lands on a logged-out page and signs in
 * per account for the length of the batch.
 *
 * One probe per distinct account; it costs a round trip, and the batch behind
 * it costs dozens.
 */
export const checkClaimSessions = (
  accounts: readonly { platform: string; username: string }[],
  { directApiCall = false }: { directApiCall?: boolean } = {}
): Promise<Result<BlockedAccount[]>> =>
  invoke<BlockedAccount[]>(CLAIM_QUEUE_CHANNELS.sessionCheck, { accounts, directApiCall })

/**
 * The status tabs each platform uses — Myntra's payout states, AJIO's full
 * workflow, the base five for everyone else. Read from the core's registry via
 * the main process so this app and the admin panel cannot drift.
 */
export const claimStatusTabs = (
  platforms: readonly string[]
): Promise<Result<Record<string, ClaimStatusTab[]>>> =>
  invoke<Record<string, ClaimStatusTab[]>>(CLAIM_QUEUE_CHANNELS.statusTabs, {
    platforms: [...platforms]
  })

/**
 * Files one claim. Slow — it logs in, uploads evidence and raises the dispute —
 * so the caller keeps the row in a running state for the whole wait.
 */
/**
 * Files a selection of claims. ONE call for the whole batch, deliberately:
 * the loop lives in the main process so it can hold the automation lock and a
 * single browser across every claim in it.
 */
export const processClaims = (
  claims: { cmsId: string; platform?: string; awbNumber?: string; username?: string }[]
): Promise<Result<{ done: number; failed: number; failures: string[] }>> =>
  invoke<{ done: number; failed: number; failures: string[] }>(CLAIM_QUEUE_CHANNELS.process, {
    claims
  })

/**
 * Fires when a claim this machine had not seen before is stored.
 *
 * Carries the dispatch, not the stored row — the caller re-reads the list, so
 * what it renders is always what is actually on disk rather than a payload that
 * might have lost a race with a status change.
 */
export const onClaimReceived = (listener: (dispatch: ClaimDispatch) => void): (() => void) =>
  subscribe(CLAIM_QUEUE_EVENTS.claimReceived, payload => listener(payload as ClaimDispatch))

/** Fires whenever a queued claim moves — running, succeeded, failed. */
export const onClaimStatusChanged = (listener: (claim: QueuedClaim) => void): (() => void) =>
  subscribe(CLAIM_QUEUE_EVENTS.claimStatusChanged, payload => listener(payload as QueuedClaim))

export const onSocketStateChanged = (listener: (state: ClaimSocketState) => void): (() => void) =>
  subscribe(CLAIM_QUEUE_EVENTS.socketState, payload => listener(payload as ClaimSocketState))

/** Progress of a Create Ticket batch, for the background-work panel. */
export const onClaimBatchProgress = (
  listener: (progress: ClaimBatchProgress) => void
): (() => void) =>
  subscribe(CLAIM_QUEUE_EVENTS.batchProgress, payload =>
    listener(payload as ClaimBatchProgress)
  )
