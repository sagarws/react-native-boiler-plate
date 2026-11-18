import { safeStorage } from 'electron'
import type { PendingSummary } from '@shared/types/platformSession'
import { dataDirectory } from '../database'
import { JsonCollection } from '../database/jsonStore'
import { logger } from './logger'
import { platformKey } from '@shared/utils/platformKey'

/**
 * Sessions captured on this machine that the backend has not accepted yet.
 *
 * A session captured offline is not lost — it is real, it works, and the only
 * thing missing is the write to the shared database. So it is kept here and the
 * operator gets an "Update" button that ships it when the network is back.
 *
 * Encrypted at rest with safeStorage, for the same reason as
 * localSession.store: these are live marketplace credentials, and a plaintext
 * file in userData is readable by anything running as that user. Where
 * encryption is unavailable nothing is queued at all — a captured session
 * cannot be worth writing seller cookies to disk in the clear.
 *
 * One pending entry per credential. A second capture replaces the first rather
 * than queueing behind it: the newer session is strictly better, and uploading
 * a stale one afterwards would overwrite it.
 */

interface StoredPending {
  /** `<platform>:<username>` — one pending session per credential. */
  key: string
  platform: string
  platformLabel: string
  username: string
  credentialId: string
  /** base64 of the safeStorage-encrypted ingest payload. */
  encrypted: string
  capturedAt: string
  /** When the marketplace session itself dies, if the login reported it. */
  expiresAt: string | null
  cookieCount: number
}

/** What the ingest endpoint needs, minus the parts assembled at send time. */
export interface PendingPayload {
  jar: unknown
  extras: Record<string, unknown>
}

// Declared in shared/types so the renderer can use it too.
export type { PendingSummary }

let collection: JsonCollection<StoredPending> | null = null

export const initialisePendingSessions = (): void => {
  collection = new JsonCollection<StoredPending>({
    name: 'pending-sessions',
    directory: dataDirectory()
  })
}

const store = (): JsonCollection<StoredPending> => {
  if (!collection) throw new Error('Pending session store used before initialisation')

  return collection
}

const keyOf = (platform: string, username: string): string =>
  `${platformKey(platform)}:${username.toLowerCase().trim()}`

const summarise = (row: StoredPending): PendingSummary => ({
  platform: row.platform,
  platformLabel: row.platformLabel,
  username: row.username,
  credentialId: row.credentialId,
  capturedAt: row.capturedAt,
  expiresAt: row.expiresAt,
  cookieCount: row.cookieCount
})

/**
 * Queues a captured session for later upload.
 *
 * Returns false when nothing was stored, so the caller can tell the operator
 * the session is gone rather than implying it is safely queued.
 */
export const queuePending = async (
  entry: Omit<StoredPending, 'key' | 'encrypted'> & { payload: PendingPayload }
): Promise<boolean> => {
  if (!safeStorage.isEncryptionAvailable()) {
    logger.warn('No OS encryption available — refusing to queue a session in plaintext')

    return false
  }

  const { payload, ...meta } = entry
  const key = keyOf(meta.platform, meta.username)
  const encrypted = safeStorage.encryptString(JSON.stringify(payload)).toString('base64')

  await store().mutate((records) => ({
    records: [...records.filter((row) => row.key !== key), { ...meta, key, encrypted }],
    result: undefined
  }))
  logger.info(`Queued a ${meta.platformLabel} session for ${meta.username} to upload later`)

  return true
}

/** Everything waiting to be uploaded, for the UI. */
export const listPending = async (): Promise<PendingSummary[]> =>
  (await store().read()).map(summarise)

/** One queued session, decrypted, or null when it is gone or unreadable. */
export const readPending = async (
  platform: string,
  username: string
): Promise<{ summary: PendingSummary; payload: PendingPayload } | null> => {
  if (!safeStorage.isEncryptionAvailable()) return null

  const match = (await store().read()).find((row) => row.key === keyOf(platform, username))

  if (!match) return null

  try {
    const plain = safeStorage.decryptString(Buffer.from(match.encrypted, 'base64'))

    return { summary: summarise(match), payload: JSON.parse(plain) as PendingPayload }
  } catch (error) {
    // A jar encrypted under a keychain entry this app can no longer read is not
    // recoverable. Drop it so the operator is told to re-capture rather than
    // shown an Update button that can never succeed.
    logger.warn(`Could not decrypt the pending ${platform} session; discarding it`, error)
    await discardPending(platform, username)

    return null
  }
}

export const discardPending = async (platform: string, username: string): Promise<void> => {
  const key = keyOf(platform, username)

  await store().mutate((records) => ({
    records: records.filter((row) => row.key !== key),
    result: undefined
  }))
}
