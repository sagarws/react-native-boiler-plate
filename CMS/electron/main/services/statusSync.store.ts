import { dataDirectory } from '../database'
import { JsonCollection } from '../database/jsonStore'
import { loadCore } from '@main/automations/common/coreLoader'
import { logger } from './logger'

/**
 * `status-record` — when the Status change pass last processed each AWB.
 *
 * WHY IT EXISTS. The pass asks the marketplace where every filed ticket now
 * stands, and a marketplace does not decide a claim hourly — so re-asking the
 * whole back catalogue every run cost hours of browser time to find nothing.
 * With this, an AWB is asked about once every `CLAIM_STATUS_SYNC_DAYS` (core,
 * `common/constants`) and a run only carries the ones whose window has passed.
 *
 * KEYED BY AWB, one row each, UPSERTED: processing an AWB again moves its stamp
 * forward rather than adding a row, so the table is bounded by the number of
 * claims and readable on the Local Database page as "last checked" per AWB.
 *
 * LOCAL, NOT ON THE CLAIM. The claim document is shared — the backend, the
 * server runner and this app all write it — and this is a fact about what THIS
 * MACHINE has already asked, not about the claim.
 *
 * ONLY WHEN THE PASS GOT AN ANSWER. A timeout has told us nothing, and stamping
 * it would buy the AWB a quiet window on the strength of a failure.
 *
 * NEVER PROCESSED READS AS DUE. An AWB with no row here is asked about.
 */

interface StatusRecord {
  /** The AWB, trimmed and upper-cased — what the upsert matches on. */
  key: string
  /** The AWB as the claim carries it. */
  awb: string
  cmsId: string | null
  platform: string | null
  /** ISO, when the status pass last processed it. */
  syncedAt: string
}

/** One processed AWB, as the status pass reports it. */
export interface StatusStamp {
  awb: string
  cmsId?: string
  platform?: string
}

const COLLECTION = 'status-record'
const DAY = 24 * 60 * 60 * 1000
const FALLBACK_DAYS = 4

let collection: JsonCollection<StatusRecord> | null = null

export const initialiseStatusSync = (): void => {
  collection = new JsonCollection<StatusRecord>({
    name: COLLECTION,
    directory: dataDirectory()
  })
}

/** The key an AWB is stored and looked up under. */
export const statusKey = (awb: string): string => awb.trim().toUpperCase()

/**
 * The window, from the core, so this app and the server runner agree on it.
 *
 * Read at call time rather than captured: it is a number an operator changes
 * precisely when a sweep is taking too long.
 */
export const statusSyncWindowMs = (): number => {
  try {
    const { CLAIM_STATUS_SYNC_DAYS } = loadCore<{ CLAIM_STATUS_SYNC_DAYS: number }>(
      'common/constants'
    )

    return Math.max(0, CLAIM_STATUS_SYNC_DAYS) * DAY
  } catch (error) {
    logger.warn(
      `[status-sync] could not read CLAIM_STATUS_SYNC_DAYS — using ${FALLBACK_DAYS} days`,
      error
    )

    return FALLBACK_DAYS * DAY
  }
}

/**
 * Every AWB processed recently enough to leave alone, by `statusKey`.
 *
 * ONE READ PER SWEEP. A read that fails returns an empty set, so the sweep
 * asks about everything — the only safe direction to degrade in.
 */
export const recentlySynced = async (now = Date.now()): Promise<Set<string>> => {
  if (!collection) return new Set()

  const window = statusSyncWindowMs()

  try {
    const records = await collection.read()
    const fresh = new Set<string>()

    for (const record of records) {
      const at = Date.parse(record.syncedAt)

      // An unreadable date reads as DUE, like a missing one.
      if (!Number.isNaN(at) && now - at < window) fresh.add(record.key)
    }

    return fresh
  } catch (error) {
    logger.warn('[status-sync] could not read what was already asked', error)

    return new Set()
  }
}

/**
 * Upserts the AWBs the status pass has just processed, stamped `now`.
 *
 * Called row by row as the pass goes, so an app closed part-way keeps what it
 * had already done and the next run starts after it.
 */
export const rememberStatusSynced = async (
  stamps: StatusStamp[],
  now = Date.now()
): Promise<void> => {
  const wanted = stamps.filter(stamp => stamp.awb.trim() !== '')

  if (!collection || wanted.length === 0) return

  const syncedAt = new Date(now).toISOString()

  try {
    await collection.mutate(records => {
      const next = new Map(records.map(record => [record.key, record]))

      for (const stamp of wanted) {
        const key = statusKey(stamp.awb)
        const held = next.get(key)

        next.set(key, {
          key,
          awb: stamp.awb.trim(),
          cmsId: stamp.cmsId ?? held?.cmsId ?? null,
          platform: stamp.platform ?? held?.platform ?? null,
          syncedAt
        })
      }

      return { records: [...next.values()], result: undefined }
    })
  } catch (error) {
    // Best effort: losing a stamp costs one extra ask of that AWB.
    logger.warn(`[status-sync] could not record ${wanted.length} processed AWB(s)`, error)
  }
}

/** Ask about everything again — for the manual "check them all now" path. */
export const forgetStatusSync = async (): Promise<void> => {
  if (!collection) return

  try {
    await collection.clear()
    logger.info('[status-sync] cleared — every claim will be asked about on the next run')
  } catch (error) {
    logger.warn('[status-sync] could not clear what was already asked', error)
  }
}
