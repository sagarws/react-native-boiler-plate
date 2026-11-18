import { dataDirectory } from '../database'
import { JsonCollection } from '../database/jsonStore'
import { logger } from './logger'

/**
 * Reports requested from a marketplace but not yet downloaded.
 *
 * Persisted rather than held in memory: a report can take twenty minutes to
 * build, and an operator closing the app in between should not silently lose
 * it — the request has already been made, and requesting it again produces a
 * duplicate report rather than a faster one.
 *
 * No secrets here. The password is fetched fresh from the backend for each
 * attempt, so a queue entry is only enough to identify WHICH report to collect,
 * never enough to sign in on its own.
 */

export interface QueuedReport {
  /** `<platform>:<credentialId>:<importType>` — one pending report per combination. */
  key: string
  platform: string
  credentialId: string
  username: string
  companyId: string
  trackVidEmail: string
  importType: string
  /** What the portal calls it, for finding its row. */
  portalReportName: string
  /** What TrackVid calls it, for the upload. */
  trackvidReportType: string
  /** Identifies THIS request among others of the same type. */
  initiationText: string
  requestedAt: number
  /** Last time a download was attempted, for pacing. */
  lastCheckedAt: number | null
  attempts: number
}

let collection: JsonCollection<QueuedReport> | null = null

export const initialiseMasterImportQueue = (): void => {
  collection = new JsonCollection<QueuedReport>({
    name: 'master-import-queue',
    directory: dataDirectory()
  })
}

const store = (): JsonCollection<QueuedReport> => {
  if (!collection) throw new Error('Master import queue used before initialisation')

  return collection
}

export const queueKey = (platform: string, credentialId: string, importType: string): string =>
  `${platform}:${credentialId}:${importType}`

/**
 * Adds a requested report to the queue.
 *
 * Replaces any entry for the same platform/credential/importType: a newer
 * request supersedes an older one, and collecting the stale report would import
 * a narrower date range over a wider one.
 */
export const enqueueReport = async (entry: Omit<QueuedReport, 'key' | 'lastCheckedAt' | 'attempts'>): Promise<void> => {
  const key = queueKey(entry.platform, entry.credentialId, entry.importType)

  await store().mutate((records) => ({
    records: [
      ...records.filter((row) => row.key !== key),
      { ...entry, key, lastCheckedAt: null, attempts: 0 }
    ],
    result: undefined
  }))

  logger.info(`Queued ${entry.platform} ${entry.importType} for ${entry.username} to download later`)
}

export const listQueued = async (): Promise<QueuedReport[]> => store().read().catch(() => [])

export const markChecked = async (key: string): Promise<void> => {
  await store().mutate((records) => ({
    records: records.map((row) =>
      row.key === key ? { ...row, lastCheckedAt: Date.now(), attempts: row.attempts + 1 } : row
    ),
    result: undefined
  }))
}

export const dequeueReport = async (key: string): Promise<void> => {
  await store().mutate((records) => ({
    records: records.filter((row) => row.key !== key),
    result: undefined
  }))
}
