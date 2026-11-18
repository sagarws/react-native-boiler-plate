import type { ClaimDispatch, QueuedClaim, QueuedClaimStatus } from '@shared/types/claimQueue'
import { dataDirectory } from '../database'
import { JsonCollection } from '../database/jsonStore'
import { logger } from './logger'
import { broadcast } from '../ipc/broadcast'
import { CLAIM_QUEUE_EVENTS } from '@shared/constants/channels'

/**
 * The local claim queue.
 *
 * Claims routed to this machine are written to disk the moment they arrive,
 * before anything tries to process them. That ordering is the point: a claim
 * that reached the app and was lost to a crash is worse than one that never
 * arrived, because the server has already recorded it as dispatched and will
 * not send it again.
 *
 * Backed by JsonCollection — atomic writes and a serialised mutation queue, so
 * two dispatches landing together cannot interleave a read-modify-write.
 */

const COLLECTION = 'claim-queue'

let collection: JsonCollection<QueuedClaim> | null = null

export const initialiseClaimQueue = (): void => {
  collection = new JsonCollection<QueuedClaim>({
    name: COLLECTION,
    directory: dataDirectory()
  })
}

const store = (): JsonCollection<QueuedClaim> => {
  if (!collection) throw new Error('Claim queue used before initialiseClaimQueue()')

  return collection
}

/**
 * Two claims are the same claim when they are for the same AWB on the same
 * platform.
 *
 * The AWB is what is unique in this process — it is the parcel the dispute is
 * about, and the marketplace will only accept one dispute for it. `cmsId` is
 * not a safe key on its own: the same AWB can be re-created as a NEW row after
 * an edit or a re-import, and keying on the id would leave this machine holding
 * two records for one parcel and filing it twice.
 *
 * Platform is part of the key because AWB formats are not globally unique
 * across marketplaces.
 *
 * Falls back to the cmsId when a dispatch carries no AWB, so a malformed
 * message still cannot collapse every claim into one.
 */
const identity = (claim: { platform?: string; awbNumber?: string; cmsId: string }): string => {
  const awb = String(claim.awbNumber || '').trim().toUpperCase()

  if (!awb) return `id:${claim.cmsId}`

  return `${String(claim.platform || '').toLowerCase().trim()}:${awb}`
}

/**
 * Stores a dispatched claim, REPLACING any earlier one for the same AWB.
 *
 * The newest message wins. A re-dispatch means the backend has said something
 * new about that parcel — the row was edited, re-created, or simply re-sent on
 * reconnect — and the record this machine acts on should be the current one.
 * Keeping the first and dropping the rest would leave the app filing against a
 * stale cmsId whose row the backend may have already replaced.
 *
 * ONE EXCEPTION, and it is not negotiable: a claim that is RUNNING is left
 * alone. A runner is mid-flight against that AWB — it may already have uploaded
 * evidence or raised the dispute — and swapping the record underneath it would
 * both corrupt the run's own bookkeeping and risk a second dispute for the same
 * parcel. Uniqueness of the AWB is precisely why a second run must not start.
 *
 * @returns whether this call left something new for the runner to work
 */
export const recordDispatch = async (dispatch: ClaimDispatch): Promise<boolean> =>
  store().mutate(records => {
    const cmsId = String(dispatch.cmsId || '').trim()

    if (!cmsId) {
      logger.warn('Ignoring claim dispatch with no cmsId', dispatch)

      return { records, result: false }
    }

    const key = identity({ ...dispatch, cmsId })
    const existing = records.find(record => identity(record) === key)

    if (existing?.status === 'running') {
      logger.warn(
        `A claim for ${dispatch.platform} AWB ${dispatch.awbNumber ?? cmsId} is already running ` +
          `(${existing.cmsId}) — not replacing it mid-run`
      )

      return { records, result: false }
    }

    const now = new Date().toISOString()
    const claim: QueuedClaim = {
      ...dispatch,
      cmsId,
      status: 'received',
      receivedAt: now,
      updatedAt: now
    }

    if (existing) {
      logger.info(
        `Replacing the queued claim for ${dispatch.platform} AWB ${dispatch.awbNumber ?? '(none)'} ` +
          `— ${existing.cmsId} (${existing.status}) → ${cmsId}`
      )

      return {
        records: records.map(record => (identity(record) === key ? claim : record)),
        result: true
      }
    }

    logger.info(`Queued claim ${cmsId} (${dispatch.platform}) locally`)

    return { records: [...records, claim], result: true }
  })

export const listClaims = async (): Promise<QueuedClaim[]> => {
  const records = await store().read()

  // Newest first: an operator watching claims arrive wants the last one at the
  // top, not buried under everything the machine has ever processed.
  return [...records].sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))
}

export const setStatus = async (
  cmsId: string,
  status: QueuedClaimStatus,
  extra: { error?: string; ticketId?: string } = {}
): Promise<boolean> => {
  const next = await store().mutate<QueuedClaim | null>(records => {
    const index = records.findIndex(record => record.cmsId === cmsId)

    if (index === -1) return { records, result: null }

    const current = records[index]

    if (!current) return { records, result: null }

    const updated = [...records]

    updated[index] = {
      ...current,
      status,
      updatedAt: new Date().toISOString(),
      ...(extra.error === undefined ? {} : { error: extra.error }),
      ...(extra.ticketId === undefined ? {} : { ticketId: extra.ticketId })
    }

    return { records: updated, result: updated[index] }
  })

  if (!next) return false

  // Told, not polled. The auto-runner moves claims with no user action, so a
  // screen that only refetches on demand would show a stale row for the whole
  // run.
  //
  // AFTER the write, not inside it. This used to fire from within the mutation,
  // before the records were persisted — so a listener that reacted by re-READING
  // the queue could get the state from before the change. It then had no reason
  // to look again, and showed a finished claim as running until something else
  // happened to move it.
  broadcast(CLAIM_QUEUE_EVENTS.claimStatusChanged, next)

  return true
}

/**
 * Drops finished claims older than `days`.
 *
 * Only terminal states are removed. A claim stuck in `running` is exactly what
 * someone needs to see, so age alone never clears one.
 */
export const pruneFinished = async (days = 14): Promise<number> => {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000

  return store().mutate(records => {
    const kept = records.filter(record => {
      const terminal = record.status === 'succeeded' || record.status === 'failed'

      if (!terminal) return true

      return Date.parse(record.updatedAt) > cutoff
    })

    return { records: kept, result: records.length - kept.length }
  })
}

/**
 * Stamps `lastBeatAt` on a running claim.
 *
 * Separate from `setStatus` because it must NOT move `updatedAt`: that field is
 * how a stuck claim is spotted, and a tick every 30 seconds would make every
 * run look freshly updated right up until it died.
 */
export const touchRun = async (cmsId: string): Promise<boolean> =>
  store().mutate(records => {
    const index = records.findIndex(record => record.cmsId === cmsId)
    const current = records[index]

    if (index === -1 || !current) return { records, result: false }

    const updated = [...records]

    updated[index] = { ...current, lastBeatAt: new Date().toISOString() }

    return { records: updated, result: true }
  })
