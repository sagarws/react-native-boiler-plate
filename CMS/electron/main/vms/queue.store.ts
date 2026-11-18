import { randomUUID } from 'node:crypto'
import { VMS_EVENTS } from '@shared/constants/channels'
import type { QueueCounts, QueueEntry, QueueEntryInput, QueueStatus } from '@shared/vms/queue'
import { dataDirectory } from '../database'
import { JsonCollection } from '../database/jsonStore'
import { broadcast } from '../ipc/broadcast'
import { logger } from '../services/logger'

/**
 * The VMS upload queue — Argos Watch's `queue_order_video` table, on the CMS's
 * JsonCollection instead of better-sqlite3 (no native modules here).
 *
 * Same columns, same types (file / files as JSON text, booleans as booleans),
 * plus `feedId`: the feed the recording was made under. An admin can switch
 * feeds, so the upload driver only sends the rows of the feed it holds.
 *
 * Status machine, unchanged from Argos:
 *   unsynced --> syncing --> synced  (happy path)
 *   syncing  --> unsynced (retry; retryCount += 1, restartCount += 1 when it reaches MAX_RETRIES)
 *   unsynced --> failed  (poison, once retryCount reaches MAX_RETRIES)
 */

export const MAX_RETRIES = 3

/**
 * Synced rows kept for the count. SQLite kept them for ever; a JSON file is
 * rewritten whole on every change, so the oldest synced rows beyond this are
 * dropped. Unsynced / syncing / failed rows are never dropped.
 */
export const MAX_SYNCED_ROWS = 500

export interface VmsQueueRow extends QueueEntry {
  feedId: string
}

/** Pure transitions over the row list — the JSON twin of Argos' queue.repository SQL. */
export const queueOps = {
  insert(rows: VmsQueueRow[], payload: QueueEntryInput, feedId: string, uuid: string): VmsQueueRow[] {
    const id = rows.reduce((max, row) => Math.max(max, row.id), 0) + 1
    const row: VmsQueueRow = {
      id,
      uuid,
      file: JSON.stringify(payload.file ?? null),
      trackingId: payload.trackingId,
      size: payload.size,
      length: payload.length,
      orderType: payload.orderType,
      files: JSON.stringify(payload.files ?? []),
      status: 'unsynced',
      orderCondition: payload.orderCondition ?? null,
      start_time: String(payload.start_time),
      keepOld: payload.keepOld,
      needRefund: payload.needRefund,
      errorMessage: '',
      eCommercePlatform: payload.eCommercePlatform ?? '',
      retryCount: 0,
      restartCount: 0,
      feedId
    }
    return [...rows, row]
  },

  setStatus(rows: VmsQueueRow[], uuid: string, status: QueueStatus): VmsQueueRow[] {
    const next = rows.map((row) => (row.uuid === uuid ? { ...row, status } : row))
    return status === 'synced' ? queueOps.pruneSynced(next) : next
  },

  markUnsynced(rows: VmsQueueRow[], uuid: string): VmsQueueRow[] {
    return rows.map((row) => {
      if (row.uuid !== uuid) return row
      const retryCount = (row.retryCount ?? 0) + 1
      const restartCount = retryCount === MAX_RETRIES ? (row.restartCount ?? 0) + 1 : (row.restartCount ?? 0)
      return { ...row, status: 'unsynced' as const, retryCount, restartCount }
    })
  },

  /** Back to unsynced WITHOUT spending a retry — the feed session ended mid-upload. */
  requeue(rows: VmsQueueRow[], uuid: string): VmsQueueRow[] {
    return rows.map((row) => (row.uuid === uuid && row.status === 'syncing' ? { ...row, status: 'unsynced' as const } : row))
  },

  markFailed(rows: VmsQueueRow[], uuid: string, errorMessage: string): VmsQueueRow[] {
    return rows.map((row) => (row.uuid === uuid ? { ...row, status: 'failed' as const, errorMessage } : row))
  },

  retryFailed(rows: VmsQueueRow[], uuid: string): VmsQueueRow[] {
    return rows.map((row) =>
      row.uuid === uuid && row.status === 'failed'
        ? { ...row, status: 'unsynced' as const, retryCount: 0, restartCount: 0, errorMessage: '' }
        : row
    )
  },

  deleteFailed(rows: VmsQueueRow[], uuid: string): { rows: VmsQueueRow[]; removed: number } {
    const next = rows.filter((row) => !(row.uuid === uuid && row.status === 'failed'))
    return { rows: next, removed: rows.length - next.length }
  },

  remapSyncing(rows: VmsQueueRow[]): { rows: VmsQueueRow[]; revived: number } {
    let revived = 0
    const next = rows.map((row) => {
      if (row.status !== 'syncing') return row
      revived += 1
      return { ...row, status: 'unsynced' as const }
    })
    return { rows: next, revived }
  },

  nextUnsynced(rows: readonly VmsQueueRow[], feedId: string): VmsQueueRow | null {
    let best: VmsQueueRow | null = null
    for (const row of rows) {
      if (row.status !== 'unsynced' || row.feedId !== feedId) continue
      if ((row.retryCount ?? 0) >= MAX_RETRIES) continue
      if (!best || row.id < best.id) best = row
    }
    return best
  },

  listByStatus(rows: readonly VmsQueueRow[], status: QueueStatus, feedId?: string): VmsQueueRow[] {
    return rows
      .filter((row) => row.status === status && (feedId === undefined || row.feedId === feedId))
      .sort((a, b) => b.id - a.id)
  },

  counts(rows: readonly VmsQueueRow[]): QueueCounts {
    const counts: QueueCounts = { unsynced: 0, syncing: 0, synced: 0, failed: 0 }
    for (const row of rows) {
      if (row.status in counts) counts[row.status] += 1
    }
    return counts
  },

  pruneSynced(rows: VmsQueueRow[]): VmsQueueRow[] {
    const synced = rows.filter((row) => row.status === 'synced')
    if (synced.length <= MAX_SYNCED_ROWS) return rows
    const drop = new Set(
      synced
        .sort((a, b) => a.id - b.id)
        .slice(0, synced.length - MAX_SYNCED_ROWS)
        .map((row) => row.uuid)
    )
    return rows.filter((row) => !drop.has(row.uuid))
  }
}

/** The JSON collection's name inside `dataDirectory()`. */
export const QUEUE_COLLECTION = 'vms-upload-queue'

let custom: JsonCollection<VmsQueueRow> | null = null
let ready: Promise<JsonCollection<VmsQueueRow>> | null = null

/** Test seam: run the store against a collection of the caller's choosing. */
export const useQueueCollection = (collection: JsonCollection<VmsQueueRow> | null): void => {
  custom = collection
  ready = null
}

/**
 * Opened on first use (VMS is lazy: a CMS-only operator never creates the
 * file). A row left `syncing` by a previous run cannot still be uploading, so
 * it goes back to `unsynced` — Argos did the same at database open.
 */
const open = (): Promise<JsonCollection<VmsQueueRow>> => {
  if (!ready) {
    const target = custom ?? new JsonCollection<VmsQueueRow>({ name: QUEUE_COLLECTION, directory: dataDirectory() })
    ready = target
      .mutate((rows) => {
        const { rows: next, revived } = queueOps.remapSyncing(rows)
        return { records: next, result: revived }
      })
      .then((revived) => {
        if (revived > 0) logger.info('[vms-queue] revived rows left syncing by a previous run', { revived })
        return target
      })
      .catch((error: unknown) => {
        ready = null
        throw error
      })
  }
  return ready
}

const publishCounts = async (): Promise<void> => {
  const store = await open()
  broadcast(VMS_EVENTS.queueCountsChanged, queueOps.counts(await store.read()))
}

const write = async <R>(change: (rows: VmsQueueRow[]) => { records: VmsQueueRow[]; result: R }): Promise<R> => {
  const store = await open()
  const result = await store.mutate(change)
  await publishCounts()
  return result
}

export const enqueue = (payload: QueueEntryInput, feedId: string): Promise<string> => {
  const uuid = randomUUID()
  return write((rows) => ({ records: queueOps.insert(rows, payload, feedId, uuid), result: uuid }))
}

const readRows = async (): Promise<VmsQueueRow[]> => (await open()).read()

export const nextUnsynced = async (feedId: string): Promise<VmsQueueRow | null> =>
  queueOps.nextUnsynced(await readRows(), feedId)

export const listPending = async (feedId?: string): Promise<VmsQueueRow[]> =>
  queueOps.listByStatus(await readRows(), 'unsynced', feedId)

export const listFailed = async (feedId?: string): Promise<VmsQueueRow[]> =>
  queueOps.listByStatus(await readRows(), 'failed', feedId)

export const counts = async (): Promise<QueueCounts> => queueOps.counts(await readRows())

export const markSyncing = (uuid: string): Promise<void> =>
  write((rows) => ({ records: queueOps.setStatus(rows, uuid, 'syncing'), result: undefined }))

export const markSynced = (uuid: string): Promise<void> =>
  write((rows) => ({ records: queueOps.setStatus(rows, uuid, 'synced'), result: undefined }))

export const markUnsynced = (uuid: string): Promise<void> =>
  write((rows) => ({ records: queueOps.markUnsynced(rows, uuid), result: undefined }))

export const requeue = (uuid: string): Promise<void> =>
  write((rows) => ({ records: queueOps.requeue(rows, uuid), result: undefined }))

export const markFailed = (uuid: string, errorMessage: string): Promise<void> =>
  write((rows) => ({ records: queueOps.markFailed(rows, uuid, errorMessage), result: undefined }))

export const retryFailed = (uuid: string): Promise<void> =>
  write((rows) => ({ records: queueOps.retryFailed(rows, uuid), result: undefined }))

export const deleteFailed = (uuid: string): Promise<boolean> =>
  write((rows) => {
    const { rows: next, removed } = queueOps.deleteFailed(rows, uuid)
    return { records: next, result: removed > 0 }
  })

/** Every file path a queued row still needs — so a sweep never deletes one. */
export const referencedPaths = async (): Promise<Set<string>> => {
  const paths = new Set<string>()
  for (const row of await readRows()) {
    if (row.status === 'synced') continue
    for (const raw of [row.file, row.files]) {
      try {
        const parsed: unknown = JSON.parse(raw || 'null')
        const refs = Array.isArray(parsed) ? parsed : [parsed]
        for (const ref of refs) {
          const path = (ref as { path?: unknown } | null)?.path
          if (typeof path === 'string') paths.add(path)
        }
      } catch {
        // A malformed column references nothing.
      }
    }
  }
  return paths
}
