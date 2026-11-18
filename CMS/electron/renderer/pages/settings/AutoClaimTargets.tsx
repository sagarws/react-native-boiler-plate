import { useCallback, useEffect, useMemo, useState } from 'react'
import { CheckCircle2, CircleAlert, KeyRound, Loader2 } from 'lucide-react'
import type { AutoClaimTarget, ScheduledTaskId } from '@shared/types/automationSchedule'
import type { ClaimBatchPlatform } from '@shared/types/claimQueue'
import { autoClaimTargets } from '@renderer/services/automationSchedule.service'
import { onClaimBatchProgress } from '@renderer/services/claimQueue.service'
import { registerPageRefresh } from '@renderer/services/refreshRegistry'
import { classNames } from '@renderer/utils/format'
import { SkipPlatformButton } from '@renderer/components/layout/SkipPlatformButton'
import { WORKING_NOW_RING } from '@renderer/components/layout/workingNow'

/**
 * The marketplaces Auto claim is about to file for, and how far it has got with
 * each.
 *
 * WHY IT IS HERE AT ALL. The row above says a run happened and gives a total.
 * A total does not answer the question an operator has at 04:00, which is
 * "which marketplace is still outstanding" — a night that filed every Myntra
 * claim and never reached Snapdeal reads, in the totals, exactly like one
 * halfway through both.
 *
 * RED IS WORK OUTSTANDING, GREEN IS DONE, and the change happens while the run
 * is happening: every claim the batch attempts is announced with its platform,
 * so the marketplace that has just been cleared turns green under the
 * operator's eye. A platform stays on the list once it goes green rather than
 * vanishing, because a list that empties itself as it goes gives no evidence
 * that anything was achieved.
 *
 * A PLATFORM WITH FAILURES STAYS RED. "All done" and "all attempted" are not
 * the same sentence, and green for a marketplace where three of twelve claims
 * failed is the one reading nobody should take away from this row.
 *
 * AND A PLATFORM THAT WAS SKIPPED IS NEITHER. The nightly run passes over the
 * claims of an account whose session has expired — it files nothing for it and
 * charges no attempt. That is not work done and it is not work that failed: it
 * is work waiting on a re-capture, which is a different thing to do about it,
 * so it gets its own amber chip and says so.
 *
 * THE SET COMES FROM THE SAME GATE THE JOB USES — `selectionBlockReason`, via
 * `pendingClaims.service`, which is also what the 04:00 run files on. A card
 * listing a different set from the one that runs is a more convincing lie than
 * no card at all.
 */

interface Row {
  key: string
  platform: string
  /** Claims in this platform's share of the run. */
  total: number
  /** Attempted so far — succeeded plus failed. */
  done: number
  succeeded: number
  failed: number
  /** Reported filed, but no ticket id came back — nothing written to TrackVid. */
  ticketless: number
  /** Passed over — the account they need has no usable session. */
  skipped: number
  /** Still to file. Zero is what turns the chip green. */
  outstanding: number
  /** Live: the marketplace whose claim is being filed this instant. */
  busy: boolean
}

type Tone = 'done' | 'failed' | 'skipped' | 'waiting'

const toneOf = (row: Row): Tone => {
  if (row.outstanding > 0) return 'waiting'
  // A claim reported filed with no ticket id is NOT a finished one: nothing was
  // written back to TrackVid, and somebody has to check the marketplace before
  // it is retried. Green here would say the opposite.
  if (row.failed > 0 || row.ticketless > 0) return 'failed'
  // Only once nothing is outstanding and nothing failed: a platform that
  // filed nine and skipped three has a real failure-free result to report,
  // and the skip is what the line underneath is for.
  return row.skipped > 0 && row.done === 0 ? 'skipped' : 'done'
}

/**
 * The extras said after the three counts, only when they are not zero: what is
 * still left this run, what was passed over for want of a login, and what was
 * reported filed with no ticket id.
 */
const extras = (row: Row): string =>
  [
    row.outstanding > 0 && row.done > 0 ? `${row.outstanding} left` : '',
    row.skipped > 0 ? `${row.skipped} skipped — no login` : '',
    row.ticketless > 0 ? `${row.ticketless} no ticket id` : ''
  ]
    .filter(Boolean)
    .join(' · ')

/**
 * `taskId` is whose Skip the in-flight chip sends. Both claim tasks file through
 * the one batch and share this board; only the Skip has to know which is which.
 */
export const AutoClaimTargets = ({
  running,
  taskId = 'auto-claim'
}: {
  running: boolean
  taskId?: ScheduledTaskId
}) => {
  const [targets, setTargets] = useState<AutoClaimTarget[] | null>(null)
  /** The live batch, per platform — empty until one starts in this sitting. */
  const [batch, setBatch] = useState<ClaimBatchPlatform[]>([])
  /**
   * Every platform that has been on the list since this card was opened.
   *
   * Kept across reloads so a marketplace that has just been cleared can be
   * shown green instead of dropping out of the target set and off the screen.
   */
  const [seen, setSeen] = useState<Map<string, string>>(new Map())
  /**
   * The marketplace whose claim is being filed right now, lower-cased.
   *
   * Read from the batch's own `platform`, which has always been on every tick —
   * the card simply never used it. A per-platform tally answers "how far has it
   * got with each", and that leaves the marketplace actually in hand looking
   * exactly like the six queued behind it, which is the whole question at 04:00.
   */
  const [busyKey, setBusyKey] = useState<string | null>(null)

  const load = useCallback(async (): Promise<void> => {
    const response = await autoClaimTargets()

    if (!response.success) return

    setTargets(response.data)
    // Remembered here, after the await, rather than in an effect watching
    // `targets` — which would be a write during the render that effect belongs
    // to. See SessionUpdateTargets.
    setSeen(previous => {
      const next = new Map(previous)
      let added = false

      for (const target of response.data) {
        const key = target.platform.toLowerCase()

        if (target.ready > 0 && !next.has(key)) {
          next.set(key, target.platform)
          added = true
        }
      }

      return added ? next : previous
    })
  }, [])

  // `running` is a dependency so the list re-reads when the task starts and
  // again when it stops — the two moments it has something new to say.
  useEffect(() => {
    // Wrapped rather than called straight: every setState in this app happens
    // after an await, and the lint rule that enforces it reads the effect body
    // literally. See ImportScheduleSettings for the same shape.
    void (async () => {
      await load()
    })()

    const unregister = registerPageRefresh(load)

    return unregister
  }, [load, running])

  useEffect(
    () =>
      onClaimBatchProgress(progress => {
        setBatch(progress.platforms)
        // Both conditions, not just the name: `platform` is empty on the final
        // tick, and a tick that is not running is reporting a batch that has
        // stopped. Either alone would leave a chip spinning after the run.
        setBusyKey(
          progress.running && progress.platform ? progress.platform.toLowerCase() : null
        )

        // The batch is over: the claims it filed are no longer Pending, so the
        // counts are re-read once rather than inferred from the tick.
        if (!progress.running) void load()
      }),
    [load]
  )

  const rows = useMemo<Row[]>(() => {
    const live = new Map(batch.map(entry => [entry.platform.toLowerCase(), entry]))
    const ready = new Map(
      (targets ?? []).map(target => [target.platform.toLowerCase(), target.ready])
    )
    const names = new Map(seen)

    for (const entry of batch) names.set(entry.platform.toLowerCase(), entry.platform)

    return [...names.entries()]
      .map(([key, platform]) => {
        const entry = live.get(key)
        const waiting = ready.get(key) ?? 0

        // While a batch is running its own tally is the truth: the claims it
        // has filed are not Pending any more, but nothing has re-read the list
        // yet. Between runs, the list is.
        const total = entry ? entry.total : waiting
        const done = entry?.done ?? 0

        return {
          key,
          platform,
          total,
          done,
          succeeded: entry?.succeeded ?? 0,
          failed: entry?.failed ?? 0,
          ticketless: entry?.ticketless ?? 0,
          skipped: entry?.skipped ?? 0,
          outstanding: entry ? entry.total - entry.done : waiting,
          busy: key === busyKey
        }
      })
      // The marketplace in hand first — it is the only one anybody is waiting
      // on — then anything still wanting attention, then the finished ones.
      .sort(
        (a, b) =>
          Number(b.busy) - Number(a.busy) ||
          Number(toneOf(a) === 'done') - Number(toneOf(b) === 'done') ||
          a.platform.localeCompare(b.platform)
      )
  }, [batch, busyKey, seen, targets])

  const blocked = (targets ?? []).reduce((total, target) => total + target.blocked, 0)

  // Nothing waiting and nothing filed here yet: the row's own last line already
  // says what happened, and an empty strip would only add noise.
  if (rows.length === 0) {
    return blocked > 0 ? (
      <p className="mt-2 text-2xs text-muted">
        Nothing ready to file — {blocked} Pending claim{blocked === 1 ? '' : 's'} still waiting on a
        missing account, POB ID or sub-order number.
      </p>
    ) : null
  }

  const left = rows.filter(row => row.outstanding > 0).length
  const passedOver = rows.reduce((total, row) => total + row.skipped, 0)

  return (
    <div className="mt-2 flex flex-col gap-1.5">
      <p className="text-2xs text-muted">
        {left > 0
          ? `${left} of ${rows.length} marketplace${rows.length === 1 ? '' : 's'} still to file${
              running ? ' — working through them now' : ''
            }`
          : // "All done" would be untrue of a night that passed claims over, so
            // the skip is said on the headline rather than only in a chip.
            passedOver > 0
            ? `${passedOver} claim(s) skipped — re-capture the login and they file on the next run`
            : `${rows.length === 1 ? 'This marketplace is' : `All ${rows.length} marketplaces are`} done`}
        {blocked > 0 ? ` · ${blocked} not yet fileable` : ''}
      </p>

      <ul className="flex flex-col gap-1.5">
        {rows.map(row => {
          const tone = toneOf(row)

          return (
            <li
              key={row.key}
              title={
                row.busy
                  ? `${row.platform} — filing now, ${row.outstanding} claim(s) still to go`
                  : tone === 'skipped'
                    ? `${row.platform} — ${row.skipped} claim(s) passed over: the account has no usable login. Nothing was attempted and no attempt was charged. Re-capture it on the Login page and they file on the next run.`
                    : row.failed > 0
                      ? `${row.platform} — ${row.succeeded} of ${row.total} claim(s) Succeed, ${row.failed} failed. The Jobs page has the reasons.`
                      : tone === 'done'
                        ? `${row.platform} — every claim this run had for it is filed`
                        : `${row.platform} — ${row.outstanding} claim(s) still to file`
              }
              // The animation is the whole signal for a sighted operator and
              // none at all otherwise.
              aria-busy={row.busy || undefined}
              className={classNames(
                'flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-2xs ring-1',
                // IN FLIGHT WINS OVER ITS TALLY. A marketplace being filed still
                // has claims outstanding, so on its own tone it would sit in the
                // red crowd — which is exactly what made it impossible to pick out.
                tone === 'done'
                  ? 'bg-success-surface text-success-fg ring-success-border'
                  : tone === 'skipped'
                    ? 'bg-warning-surface text-warning-fg ring-warning-border'
                    : 'bg-danger-surface text-danger-fg ring-danger-border',
                // The ring goes ON TOP of the tally's colour, so "being filed
                // now" and "how far it got" are both readable at once.
                row.busy && `${WORKING_NOW_RING} motion-safe:animate-pulse`
              )}
            >
              {row.busy && (
                <SkipPlatformButton
                  taskId={taskId}
                  platform={row.key}
                  label={row.platform}
                />
              )}

              {row.busy ? (
                <Loader2 size={12} className="shrink-0 motion-safe:animate-spin" aria-hidden="true" />
              ) : tone === 'done' ? (
                <CheckCircle2 size={12} className="shrink-0" aria-hidden="true" />
              ) : tone === 'skipped' ? (
                <KeyRound size={12} className="shrink-0" aria-hidden="true" />
              ) : (
                <CircleAlert size={12} className="shrink-0" aria-hidden="true" />
              )}
              <span className="min-w-0 flex-1 truncate font-medium">{row.platform}</span>
              {extras(row) && <span className="truncate opacity-80">{extras(row)}</span>}
              {/* ONE ROW PER MARKETPLACE: what this run has to file, and what came of it. */}
              <span className="shrink-0 tabular-nums">Total {row.total + row.skipped}</span>
              <span className="shrink-0 tabular-nums">· Success {row.succeeded}</span>
              <span className="shrink-0 tabular-nums">· Failed {row.failed}</span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
