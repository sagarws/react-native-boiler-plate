import type { SessionHealth, SessionSummary } from '../types/platformSession'

/**
 * Turning a stored session into something an operator can act on.
 *
 * Lives in shared/ rather than beside the page: it is pure logic over shared
 * types, and the main process will need the same reading of "expired" when it
 * decides whether a claim can run.
 *
 * WHAT THIS CAN AND CANNOT TELL YOU.
 *
 * Every judgement here is a date comparison against `expiresAt` — and that
 * value is a GUESS made when the session was captured (savedAt + a per-platform
 * constant), never something the marketplace told us. So this says whether the
 * guess has run out. It cannot say whether the cookies still authenticate.
 *
 * The two come apart in practice. A Myntra jar captured 24h earlier sat well
 * inside its window and read "Active", while Myntra answered the probe with its
 * anonymous payload — the session was dead and only the guess disagreed. That
 * is why the labels below say "Saved" rather than "Active": the card reports
 * what it knows, and the automations ask the marketplace before trusting a jar.
 */

/**
 * How long before expiry a session counts as "expiring".
 *
 * Two hours because that is comfortably longer than a claim batch. A session
 * inside this window still works, but starting a batch on it risks the run dying
 * halfway; flagging it early lets an operator re-capture first.
 */
const EXPIRING_WINDOW_MS = 2 * 60 * 60 * 1000

export const healthOf = (session: SessionSummary | null, now = Date.now()): SessionHealth => {
  if (!session) return 'none'

  /**
   * FIRST, because it is the only judgement here that is not a date
   * comparison. The marketplace was asked and refused — that outranks any
   * expiry, and it is exactly the case the dates get wrong.
   *
   * The stamp is dropped when a session is captured, so one that survives is
   * about the session being described. See sessionRejection.store.
   */
  if (session.rejectedAt) return 'rejected'

  // A session with no expiry cannot be judged stale, and the platforms that
  // store one always store it. Treat a missing value as usable rather than
  // hiding a session that is probably fine.
  if (!session.expiresAt) return 'active'

  const expiry = Date.parse(session.expiresAt)
  if (Number.isNaN(expiry)) return 'active'

  if (expiry <= now) return 'expired'
  if (expiry - now <= EXPIRING_WINDOW_MS) return 'expiring'
  return 'active'
}

/**
 * Deliberately NOT "Active".
 *
 * "Active" reads as "this session works", which is a claim this code cannot
 * support — it has only compared two dates. "Saved" says exactly what is known:
 * a session is stored and its expiry has not passed. The remaining time is
 * shown next to it, so the guess is visible as a guess.
 */
export const HEALTH_LABEL: Record<SessionHealth, string> = {
  active: 'Saved',
  expiring: 'Expiring',
  expired: 'Expired',
  // Not "Expired": the expiry is usually days away, and telling somebody a
  // session has run out when it has not sends them looking for the wrong
  // thing. The marketplace refused it; that is what needs re-capturing.
  rejected: 'Rejected',
  none: 'No login'
}

export const HEALTH_TONE: Record<SessionHealth, 'success' | 'warning' | 'danger' | 'neutral'> = {
  active: 'success',
  expiring: 'warning',
  expired: 'danger',
  rejected: 'danger',
  none: 'neutral'
}

/**
 * "in 3 days" / "5 hours ago" — a relative distance, because the absolute
 * timestamp is not what an operator needs to decide whether to re-capture.
 */
export const relativeTime = (iso: string | null, now = Date.now()): string => {
  if (!iso) return 'unknown'
  const at = Date.parse(iso)
  if (Number.isNaN(at)) return 'unknown'

  const deltaMs = at - now
  const past = deltaMs < 0
  const minutes = Math.round(Math.abs(deltaMs) / 60_000)

  if (minutes < 1) return past ? 'just now' : 'in under a minute'

  const units: [limit: number, size: number, name: string][] = [
    [60, 1, 'minute'],
    [48 * 60, 60, 'hour'],
    [Number.POSITIVE_INFINITY, 24 * 60, 'day']
  ]
  const unit = units.find(([limit]) => minutes < limit)
  if (!unit) return 'unknown'

  const [, size, name] = unit
  const value = Math.round(minutes / size)
  const plural = value === 1 ? name : `${name}s`
  return past ? `${value} ${plural} ago` : `in ${value} ${plural}`
}

/**
 * The states in which a stored session can be used RIGHT NOW, without signing
 * in again.
 *
 * `expiring` counts: it still authenticates, and a session with ninety minutes
 * left is no reason to refuse work that takes two. That is the same reading
 * `mappingAccounts` applies when it ranks accounts — now one constant instead
 * of a second copy of the literal.
 *
 * SEPARATE FROM `needsSessionUpdate`, and not its opposite. That one answers
 * "should the nightly Session update touch this?", and includes `expiring`
 * because renewing early is the whole point of running before the claims do.
 * This one answers "can work start on it now?" Both include `expiring`, for
 * opposite reasons — so neither can be written as the negation of the other.
 *
 * Same caveat as everything else in this file: it is a date comparison against
 * a GUESSED expiry, not a statement that the cookies still authenticate. It
 * says a session is worth trying, never that it will succeed.
 */
const USABLE_NOW: readonly SessionHealth[] = ['active', 'expiring']

export const canAuthenticateNow = (state: SessionHealth): boolean => USABLE_NOW.includes(state)

/**
 * Counts for the page summary. Only surfaces states worth acting on.
 *
 * `rejected` COUNTS. It was left out, so a platform whose logins the
 * marketplace had refused still read "4/4 fine" on the Login page while the
 * banner above it — which does count them — said they needed updating. A
 * refused login is the MOST urgent state here, not one to skip.
 */
export const summarise = (
  healths: SessionHealth[]
): { active: number; needsAttention: number; total: number } => ({
  active: healths.filter((h) => h === 'active').length,
  needsAttention: healths.filter(
    (h) => h === 'expiring' || h === 'expired' || h === 'none' || h === 'rejected'
  ).length,
  total: healths.length
})
