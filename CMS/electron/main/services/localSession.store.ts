import { safeStorage } from 'electron'
import type { HarvestedCookie } from '@shared/types/platformSession'
import { dataDirectory } from '../database'
import { JsonCollection } from '../database/jsonStore'
import { logger } from './logger'
import { platformKey } from '@shared/utils/platformKey'

/**
 * Marketplace session jars, kept on this machine.
 *
 * The claim flows in @trackvid/automation-core read their session from Mongo.
 * This app has no database access by design, but it does not need any: it
 * captures the session itself, in its own browser window, so it can keep a copy
 * and hand it straight to the flow.
 *
 * The jar is encrypted at rest with Electron's safeStorage, which is backed by
 * the OS keychain (Keychain on macOS, DPAPI on Windows). These cookies are live
 * marketplace credentials — someone holding the file holds the seller account —
 * and a plaintext JSON file in userData is readable by anything running as that
 * user.
 *
 * Where encryption is unavailable (a Linux box with no keyring), nothing is
 * stored at all rather than silently falling back to plaintext.
 */

interface StoredSession {
  platform: string
  username: string
  /** base64 of the safeStorage-encrypted jar JSON. */
  encrypted: string
  savedAt: string
}

/** What a claim flow needs: cookie name → value. */
export type SessionJar = Record<string, string>

let collection: JsonCollection<StoredSession> | null = null

export const initialiseLocalSessions = (): void => {
  collection = new JsonCollection<StoredSession>({
    name: 'platform-sessions',
    directory: dataDirectory()
  })
}

const store = (): JsonCollection<StoredSession> => {
  if (!collection) throw new Error('Local session store used before initialisation')

  return collection
}

const keyOf = (platform: string, username: string): string =>
  `${platformKey(platform)}:${username.toLowerCase().trim()}`

/**
 * Keeps a copy of a jar this machine just captured.
 *
 * Silently does nothing when encryption is unavailable — the caller has already
 * shipped the jar to the backend, which remains the system of record, so a
 * missing local copy costs a re-capture rather than the session.
 */
export const rememberSession = async (
  platform: string,
  username: string,
  cookies: HarvestedCookie[]
): Promise<boolean> => {
  if (!safeStorage.isEncryptionAvailable()) {
    logger.warn('No OS encryption available; not storing the session jar locally')

    return false
  }

  const jar: SessionJar = {}

  for (const cookie of cookies) jar[cookie.name] = cookie.value

  const encrypted = safeStorage.encryptString(JSON.stringify(jar)).toString('base64')

  await store().mutate(records => {
    const key = keyOf(platform, username)
    const kept = records.filter(record => keyOf(record.platform, record.username) !== key)

    return {
      records: [
        ...kept,
        { platform, username, encrypted, savedAt: new Date().toISOString() }
      ],
      result: undefined
    }
  })

  logger.info(`Stored a local ${platform} session for ${username} (${cookies.length} cookies)`)

  return true
}

export const recallSession = async (
  platform: string,
  username: string
): Promise<SessionJar | null> => {
  if (!safeStorage.isEncryptionAvailable()) return null

  const records = await store().read()
  const key = keyOf(platform, username)
  const match = records.find(record => keyOf(record.platform, record.username) === key)

  if (!match) return null

  try {
    const plain = safeStorage.decryptString(Buffer.from(match.encrypted, 'base64'))
    const parsed: unknown = JSON.parse(plain)

    if (!parsed || typeof parsed !== 'object') return null

    return parsed as SessionJar
  } catch (error) {
    // A jar encrypted under a different OS user or a reinstalled keychain
    // cannot be read back. Treated as absent so the caller re-captures.
    logger.warn(`Could not decrypt the stored ${platform} session for ${username}`, error)

    return null
  }
}

export const forgetSession = async (platform: string, username: string): Promise<void> => {
  await store().mutate(records => ({
    records: records.filter(
      record => keyOf(record.platform, record.username) !== keyOf(platform, username)
    ),
    result: undefined
  }))
}

/**
 * Drops every stored jar on this machine.
 *
 * For "Clear all sessions", which signs the company out of every marketplace.
 * Written as one mutation rather than a loop over `forgetSession`: the caller
 * does not know which jars exist locally — a machine can hold one the server
 * has never heard of, captured while it was offline — and a sweep that only
 * removed what the server listed would leave exactly those behind.
 */
export const forgetAllSessions = async (): Promise<void> => {
  await store().mutate(() => ({ records: [], result: undefined }))
}
