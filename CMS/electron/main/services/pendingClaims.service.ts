import type {
  AutoClaimTarget,
  RefillTarget,
  StatusTarget
} from '@shared/types/automationSchedule'
import type { CmsRow } from '@shared/types/cmsList'
import { selectionBlockReason } from '@shared/constants/claims'
import { canRefill, refillExhausted, refillStatusFieldsFor } from '@shared/constants/refill'
import { platformKey } from '@shared/utils/platformKey'
import { fail, ok, type Result } from '@shared/types/result'
import { apiRequest } from './httpClient'
import { getAccessToken } from './session.store'
import { listCms } from './cmsList.service'
import { recentlySynced, statusKey, statusSyncWindowMs } from './statusSync.store'
import { logger } from './logger'

/**
 * The claims a night's run has to work with, and the gate that decides which of
 * them it may touch.
 *
 * SPLIT OUT OF THE TASK ADAPTERS so the Settings card and the 04:00 run can ask
 * the same question and be given the same answer. A card that listed a
 * different set from the one that runs is a more convincing lie than no card at
 * all — the same reason `sessionUpdateTargets` is shared with the Session
 * update row rather than re-derived beside it.
 */

/** How many pages of Pending claims one night will look at. */
const MAX_PAGES = 20

const PAGE_SIZE = 200

const number = (value: number): string => value.toLocaleString()

/**
 * Every claim whose FILED TICKET is still moving, across platforms.
 *
 * WHAT IT IS FOR. The status pass asks the marketplace where a ticket now
 * stands and what was paid — a question only a row that HAS a ticket can
 * answer. `pendingClaims` cannot supply those: a Pending row has no ticket
 * yet, which is why the status was asked for rows that could not answer it and
 * never asked for the rows that could.
 *
 * FETCHED UNFILTERED AND NARROWED HERE, because the list endpoint takes ONE
 * status and this needs "everything except four". Asking per status would mean
 * knowing every status a marketplace might report, and a new one would be
 * silently dropped — see REFILL_STATUS_SKIPPED.
 */
/**
 * What a status sweep found, and what it deliberately left behind.
 *
 * The second half is the part worth returning. Rows answered within the window
 * are simply absent from `rows`, and absent is indistinguishable from "this
 * marketplace has nothing to ask" — so a sweep that dropped from 580 claims to
 * 32 looked like a bug, or worse, like the back catalogue had been forgotten.
 * Counted per platform, the panel can say which it is.
 */
export interface StatusSweep {
  rows: CmsRow[]
  /** Platform key → claims already answered inside the window. */
  upToDate: Map<string, number>
}

export const claimsAwaitingStatus = async (): Promise<StatusSweep> => {
  const rows: CmsRow[] = []
  /*
   * WHAT THIS MACHINE HAS ALREADY ASKED, read ONCE for the whole sweep.
   *
   * The pass used to re-ask every claim whose status could still move — 580 on
   * Myntra, 821 on Nykaa — every run, and almost none of them had changed. A
   * marketplace does not decide a claim hourly, so that was hours of browser
   * time a night spent to find nothing, crowding out the rows that did need
   * asking.
   *
   * A claim with no record is asked about: never asked reads as DUE, which is
   * what every row predating the store is.
   */
  const fresh = await recentlySynced()
  /** Rows answered recently enough to leave alone this run. */
  let left = 0
  const upToDate = new Map<string, number>()

  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const result = await listCms({ page, limit: PAGE_SIZE })

    if (!result.success) throw new Error(result.error.message)

    for (const row of result.data.rows) {
      /*
       * EVERY CLAIM WITH A TICKET, WHATEVER ITS STATUS. A ticket is what the
       * marketplace can report on; a status that looks final here can still be
       * reopened or paid there. The AWB is what the pass asks with and what
       * `status-record` is keyed on, so a row without one cannot be carried.
       */
      if (!row.ticket.trim() || !row.returnAwb.trim()) continue

      if (fresh.has(statusKey(row.returnAwb))) {
        const key = platformKey(row.platform)

        left += 1
        upToDate.set(key, (upToDate.get(key) ?? 0) + 1)

        continue
      }

      rows.push(row)
    }

    if (page * PAGE_SIZE >= result.data.total || result.data.rows.length === 0) break

    if (page === MAX_PAGES) {
      logger.warn(
        `[schedule] stopped after ${number(MAX_PAGES)} pages while looking for claims whose ` +
          'status could have moved — the rest will be picked up by the next run'
      )
    }
  }

  // Said out loud, because a sweep that suddenly covers 90 rows instead of
  // 1,400 looks like a bug until you know why.
  if (left > 0) {
    const days = Math.round(statusSyncWindowMs() / (24 * 60 * 60 * 1000))

    logger.info(
      `[schedule] status pass: ${number(left)} claim(s) answered within the last ` +
        `${days} day(s), left alone this run`
    )
  }

  return { rows, upToDate }
}

/**
 * Give one marketplace's claims their refill budget back.
 *
 * WHAT IT UNDOES. `MAX_REFILL_ATTEMPTS` asks retires a row from the nightly
 * refill, which is right when the marketplace keeps answering "never heard of
 * it". It was also charged when the marketplace REFUSED TO LOOK — a 429, a 502
 * — so a burst limit could retire a whole sweep's worth of rows over something
 * that had nothing to do with them. The runner no longer charges those; this
 * lets the ones already retired by it back in.
 *
 * PER PLATFORM, because that is the shape of the damage and the shape of the
 * card: a limit hits one marketplace's sweep, and the chip counts them that way.
 */
export const resetRefillAttempts = async (payload: unknown): Promise<Result<number>> => {
  const { platform } = (payload ?? {}) as { platform?: unknown }

  if (typeof platform !== 'string' || platform.trim() === '') {
    return fail('VALIDATION_ERROR', 'Say which marketplace to reset.')
  }

  const token = getAccessToken()

  if (!token) return fail('VALIDATION_ERROR', 'Sign in to TrackVid first.')

  const response = await apiRequest<{ matched: number; updated: number }>(
    '/cms/refill-attempt/reset',
    { method: 'POST', token, body: { platform } }
  )

  if (!response.success) return fail('INTERNAL_ERROR', response.error.message)

  const updated = response.data?.updated ?? 0

  logger.info(`[refill] ${platform}: ${updated} row(s) let back into the nightly refill`)

  return ok(updated)
}

/** Every claim in one status, across platforms, up to MAX_PAGES pages. */
const claimsWithStatus = async (status: string): Promise<CmsRow[]> => {
  const rows: CmsRow[] = []

  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const result = await listCms({ status, page, limit: PAGE_SIZE })

    if (!result.success) throw new Error(result.error.message)

    rows.push(...result.data.rows)

    if (rows.length >= result.data.total || result.data.rows.length === 0) break

    if (page === MAX_PAGES) {
      logger.warn(
        `[schedule] stopped at ${number(rows.length)} ${status} claims of ${number(result.data.total)} —` +
          ' the rest will be picked up by the next run'
      )
    }
  }

  return rows
}

/**
 * Every Pending claim, across platforms — what Refill Data works on.
 *
 * Refill stays on Pending: it has its own attempt budget (`refillExhausted`).
 */
export const pendingClaims = (): Promise<CmsRow[]> => claimsWithStatus('Pending')

/**
 * Every claim the scheduled automations FILE (Auto claim and Proceed eligible
 * claims): Pending only, on every platform.
 *
 * Failed to Proceed is NOT picked up. Those rows were retried here for a while,
 * but they are the operator's queue: the backend put them there because the
 * retry cap was reached or the runner reported the claim as un-fileable, so a
 * person reads the Error column, fixes the cause and files them from the Claims
 * page (which still allows ticking them). An unattended run re-filing them only
 * repeated the same failure — or, at "unlimited" cap, repeated it every night.
 *
 * The retry cap still guards Pending: `splitFileable` applies it through
 * `selectionBlockReason`.
 */
export const fileableClaims = (): Promise<CmsRow[]> => claimsWithStatus('Pending')

/**
 * The gate, applied once: what this run may file, and what it may not.
 *
 * `selectionBlockReason` is the same rule the Claims page ticks a checkbox
 * with — a claim already being filed, one past the retry cap, one with no
 * account, no POB ID or no sub-order number. Reusing it rather than writing a
 * second list of conditions is the whole reason that rule lives in `shared/`:
 * an unattended run is exactly where a divergence would be most expensive,
 * because filing a claim twice raises a second ticket for the same return.
 */
export const splitFileable = (
  claims: CmsRow[]
): { ready: CmsRow[]; blocked: { row: CmsRow; reason: string }[] } => {
  const ready: CmsRow[] = []
  const blocked: { row: CmsRow; reason: string }[] = []

  for (const row of claims) {
    const reason = selectionBlockReason(row)

    if (reason) blocked.push({ row, reason })
    else ready.push(row)
  }

  return { ready, blocked }
}

/** Per marketplace, in claim order — most work first, then alphabetically. */
export const summariseTargets = (claims: CmsRow[]): AutoClaimTarget[] => {
  const { ready, blocked } = splitFileable(claims)
  const targets = new Map<string, AutoClaimTarget>()

  const entry = (platform: string): AutoClaimTarget => {
    const key = platform.toLowerCase()
    const found = targets.get(key) ?? { platform, ready: 0, blocked: 0 }

    targets.set(key, found)

    return found
  }

  for (const row of ready) entry(row.platform).ready += 1
  for (const { row } of blocked) entry(row.platform).blocked += 1

  return [...targets.values()].sort(
    (a, b) => b.ready - a.ready || a.platform.localeCompare(b.platform)
  )
}

/**
 * What Refill Data would ask about right now, per marketplace.
 *
 * NOT `splitFileable`, deliberately. That rule refuses a claim with no account,
 * no POB or no sub-order — which is the exact set a refill exists to repair, so
 * reusing it here would report "nothing to do" about the rows most in need of
 * doing. The refill's own two conditions are all that apply: the platform must
 * have something to ask, and the row must have an AWB to ask about.
 *
 * `exhausted` is counted rather than hidden. A row past MAX_REFILL_ATTEMPTS is
 * skipped by the run, and a card that showed only "0 pending" would leave an
 * operator to conclude the marketplace had answered everything — when in fact
 * nobody has asked since the third attempt.
 */
export const summariseRefillTargets = (claims: CmsRow[]): RefillTarget[] => {
  const targets = new Map<string, RefillTarget>()

  const entry = (platform: string): RefillTarget => {
    const key = platform.toLowerCase()
    const found = targets.get(key) ?? { platform, pending: 0, exhausted: 0 }

    targets.set(key, found)

    return found
  }

  for (const row of claims) {
    if (!canRefill(platformKey(row.platform))) continue
    if (!row.returnAwb) continue

    if (refillExhausted(row.refillAttempts)) entry(row.platform).exhausted += 1
    else entry(row.platform).pending += 1
  }

  return [...targets.values()].sort(
    (a, b) => b.pending - a.pending || a.platform.localeCompare(b.platform)
  )
}

export const refillTargets = async (): Promise<Result<RefillTarget[]>> => {
  try {
    return ok(summariseRefillTargets(await pendingClaims()))
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : 'Could not read the Pending claims'

    logger.warn(`[schedule] refill targets: ${message}`)

    return fail('INTERNAL_ERROR', message)
  }
}

/**
 * What Status change would ask about right now, per marketplace.
 *
 * The same sweep the run makes, so the badges and the run cannot disagree.
 * Only marketplaces this app can ask a status of — Tata CliQ and Xbees report
 * none — and every one of those is listed, a marketplace with nothing due
 * included, so the panel always shows the whole board.
 */
export const statusTargets = async (): Promise<Result<StatusTarget[]>> => {
  try {
    const { rows, upToDate } = await claimsAwaitingStatus()
    const targets = new Map<string, StatusTarget>()

    const entry = (platform: string): StatusTarget => {
      const found = targets.get(platform) ?? { platform, due: 0, upToDate: 0 }

      targets.set(platform, found)

      return found
    }

    for (const row of rows) {
      const key = platformKey(row.platform)

      if (refillStatusFieldsFor(key).length > 0) entry(key).due += 1
    }

    for (const [key, count] of upToDate) {
      if (refillStatusFieldsFor(key).length > 0) entry(key).upToDate += count
    }

    return ok(
      [...targets.values()].sort(
        (a, b) => b.due - a.due || a.platform.localeCompare(b.platform)
      )
    )
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : 'Could not read the filed claims'

    logger.warn(`[schedule] status targets: ${message}`)

    return fail('INTERNAL_ERROR', message)
  }
}

/**
 * What Auto claim would file if it ran right now, per marketplace.
 *
 * Read on demand rather than pushed: it is a page of claims from the API, and
 * the card asks for it when it is opened and once more when a run ends. Nothing
 * here polls.
 */
export const autoClaimTargets = async (): Promise<Result<AutoClaimTarget[]>> => {
  try {
    return ok(summariseTargets(await fileableClaims()))
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : 'Could not read the claims to file'

    logger.warn(`[schedule] auto-claim targets: ${message}`)

    return fail('INTERNAL_ERROR', message)
  }
}
