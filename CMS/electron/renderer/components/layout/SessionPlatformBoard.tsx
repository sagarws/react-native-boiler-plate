import { useCallback, useEffect, useMemo, useState } from 'react'
import { CheckCircle2, CircleAlert, Loader2, MinusCircle, TriangleAlert } from 'lucide-react'
import type { CredentialRow, PlatformCredentials, PlatformDescriptor } from '@shared/types/platformSession'
import { HEALTH_LABEL, healthOf } from '@shared/utils/sessionHealth'
import { MANUAL_REASON, needsSessionUpdate } from '@shared/utils/sessionTargets'
import { platformKey } from '@shared/utils/platformKey'
import { listPlatforms, sessionHealth } from '@renderer/services/platformSession.service'
import { capturingNow, onSessionCapturing, onSessionsChanged } from '@renderer/services/sessionEvents'
import { lastSessionFailures } from '@renderer/services/sessionRunReasons'
import { SkipPlatformButton } from './SkipPlatformButton'
import { WORKING_NOW_RING } from './workingNow'
import { classNames } from '@renderer/utils/format'

/**
 * Every marketplace the Login update covers, and where each one stands.
 *
 * WHAT IT ANSWERS THAT THE ROW ABOVE DOES NOT. "2 updated, 4 failed, 2 timed
 * out, 6 refused" is a true sentence about a run and tells nobody which
 * marketplace to go and fix — and after a run that completed, the Sessions page
 * still showing red is the single most confusing thing this app does. It looks
 * like the schedule did not work. It did: those accounts were attempted and the
 * marketplace said no, and the only thing missing was anywhere to see that.
 *
 * THE COLOURS ARE A SEQUENCE, not a status:
 *
 *   grey   nothing to do, or nothing checked yet — the resting state
 *   red    accounts here need signing in again, and it says which and why
 *   amber  accounts here need a sign-in the run will NOT attempt — the login
 *          is unverified, or the platform is manual sign-in — and it says which
 *   ring   this marketplace is being signed in RIGHT NOW
 *   green  every account on it has a session the marketplace accepts
 *
 * WHY EVERY PLATFORM AND NOT JUST THE BROKEN ONES. A list that only shows work
 * cannot distinguish "Meesho is fine" from "Meesho was never looked at", and
 * those have opposite consequences at four in the morning. The grey chip is the
 * evidence that a platform was considered.
 *
 * THE REASON IS THE POINT OF THE RED ONE. `HEALTH_LABEL` says what the session
 * is (Expired, Rejected); the last run says what happened when the app tried to
 * fix it ("Flipkart did not accept the OTP after retry"), and those are two
 * different sentences leading to two different actions.
 */

interface PlatformRow {
  key: string
  label: string
  /** Accounts that still need a sign-in, with what is wrong with each. */
  outstanding: { username: string; state: string; reason: string | null }[]
  /**
   * Accounts that need a sign-in the unattended run will pass over, and why.
   * Amber, not red: nothing failed — the run is doing what it was told to.
   */
  skipped: { username: string; state: string; reason: string; detail: string }[]
  /** Accounts with a session the marketplace has not refused. */
  healthy: number
  /** No account configured at all — nothing for the job to do here. */
  empty: boolean
}

/**
 * Why the run will leave this account alone, or null when it will try it.
 *
 * The same two rules the job reads (`sessionUpdateTargets` and the task's
 * unattended check): a password the marketplace refused, and a platform whose
 * sign-in needs a person. `refused`, not `!isVerified` — absent means "nobody
 * has said", and the run still signs those in.
 */
const skipReason = (
  entry: PlatformCredentials | undefined,
  credential: CredentialRow
): { reason: string; detail: string } | null => {
  if (credential.refused === true) {
    return {
      reason: 'Skipped — unverified login',
      detail: 'The marketplace refused this password. Verify it on the Login page and the run will pick it up again.'
    }
  }

  if (entry && !entry.autoLogin) {
    return {
      reason: 'Skipped — manual sign-in',
      detail: MANUAL_REASON[entry.autoLoginBlockedBy ?? 'company']
    }
  }

  return null
}

const tone = (row: PlatformRow, capturing: boolean): string => {
  // ITS OWN STATE FIRST, then the ring if it is the one being signed in. The
  // ring used to REPLACE the colour with green, which said "this account is
  // fine" about an account that is being signed in precisely because it is
  // not.
  const base = row.empty
    ? 'bg-surface-active text-muted ring-1 ring-subtle'
    : row.outstanding.length > 0
      ? 'bg-danger-surface text-danger-fg ring-1 ring-danger-border'
      : row.skipped.length > 0
        ? 'bg-warning-surface text-warning-fg ring-1 ring-warning-border'
        : 'bg-success-surface text-success-fg ring-1 ring-success-border'

  return capturing ? `${base} ${WORKING_NOW_RING}` : base
}

export const SessionPlatformBoard = () => {
  const [platforms, setPlatforms] = useState<PlatformDescriptor[]>([])
  const [health, setHealth] = useState<PlatformCredentials[]>([])
  /** credential key → why the last run could not fix it. */
  const [reasons, setReasons] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(true)
  const [inFlight, setInFlight] = useState(capturingNow())

  const load = useCallback(async (): Promise<void> => {
    const [list, rows, failures] = await Promise.all([
      listPlatforms(),
      sessionHealth(),
      lastSessionFailures()
    ])

    if (list.success) setPlatforms(list.data)
    if (rows.success) setHealth(rows.data)
    setReasons(failures)
    setBusy(false)
  }, [])

  useEffect(() => {
    // Wrapped rather than called straight: every setState in `load` happens
    // after an await, and the lint rule reads the effect body literally — the
    // same shape RefillTargets and AutoClaimTargets use.
    void (async () => {
      await load()
    })()

    // The run writes sessions as it goes, so this follows it: a marketplace
    // turns green under the operator's eye rather than at the end.
    const stopChanged = onSessionsChanged(() => void load())
    const stopCapturing = onSessionCapturing(setInFlight)

    return () => {
      stopChanged()
      stopCapturing()
    }
  }, [load])

  const rows = useMemo((): PlatformRow[] => {
    const byKey = new Map(health.map(entry => [platformKey(entry.platform), entry]))

    return platforms
      .map(platform => {
        const bucket = byKey.get(platformKey(platform.key))
        const credentials = bucket?.credentials ?? []
        const needing = credentials.filter(credential => needsSessionUpdate(healthOf(credential.session)))
        const outstanding: PlatformRow['outstanding'] = []
        const skipped: PlatformRow['skipped'] = []

        for (const credential of needing) {
          const state = HEALTH_LABEL[healthOf(credential.session)]
          const skip = skipReason(bucket, credential)

          if (skip) {
            skipped.push({ username: credential.username, state, ...skip })
          } else {
            outstanding.push({
              username: credential.username,
              state,
              reason: reasons[`${platformKey(platform.key)}:${credential.username.toLowerCase()}`] ?? null
            })
          }
        }

        return {
          key: platformKey(platform.key),
          label: platform.label,
          outstanding,
          skipped,
          healthy: credentials.length - needing.length,
          empty: credentials.length === 0
        }
      })
      .sort((a, b) => {
        // Work first: a board read top-down should start with what is wrong.
        const weight = (row: PlatformRow): number =>
          row.outstanding.length > 0 ? 0 : row.skipped.length > 0 ? 1 : row.empty ? 3 : 2

        return weight(a) - weight(b) || a.label.localeCompare(b.label)
      })
  }, [platforms, health, reasons])

  if (busy) {
    return (
      <p className='flex items-center gap-2 text-xs text-muted'>
        <Loader2 size={14} className='animate-spin' /> Reading the logins…
      </p>
    )
  }

  if (rows.length === 0) {
    return <p className='text-xs text-muted'>No marketplace is configured for this company yet.</p>
  }

  return (
    <ul className='space-y-1.5'>
      {rows.map(row => {
        const capturing = platformKey(inFlight?.platform ?? '') === row.key

        return (
          <li key={row.key} className={classNames('rounded-md px-2.5 py-2 text-xs', tone(row, capturing))}>
            {/* Only on the one being signed in: a Skip on a marketplace the run
                has not reached would be a promise this cannot keep, since the
                queue may never get there. */}
            {capturing && (
              <span className='float-end'>
                <SkipPlatformButton taskId='session-refresh' platform={row.key} label={row.label} />
              </span>
            )}
            <div className='flex items-center gap-1.5'>
              {capturing ? (
                <Loader2 size={13} className='animate-spin' />
              ) : row.empty ? (
                <MinusCircle size={13} />
              ) : row.outstanding.length > 0 ? (
                <CircleAlert size={13} />
              ) : row.skipped.length > 0 ? (
                <TriangleAlert size={13} />
              ) : (
                <CheckCircle2 size={13} />
              )}
              <span className='font-medium'>{row.label}</span>
              <span className='opacity-80'>
                {capturing
                  ? `signing in ${inFlight?.username ?? ''}`
                  : row.empty
                    ? 'no login configured'
                    : [
                        row.outstanding.length > 0 ? `${row.outstanding.length} to update` : null,
                        row.skipped.length > 0 ? `${row.skipped.length} skipped` : null,
                        `${row.healthy} good`
                      ]
                        .filter(Boolean)
                        .join(' · ')}
              </span>
            </div>

            {/* The accounts, and WHY each is still outstanding. Only on the red
                ones: on a green platform this would be a list of nothing. */}
            {row.outstanding.length > 0 && (
              <ul className='mt-1 space-y-0.5 ps-5'>
                {row.outstanding.map(account => (
                  <li key={account.username} className='truncate opacity-90'>
                    {account.username} — {account.state}
                    {account.reason ? <span className='opacity-80'> · {account.reason}</span> : null}
                  </li>
                ))}
              </ul>
            )}

            {/* Skipped accounts, in amber even on a red platform: the run will
                not touch them, so they are not part of what failed. The full
                sentence is on hover; the line says which rule. */}
            {row.skipped.length > 0 && (
              <ul className='mt-1 space-y-0.5 ps-5'>
                {row.skipped.map(account => (
                  <li key={account.username} className='text-warning-fg' title={account.detail}>
                    <div className='truncate'>
                      {account.username} — {account.state}
                      <span className='opacity-80'> · {account.reason}</span>
                    </div>
                    <div className='whitespace-normal opacity-80'>{account.detail}</div>
                  </li>
                ))}
              </ul>
            )}
          </li>
        )
      })}
    </ul>
  )
}
