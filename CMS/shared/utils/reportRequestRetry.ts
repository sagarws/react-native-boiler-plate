/**
 * When a marketplace report request is asked for again — Snapdeal and
 * Flipkart, which both build a report over minutes and are polled for it.
 *
 * A request can fail two ways, and both used to strand the window for good:
 *
 * - REFUSED, or marked failed later (`failed`). Re-asked only while the window
 *   still sat inside the daily pass's range — and that range starts from the
 *   last date stored, so once a later window landed, an earlier failure fell
 *   out of it and was never asked for again.
 * - NEVER BUILT (`requested`, forever). A report the marketplace fails, or
 *   drops from its list, never shows up as complete, so the request stayed
 *   outstanding — and an outstanding request counts as "already asked".
 *   (Flipkart already ended these itself; Snapdeal uses `isStaleRequest`.)
 *
 * Now a failed window is asked again on the next daily pass wherever it falls,
 * up to a limit. The row is re-sent in place, so its attempt count climbs.
 */

/** The fields this needs — both stores' request rows carry them. */
export interface RetryableRequest {
  id: string
  requestId: string | null
  from: string
  to: string
  status: string
  requestedAt: string
  error: string | null
  /** Asks so far. Absent on rows written before it was counted: one. */
  attempts?: number
}

/** Asks per window, the first included. After this the failure is left for an operator. */
export const MAX_REPORT_REQUEST_ATTEMPTS = 5

export const attemptsOf = (record: Pick<RetryableRequest, 'attempts'>): number =>
  typeof record.attempts === 'number' && record.attempts > 0 ? record.attempts : 1

/** A failed window that has been asked for as many times as it will be. */
export const isExhausted = (record: Pick<RetryableRequest, 'status' | 'attempts'>): boolean =>
  record.status === 'failed' && attemptsOf(record) >= MAX_REPORT_REQUEST_ATTEMPTS

/**
 * Does something already answer this window, so it must not be asked again?
 *
 * CONTAINMENT, NOT OVERLAP: a live request (anything not failed) that asked for
 * all of it — or an exhausted failure, which is the app giving up on it rather
 * than asking every night.
 */
export const isWindowCovered = (
  window: { from: string; to: string },
  held: readonly RetryableRequest[]
): boolean =>
  held.some(
    record =>
      (record.status !== 'failed' || isExhausted(record)) &&
      record.from <= window.from &&
      record.to >= window.to
  )

const newestFirst = <T extends RetryableRequest>(held: readonly T[]): T[] =>
  [...held].sort((a, b) => b.requestedAt.localeCompare(a.requestedAt))

/**
 * Failed windows to ask for again, oldest first — one per window.
 *
 * `held` is one account's requests for one report. Duplicate failures of a
 * window (older passes made a fresh row each time) collapse onto the newest,
 * which carries the attempt count. A window now covered by a live request, or
 * older than the retention window, is left alone.
 */
export const failedToRetry = <T extends RetryableRequest>(
  held: readonly T[],
  retentionStart: string
): T[] => {
  const seen = new Set<string>()
  const retry: T[] = []

  for (const record of newestFirst(held)) {
    const key = `${record.from}|${record.to}`

    if (seen.has(key)) continue
    seen.add(key)

    if (record.status !== 'failed' || isExhausted(record)) continue
    if (record.to < retentionStart) continue
    if (isWindowCovered(record, held)) continue

    retry.push(record)
  }

  return retry.sort((a, b) => a.from.localeCompare(b.from))
}

/** The newest failed request for exactly this window, still worth asking again. */
export const retryableFor = <T extends RetryableRequest>(
  window: { from: string; to: string },
  held: readonly T[]
): T | null =>
  newestFirst(held).find(
    record =>
      record.status === 'failed' &&
      !isExhausted(record) &&
      record.from === window.from &&
      record.to === window.to
  ) ?? null

/** The same row, sent again: a fresh clock, one more attempt, the old answer cleared. */
export const nextAttempt = <T extends RetryableRequest>(previous: T, now: Date): T => ({
  ...previous,
  requestId: null,
  status: 'requested',
  requestedAt: now.toISOString(),
  error: null,
  attempts: attemptsOf(previous) + 1
})

/** Asked more than `afterMs` ago — long enough that the marketplace is not going to build it. */
export const isStaleRequest = (
  record: Pick<RetryableRequest, 'requestedAt'>,
  now: Date,
  afterMs: number
): boolean => {
  const asked = Date.parse(record.requestedAt)

  return Number.isFinite(asked) && now.getTime() - asked > afterMs
}
