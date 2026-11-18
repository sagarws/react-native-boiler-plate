import { dataDirectory } from '../database'
import { JsonCollection } from '../database/jsonStore'
import { logger } from './logger'
import type { Result } from '@shared/types/result'
import { ok } from '@shared/types/result'

/**
 * The last good answer from the backend, kept on disk.
 *
 * An operator on a train, on hotel wifi, or behind a backend that is briefly
 * down should still see their claims, their credentials and their schedule.
 * None of that data changes minute to minute, and showing yesterday's numbers
 * is far more useful than showing an error where a page used to be.
 *
 * Two rules make this safe to trust:
 *
 *   1. Only a SUCCESSFUL response is ever written. A 500, a rejection or an
 *      empty body leaves the previous good copy in place, so a bad deploy
 *      cannot erase what the operator could still read a minute ago.
 *
 *   2. The cache is only read when the network FAILED — never to save a round
 *      trip. A stale answer served while the real one was available would be a
 *      correctness bug disguised as a performance win.
 *
 * Every cached read reports `fetchedAt`, so the UI can say how old it is rather
 * than presenting stale data as current. Data the operator cannot tell is stale
 * is worse than no data.
 *
 * NOT for secrets. Session jars and passwords go to localSession.store, which
 * encrypts through the OS keychain; this is a plain JSON file holding the same
 * lists the UI already renders.
 */

interface CacheEntry {
  key: string
  /** The successful payload, exactly as the caller would have returned it. */
  data: unknown
  /** ISO timestamp of the fetch that produced it. */
  fetchedAt: string
}

let collection: JsonCollection<CacheEntry> | null = null

export const initialiseOfflineCache = (): void => {
  collection = new JsonCollection<CacheEntry>({
    name: 'offline-cache',
    directory: dataDirectory()
  })
}

const store = (): JsonCollection<CacheEntry> => {
  if (!collection) throw new Error('Offline cache used before initialisation')

  return collection
}

/** What a cached read tells the caller about its own freshness. */
export interface Freshness {
  /** False when this came from disk because the network could not be reached. */
  fresh: boolean
  /** When the data was actually fetched. Null when it has never succeeded. */
  fetchedAt: string | null
}

export const readCache = async <T>(key: string): Promise<{ data: T; fetchedAt: string } | null> => {
  try {
    const match = (await store().read()).find((entry) => entry.key === key)

    return match ? { data: match.data as T, fetchedAt: match.fetchedAt } : null
  } catch (error) {
    logger.warn(`Could not read the offline cache for ${key}`, error)

    return null
  }
}

export const writeCache = async (key: string, data: unknown): Promise<void> => {
  try {
    await store().mutate((records) => ({
      records: [
        ...records.filter((entry) => entry.key !== key),
        { key, data, fetchedAt: new Date().toISOString() }
      ],
      result: undefined
    }))
  } catch (error) {
    // A cache that cannot be written must never fail the request that produced
    // the data — the operator has their answer either way.
    logger.warn(`Could not write the offline cache for ${key}`, error)
  }
}

/**
 * Distinguishes "the server said no" from "there was no server".
 *
 * Only the second is worth serving stale data for. A rejected request will be
 * rejected again, and answering it from cache would hide a real problem behind
 * data that looks fine.
 */
const isOffline = (message: string): boolean =>
  /cannot reach|took too long|network|timeout|econnrefused|fetch failed|offline/i.test(message)

/**
 * One request per key at a time, however many callers ask at once.
 *
 * THE STORM THIS STOPS. A claim run asks `mappingAccounts` for EVERY claim, and
 * that asks for session health, which comes through here. A Flipkart batch of a
 * few hundred rows therefore opens a few hundred simultaneous fetches of the
 * same credentials — and with the tunnel down, each one failed, read the cache
 * and wrote two lines. The log for one second of a batch:
 *
 *   14:58:29.352 API request failed {"path":"/cms/my-company-credentials"…}
 *   14:58:29.352 Serving session-health from the offline cache…
 *   …two hundred more, all at .35x
 *
 * Callers that arrive while a fetch is in the air now WAIT for it rather than
 * starting their own. They are asking the same question at the same instant, so
 * the answer cannot differ — this removes duplicate work, never a distinction.
 */
const inFlight = new Map<string, Promise<Result<unknown>>>()

/**
 * How long a key stays "known unreachable" after the network failed.
 *
 * Deliberately short. It is not a cache of the DATA — a successful answer is
 * never withheld and nothing stale is served that would not have been served
 * anyway a moment earlier. It only stops each of two hundred queued callers
 * discovering the same dead network for itself, one TCP attempt at a time.
 *
 * Five seconds: long enough to cover a burst from one batch, short enough that
 * an operator who reconnects and presses Refresh is not told to wait.
 */
const OFFLINE_COOLDOWN_MS = 5_000

/** Key → the moment it is worth trying the network again. */
const unreachableUntil = new Map<string, number>()

const fromCache = <T>(cached: { data: T; fetchedAt: string }): Result<T> =>
  // `offline` rides along as an extra property rather than changing the shape:
  // every caller already handles Result<T>, and a UI that wants to say "from an
  // hour ago" can read it without any of them being changed to accept a union.
  Object.assign(ok(cached.data), {
    offline: { fresh: false, fetchedAt: cached.fetchedAt } satisfies Freshness
  })

const fetchThrough = async <T>(
  key: string,
  fetcher: () => Promise<Result<T>>
): Promise<Result<T>> => {
  const response = await fetcher()

  if (response.success) {
    unreachableUntil.delete(key)
    await writeCache(key, response.data)

    return response
  }

  if (!isOffline(response.error.message)) return response

  const cached = await readCache<T>(key)

  if (!cached) return response

  // ONE LINE PER OUTAGE, not one per caller. The fallback is worth knowing
  // about; two hundred copies of it buried the thing that caused it.
  logger.info(`Serving ${key} from the offline cache (fetched ${cached.fetchedAt})`)
  unreachableUntil.set(key, Date.now() + OFFLINE_COOLDOWN_MS)

  return fromCache(cached)
}

/**
 * Runs `fetcher`, caching a success and falling back to the last one offline.
 *
 * @param key    stable per logical resource, e.g. "cms:counts:ajio"
 */
export const withOfflineCache = async <T>(
  key: string,
  fetcher: () => Promise<Result<T>>
): Promise<Result<T>> => {
  const waiting = unreachableUntil.get(key)

  if (waiting !== undefined && waiting > Date.now()) {
    const cached = await readCache<T>(key)

    // Nothing to serve means the cool-down is protecting nobody, so drop it and
    // let this caller find out for itself.
    if (cached) return fromCache(cached)

    unreachableUntil.delete(key)
  }

  const existing = inFlight.get(key)

  if (existing) return existing as Promise<Result<T>>

  const work = fetchThrough(key, fetcher)

  inFlight.set(key, work)

  try {
    return await work
  } finally {
    inFlight.delete(key)
  }
}

/** Everything cached, for a "last synced" display. */
export const cacheSummary = async (): Promise<{ key: string; fetchedAt: string }[]> => {
  try {
    return (await store().read()).map(({ key, fetchedAt }) => ({ key, fetchedAt }))
  } catch {
    return []
  }
}

/** Forgets everything. Used when signing out, so the next user sees nothing of this one's. */
export const clearOfflineCache = async (): Promise<void> => {
  // The guards are about THIS user's network, and signing out ends that.
  unreachableUntil.clear()
  inFlight.clear()

  try {
    await store().mutate(() => ({ records: [], result: undefined }))
  } catch (error) {
    logger.warn('Could not clear the offline cache', error)
  }
}
