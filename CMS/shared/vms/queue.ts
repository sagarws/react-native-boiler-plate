/**
 * Sync-queue entry types shared between main, preload and renderer.
 *
 * Rows live in the userData `queue_order_video.db` (better-sqlite3). The row
 * layout matches TrackVid 1.1.x byte-for-byte so an existing installation can
 * be upgraded in place: userData survives auto-update, and a schema change
 * here means data loss or crash on first launch.
 */

/** Four terminal / in-flight states an upload progresses through. */
export const QUEUE_STATUSES = ['unsynced', 'syncing', 'synced', 'failed'] as const
export type QueueStatus = (typeof QUEUE_STATUSES)[number]

/**
 * Row shape after Nice-with-JavaScript normalisation (SQLite stores booleans
 * as 0/1 and JSON payloads as TEXT; those columns are unpacked at the
 * repository boundary).
 */
export interface QueueEntry {
  id: number
  uuid: string
  /** JSON-encoded reference to the primary video file on disk. */
  file: string
  trackingId: string
  size: number
  /** Duration in seconds. */
  length: number
  orderType: string
  /** JSON-encoded array of secondary files (screenshots, alt takes). */
  files: string
  status: QueueStatus
  orderCondition: number | null
  /** ISO string or epoch ms, stored as TEXT to survive the shipping-app quirks. */
  start_time: string
  keepOld: boolean
  needRefund: boolean
  errorMessage: string
  eCommercePlatform: string
  retryCount: number
  restartCount: number
}

/** Payload the recorder hands to insertQueueEntry. UUID + status are set here. */
export interface QueueEntryInput {
  file: unknown
  trackingId: string
  size: number
  length: number
  orderType: string
  files?: unknown
  orderCondition?: number | null
  start_time: string | number
  keepOld: boolean
  needRefund: boolean
  eCommercePlatform?: string
}

export interface QueueCounts {
  unsynced: number
  syncing: number
  synced: number
  failed: number
}
