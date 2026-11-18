import { safeStorage } from 'electron'
import { dataDirectory } from '../database'
import { JsonCollection } from '../database/jsonStore'
import { logger } from './logger'

/**
 * The company document, kept on this machine.
 *
 * One local copy of `GET /cms/company` — settings, credentials and the stored
 * `<platform>Session` jars — that everything else reads from. Fetched at
 * sign-in and on every Sync, and patched in place whenever this app changes
 * something on the server, so the copy never drifts from what it just wrote.
 *
 * ENCRYPTED, unlike the offline cache. That cache is a plain JSON file holding
 * lists the UI already renders; this document holds marketplace PASSWORDS and
 * live session jars. Someone with the file holds the seller accounts, so it
 * goes through Electron's safeStorage — the OS keychain (Keychain on macOS,
 * DPAPI on Windows) — exactly as localSession.store does.
 *
 * Where encryption is unavailable (a Linux box with no keyring) nothing is
 * stored at all rather than silently falling back to plaintext. The app then
 * works exactly as it did before this store existed: it reads from the backend
 * each time, and only loses the offline case.
 */

interface StoredCompany {
  /** Always "company" — one document, so one record. */
  key: string
  /** base64 of the safeStorage-encrypted company JSON. */
  encrypted: string
  fetchedAt: string
}

/** The document as Mongo holds it. Read by path, never reshaped here. */
export type CompanyDocument = Record<string, unknown>

const KEY = 'company'

let collection: JsonCollection<StoredCompany> | null = null

export const initialiseCompanyStore = (): void => {
  collection = new JsonCollection<StoredCompany>({
    name: 'company',
    directory: dataDirectory()
  })
}

const store = (): JsonCollection<StoredCompany> => {
  if (!collection) throw new Error('Company store used before initialisation')

  return collection
}

/**
 * Replaces the local copy with what the backend just returned.
 *
 * Silently does nothing when encryption is unavailable — the backend remains
 * the system of record, so a missing local copy costs a round trip rather than
 * the data.
 */
export const saveCompany = async (company: CompanyDocument): Promise<void> => {
  if (!safeStorage.isEncryptionAvailable()) {
    logger.warn('No OS keychain available — the company document will not be cached locally')

    return
  }

  const encrypted = safeStorage.encryptString(JSON.stringify(company)).toString('base64')

  await store().mutate(() => ({
    records: [{ key: KEY, encrypted, fetchedAt: new Date().toISOString() }],
    result: undefined
  }))
}

/** The local copy, or null when there is none this machine can read. */
export const readCompany = async (): Promise<{
  company: CompanyDocument
  fetchedAt: string
} | null> => {
  if (!safeStorage.isEncryptionAvailable()) return null

  const records = await store().read().catch(() => [])
  const match = records.find((record) => record.key === KEY)

  if (!match) return null

  try {
    const parsed: unknown = JSON.parse(
      safeStorage.decryptString(Buffer.from(match.encrypted, 'base64'))
    )

    if (!parsed || typeof parsed !== 'object') return null

    return { company: parsed as CompanyDocument, fetchedAt: match.fetchedAt }
  } catch (error) {
    // Encrypted under a different OS user, or a reinstalled keychain. Not
    // recoverable and not worth failing over: drop it and re-fetch.
    logger.warn('Could not decrypt the local company document; it will be re-fetched', {
      message: error instanceof Error ? error.message : String(error)
    })
    await clearCompany()

    return null
  }
}

/**
 * Applies a change this app just made on the server to the local copy.
 *
 * Called after a successful write — a session ingest, a schedule change — so
 * the copy reflects it without waiting for the next Sync. `mutate` receives the
 * document and returns it changed; returning null abandons the patch, which is
 * what happens when there is no local copy to patch yet.
 */
export const patchCompany = async (
  mutate: (company: CompanyDocument) => CompanyDocument | null
): Promise<boolean> => {
  const current = await readCompany()

  if (!current) return false

  const next = mutate(current.company)

  if (!next) return false

  await saveCompany(next)

  return true
}

/** Dropped on sign-out: the next operator must not read this one's company. */
export const clearCompany = async (): Promise<void> => {
  await store().mutate(() => ({ records: [], result: undefined }))
}
