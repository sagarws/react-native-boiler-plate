import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app, safeStorage } from 'electron'
import type { AuthUser } from '@shared/types/auth'
import { logger } from './logger'

/**
 * Persists the signed-in session between launches.
 *
 * The access token is encrypted with Electron's safeStorage, which is backed by
 * the macOS Keychain and Windows DPAPI - so the file on disk is useless on any
 * other account or machine. When the OS offers no encryption backend the token
 * is simply not written: the user stays signed in for the current run and has to
 * sign in again next launch. Storing a bearer token in plaintext is never the
 * fallback.
 *
 * Path comes from app.getPath('userData'), so nothing here is hard-coded.
 */
interface PersistedSession {
  version: 1
  /** Base64 of the safeStorage ciphertext. Absent when encryption is unavailable. */
  token?: string
  user: AuthUser
  loggedInAt: string
}

export interface Session {
  token: string
  user: AuthUser
  loggedInAt: string
}

const SESSION_FILE = 'session.json'

const sessionPath = (): string => join(app.getPath('userData'), SESSION_FILE)
const tempPath = (): string => `${sessionPath()}.tmp`

/** In-memory copy; the token is read from here on every API call, never from disk. */
let current: Session | null = null

export const getSession = (): Session | null => current

export const getAccessToken = (): string | null => current?.token ?? null

const encryptionAvailable = (): boolean => {
  try {
    return safeStorage.isEncryptionAvailable()
  } catch {
    return false
  }
}

/** Atomic write: temp file + rename, matching how the JSON collections persist. */
const persist = async (session: Session): Promise<void> => {
  const record: PersistedSession = {
    version: 1,
    user: session.user,
    loggedInAt: session.loggedInAt
  }

  if (encryptionAvailable()) {
    record.token = safeStorage.encryptString(session.token).toString('base64')
  } else {
    logger.warn('OS encryption unavailable; the session token will not be persisted to disk')
  }

  await mkdir(app.getPath('userData'), { recursive: true })
  await writeFile(tempPath(), JSON.stringify(record), 'utf8')
  await rename(tempPath(), sessionPath())
}

export const saveSession = async (session: Session): Promise<void> => {
  current = session
  try {
    await persist(session)
  } catch (error) {
    // A failed write must not fail the login - the user is authenticated for
    // this run either way.
    logger.error('Could not persist the session', error)
  }
}

export const clearSession = async (): Promise<void> => {
  current = null
  try {
    await rm(sessionPath(), { force: true })
  } catch (error) {
    logger.error('Could not remove the stored session', error)
  }
}

/**
 * Called once at startup. A session that cannot be decrypted (different machine,
 * rotated OS key, corrupt file) is discarded silently - the user just sees the
 * login screen.
 */
export const restoreSession = async (): Promise<Session | null> => {
  let raw: string
  try {
    raw = await readFile(sessionPath(), 'utf8')
  } catch {
    return null
  }

  try {
    const record = JSON.parse(raw) as PersistedSession
    if (record.version !== 1 || !record.token || !record.user) {
      await clearSession()
      return null
    }

    const token = safeStorage.decryptString(Buffer.from(record.token, 'base64'))
    current = { token, user: record.user, loggedInAt: record.loggedInAt }
    logger.info('Restored a stored session', { userId: record.user.id })
    return current
  } catch (error) {
    logger.warn('Stored session could not be read; signing out', {
      reason: error instanceof Error ? error.message : String(error)
    })
    await clearSession()
    return null
  }
}
