import { useCallback, useEffect, useMemo, useState } from 'react'
import { CheckCircle2, CircleAlert, Loader2, RefreshCw, UserRound } from 'lucide-react'
import { PLATFORM_SESSION_CHANNELS } from '@shared/constants/channels'
import type {
  PlatformCredentials,
  PlatformDescriptor,
  SessionHealth
} from '@shared/types/platformSession'
import { HEALTH_LABEL } from '@shared/utils/sessionHealth'
import { platformKey } from '@shared/utils/platformKey'
import { sessionUpdateTargets } from '@shared/utils/sessionTargets'
import { Button } from '@renderer/components/ui/Button'
import { invoke } from '@renderer/services/ipcClient'
import { capturingNow, onSessionCapturing, onSessionsChanged } from '@renderer/services/sessionEvents'
import { useToast } from '@renderer/hooks/useToast'
import { classNames } from '@renderer/utils/format'

/**
 * The accounts the Session update is going to work on, and how each one ends up.
 *
 * WHY IT IS HERE AT ALL. The row above says a run happened and gives a count.
 * A count does not answer the question an operator actually has at 9am, which
 * is "which logins am I going to have to do by hand" — and the banner names
 * platforms, not accounts, so a platform with four logins and one dead session
 * looks the same as one with four dead ones.
 *
 * RED IS WORK OUTSTANDING, GREEN IS DONE, and the change happens while the run
 * is happening: every capture broadcasts, this re-reads, and the account that
 * just signed in turns green under the operator's eye. An account stays on the
 * list once it goes green rather than vanishing, because a list that empties
 * itself as it goes gives no evidence that anything was achieved.
 *
 * THE SET COMES FROM THE SAME FUNCTION THE JOB USES. That is deliberate and it
 * is the fix for a bug this screen caused: a card listing a different set from
 * the one that runs is a more convincing lie than no card at all.
 *
 * EVERY CHIP SAYS WHY. Expired, Expiring, Rejected and No session are four
 * different problems with four different fixes, and a list of bare account
 * names made an operator open the Sessions page to find out which they had.
 *
 * AND IT IS NEVER BLANK. "Nothing here" and "nothing needed" look identical in
 * empty space, so the empty case says so in words — a card that silently
 * renders nothing is the one that made this whole area look broken.
 *
 * CHECK NOW is the only thing here that costs anything. Expiry dates are a
 * guess made at capture time; the marketplace's own answer takes one request
 * per account, so it is a button rather than something that happens whenever
 * this page opens.
 */

interface Row {
  key: string
  label: string
  username: string
  /** Live: true once this credential's session is healthy again. */
  done: boolean
  /** Nobody can sign this one in unattended — see the Sessions page badge. */
  manual: boolean
  /** Why it is on the list — Expired, Expiring, Rejected, No session. */
  state: SessionHealth
  /** Live: the one account being signed in this instant. */
  busy: boolean
}

/**
 * What to do about each state, in the words of the thing that has to be done.
 *
 * `rejected` is the one worth spelling out: its expiry date is usually days
 * away, so "expired" would send somebody to look at a date that is fine.
 */
const WHY: Record<SessionHealth, string> = {
  expired: 'the saved login has run out',
  expiring: 'the saved login runs out shortly',
  rejected: 'the marketplace refused the saved login, whatever its expiry says',
  none: 'this account has never been signed in on this machine',
  active: 'the saved login is fine'
}

export const SessionUpdateTargets = ({ running }: { running: boolean }) => {
  const toast = useToast()
  const [platforms, setPlatforms] = useState<PlatformDescriptor[]>([])
  const [health, setHealth] = useState<PlatformCredentials[] | null>(null)
  const [checking, setChecking] = useState(false)
  /**
   * Everything that has been on the list since this card was opened, keyed by
   * platform + username.
   *
   * Kept across reloads so a credential that has just been fixed can be shown
   * green instead of dropping out of the target set and off the screen.
   */
  const [seen, setSeen] = useState<Map<string, { label: string; username: string; state?: SessionHealth }>>(new Map())
  /**
   * The account the run is signing in right now — `platform::username`, or null.
   *
   * Seeded from `capturingNow()` rather than null so opening Settings midway
   * through a run shows the spinner immediately, instead of after the current
   * account finishes.
   */
  const [busyKey, setBusyKey] = useState<string | null>(() => {
    const current = capturingNow()

    return current ? `${current.platform}::${current.username}` : null
  })

  useEffect(
    () => onSessionCapturing(target => setBusyKey(target ? `${target.platform}::${target.username}` : null)),
    []
  )

  useEffect(() => {
    let cancelled = false

    const load = async (): Promise<void> => {
      const [list, current] = await Promise.all([
        invoke<PlatformDescriptor[]>(PLATFORM_SESSION_CHANNELS.list),
        invoke<PlatformCredentials[]>(PLATFORM_SESSION_CHANNELS.health)
      ])

      if (cancelled) return
      if (list.success) setPlatforms(list.data)
      if (!current.success) return

      setHealth(current.data)

      // Remembered HERE, after the await, where this app puts every setState —
      // and not in an effect watching `health`, which would be a synchronous
      // write during the render that effect belongs to. The names are what let
      // a fixed account stay on screen as green instead of dropping out of the
      // target set and disappearing.
      const names = list.success
        ? new Set(list.data.map(entry => platformKey(entry.key)))
        : new Set<string>()

      setSeen(previous => {
        const next = new Map(previous)
        let added = false

        for (const target of sessionUpdateTargets(current.data, key => names.has(key))) {
          const key = `${target.platform}::${target.username}`

          if (!next.has(key)) {
            next.set(key, { label: target.label, username: target.username })
            added = true
          }
        }


        return added ? next : previous
      })
    }

    void load()

    // A capture anywhere — this run, the banner's button, the Sessions page —
    // changes what belongs here. Same signal the banner listens to.
    const unsubscribe = onSessionsChanged(() => void load())

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])

  /**
   * Asks each marketplace about the sessions whose DATES say they are fine.
   *
   * The only thing on this card that reaches the network for an answer rather
   * than reading one. `expiresAt` is a guess made when the session was
   * captured, so a revoked jar reads "Saved" here while a claim run is refused
   * with it — which is exactly how the list came to be empty on an evening Auto
   * claim skipped two marketplaces for having no usable session.
   */
  const check = useCallback(async (): Promise<void> => {
    setChecking(true)

    const response = await invoke<PlatformCredentials[]>(PLATFORM_SESSION_CHANNELS.verify)

    setChecking(false)

    if (!response.success) {
      toast.error(response.error.message)

      return
    }

    setHealth(response.data)
  }, [toast])

  const known = useMemo(() => new Set(platforms.map(entry => platformKey(entry.key))), [platforms])

  const rows = useMemo<Row[]>(() => {
    if (!health) return []

    const targets = sessionUpdateTargets(health, key => known.has(key))
    const manual = new Set(
      targets.filter(target => !target.unattended).map(target => `${target.platform}::${target.username}`)
    )

    // Everything currently outstanding, plus anything that was outstanding
    // earlier in this sitting and is now healthy.
    const outstanding = new Map(
      targets.map(target => [
        `${target.platform}::${target.username}`,
        { label: target.label, username: target.username, state: target.state }
      ])
    )
    const merged = new Map([...seen, ...outstanding])

    return [...merged.entries()]
      .map(([key, entry]) => ({
        key,
        label: entry.label,
        username: entry.username,
        done: !outstanding.has(key),
        manual: manual.has(key),
        // A row that has gone green is no longer in `outstanding`, so its state
        // comes from the seen map — 'active' for one this run has just fixed.
        state: outstanding.get(key)?.state ?? 'active',
        busy: key === busyKey
      }))
      // The account in hand sorts to the front, ahead of the queue behind it and
      // of everything already done — it is the only row anybody is waiting on.
      .sort(
        (a, b) =>
          Number(b.busy) - Number(a.busy) ||
          Number(a.done) - Number(b.done) ||
          a.label.localeCompare(b.label)
      )
  }, [health, known, seen, busyKey])

  const left = rows.filter(row => !row.done).length

  const summary =
    rows.length === 0
      ? // NOT an empty render. An operator looking at blank space cannot tell
        // "nothing needs doing" from "this is broken", and on the evening Auto
        // claim skipped two marketplaces it was showing exactly that blank.
        health === null
        ? 'Reading the accounts…'
        : 'Every saved login is inside its expiry date — press Check now for the marketplace’s own answer'
      : left === 0
        ? `${rows.length === 1 ? 'This login was' : `All ${rows.length} logins were`} updated`
        : `${left} of ${rows.length} still to update${running ? ' — working through them now' : ''}`

  return (
    <div className="mt-2 flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <p className="min-w-0 flex-1 text-2xs text-muted">{summary}</p>

        {/* The one control here that reaches a marketplace. One request per
            account, so it is pressed rather than run on every page open. */}
        <Button
          size="sm"
          variant="secondary"
          icon={<RefreshCw size={12} />}
          className="h-6 shrink-0 px-2 text-2xs"
          loading={checking}
          disabled={running}
          title="Ask each marketplace whether its saved login still works. Expiry dates are only a guess."
          onClick={() => void check()}
        >
          Check now
        </Button>
      </div>

      <ul className="flex flex-wrap gap-1.5">
        {rows.map(row => (
          <li
            key={row.key}
            title={
              row.busy
                ? `${row.label} · ${row.username} — signing in now`
                : row.done
                  ? `${row.label} · ${row.username} — login updated`
                  : `${row.label} · ${row.username} — ${WHY[row.state]}` +
                    (row.manual
                      ? '. Automatic sign-in is off for this platform, so this one needs a person.'
                      : '. Waiting to be re-captured.')
            }
            // `aria-busy` rather than only a spinning glyph: the animation is
            // the whole signal for a sighted operator and none at all otherwise.
            aria-busy={row.busy || undefined}
            className={classNames(
              'flex max-w-full items-center gap-1.5 rounded-md px-2 py-1 text-2xs ring-1',
              // IN FLIGHT WINS OVER ITS HEALTH. The account being signed in is
              // still expired until the capture lands, so on its own colours it
              // would stay in the red crowd — which is the thing that made the
              // current account impossible to pick out.
              row.busy
                ? 'bg-accent-soft text-accent-hover ring-accent motion-safe:animate-pulse'
                : row.done
                  ? 'bg-success-surface text-success-fg ring-success-border'
                  : 'bg-danger-surface text-danger-fg ring-danger-border'
            )}
          >
            {row.busy ? (
              <Loader2 size={12} className="shrink-0 motion-safe:animate-spin" aria-hidden="true" />
            ) : row.done ? (
              <CheckCircle2 size={12} className="shrink-0" aria-hidden="true" />
            ) : row.manual ? (
              <UserRound size={12} className="shrink-0" aria-hidden="true" />
            ) : (
              <CircleAlert size={12} className="shrink-0" aria-hidden="true" />
            )}
            <span className="font-medium">{row.label}</span>
            <span className="truncate opacity-80">{row.username}</span>
            {/* Which of the four problems this is. Four different fixes, and a
                bare account name made an operator open another page to find
                out which one they had. */}
            {/* What is happening beats why it was queued: an account being
                signed in has no use for the "Expired" that put it on the list. */}
            {row.busy ? (
              <span className="shrink-0 rounded-sm bg-current/10 px-1 font-medium">
                Signing in…
              </span>
            ) : (
              !row.done && (
                <span className="shrink-0 rounded-sm bg-current/10 px-1 font-medium">
                  {HEALTH_LABEL[row.state]}
                </span>
              )
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
