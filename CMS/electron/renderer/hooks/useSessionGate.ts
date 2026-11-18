import { useCallback, useState } from 'react'
import { useToast } from '@renderer/hooks/useToast'
import { recaptureSessions, sessionHealth } from '@renderer/services/platformSession.service'
import { autoCaptureOnRunningProcess } from '@renderer/utils/sessionCapture'
import { checkClaimSessions } from '@renderer/services/claimQueue.service'
import { inactiveAccounts, type AccountRef, type InactiveAccount } from '@shared/utils/sessionPreflight'

/**
 * Nothing that talks to a marketplace starts on a session that cannot talk to
 * it — Create Ticket, Check TAT, Refill, account mapping, the SKU sweep.
 *
 * It lived inside Create Ticket first, which is how the other four came to spend
 * a browser and several minutes per account discovering, one row at a time, what
 * one round trip could have said up front. The check belongs to the API call,
 * not to the button, so it is here and every caller runs the same one.
 *
 * TWO CHECKS, in cost order:
 *
 *   1. the stored record  — expired or never captured, free, the banner's rule
 *   2. the marketplace    — in date and no longer accepted, one probe per account
 *
 * Both fail CLOSED: a health read that errors stops the action, because
 * "unknown" is exactly the case this guards against.
 *
 * ONE DIALOG, BOTH ANSWERS. The checks used to report in turn: the expired ones
 * stopped the run, and the accounts the marketplace had quietly stopped
 * accepting only appeared on the NEXT press, after the first lot were
 * re-captured. On a refill across six logins that is six sign-ins spread over as
 * many attempts. So the probe runs on everything the stored check cleared, and
 * the operator is shown every account that needs attention at once.
 *
 * The caller says WHICH accounts, and the two kinds are not interchangeable:
 * an action that works through the rows on screen passes those rows' accounts,
 * while one that sweeps every login on the platform — refill, mapping — has to
 * pass the platform, or it would clear a gate for one account and then use six.
 */

export type GateTarget =
  /** Exactly these accounts — the ones the ticked rows name. */
  | { accounts: readonly AccountRef[] }
  /** Every login this company holds on the platform, because the run uses them all. */
  | { platform: string }

interface Gate {
  accounts: InactiveAccount[]
  /** Named on the dialog, so it says which button to press once the sessions are back. */
  action: string
  /**
   * What was being checked, kept so the dialog can ask again after a
   * re-capture — see `recheckGate`.
   */
  target: GateTarget
}

const platformKey = (value: string): string => value.trim().toLowerCase().replace(/\s+/g, '')

/** One account, however the two checks spell its platform and login. */
const id = (platform: string, username: string): string =>
  `${platformKey(platform)}::${username.trim().toLowerCase()}`

type HealthEntries = Extract<Awaited<ReturnType<typeof sessionHealth>>, { success: true }>['data']

/** Auto-login on for this platform, and nothing on this machine blocking it. */
const signsInByItself = (entries: HealthEntries, platform: string): boolean => {
  const entry = entries.find(candidate => platformKey(candidate.platform) === platformKey(platform))

  return entry?.autoLogin === true && !entry.autoLoginBlockedBy
}

export const useSessionGate = () => {
  const toast = useToast()

  /**
   * Re-captures what can sign in by itself and answers with what is STILL
   * blocking — re-read from the stored sessions, not assumed from the capture's
   * own report, the same check the dialog's recheck makes.
   *
   * UNATTENDED: scripted or nothing. A sign-in window opening in the middle of
   * Create Ticket is exactly the interruption this exists to remove; an account
   * that cannot be signed in by script is left for the dialog instead.
   */
  const recaptureAutomatically = useCallback(
    async (required: InactiveAccount[], entries: HealthEntries, action: string): Promise<InactiveAccount[]> => {
      const capturable = required.filter(
        account => account.credentialId && signsInByItself(entries, account.platform)
      )

      if (capturable.length === 0) return required

      toast.info(`Re-capturing ${capturable.length} expired login(s) — ${action} will carry on`)

      const captured = new Set<string>()

      await recaptureSessions(
        capturable.map(account => ({
          platform: account.platform,
          username: account.username,
          credentialId: account.credentialId as string
        })),
        {
          unattended: true,
          onResult: (target, response) => {
            if (response.success) captured.add(id(target.platform, target.username))
            else toast.error(`${target.platform} (${target.username}): ${response.error.message}`)
          }
        }
      )

      if (captured.size === 0) return required

      const fresh = await sessionHealth()
      const stillStale = fresh.success
        ? new Set(
            inactiveAccounts(
              required.filter(account => captured.has(id(account.platform, account.username))),
              fresh.data
            ).map(account => id(account.platform, account.username))
          )
        : new Set<string>()

      const remaining = required.filter(account => {
        const key = id(account.platform, account.username)

        return !captured.has(key) || stillStale.has(key)
      })

      const fixed = required.length - remaining.length

      if (fixed > 0) toast.success(`${fixed} login(s) re-captured — continuing ${action}`)

      return remaining
    },
    [toast]
  )
  const [gate, setGate] = useState<Gate | null>(null)

  const closeGate = useCallback(() => setGate(null), [])

  /**
   * The stored check, run again — used by the dialog after a re-capture.
   *
   * WHY IT EXISTS. The dialog used to end at "Sessions updated — press it
   * again", which is fine when the capture worked and a trap when it did not:
   * the operator presses, the same dialog returns, and nothing anywhere says
   * that the server still has no session for that account. Asking again here
   * turns that loop into an answer — either the gate is clear and the dialog
   * closes itself, or the account that is still blocking is named with what the
   * server now says about it.
   */
  const recheckGate = useCallback(async (): Promise<InactiveAccount[] | null> => {
    if (!gate) return null

    const health = await sessionHealth()

    if (!health.success) return null

    const target = gate.target
    const accounts: AccountRef[] =
      'accounts' in target
        ? [...target.accounts]
        : (
            health.data.find(entry => platformKey(entry.platform) === platformKey(target.platform))
              ?.credentials ?? []
          ).map(credential => ({ platform: target.platform, username: credential.username }))

    const optionalIds = new Set(
      health.data.flatMap(entry =>
        entry.credentials
          .filter(credential => credential.isOtpBased === true)
          .map(credential => id(entry.platform, credential.username))
      )
    )

    // The stored check only. The marketplace probe is not repeated: it was run
    // moments ago, and a session captured since is exactly what this is asking
    // about.
    const stale = inactiveAccounts(accounts, health.data).map(account => ({
      ...account,
      optional: account.optional || optionalIds.has(id(account.platform, account.username))
    }))

    setGate(current => (current ? { ...current, accounts: stale } : current))

    return stale
  }, [gate])

  /**
   * True when every account is good to go. False when it is not — the dialog is
   * already on screen by then, and the caller stops.
   *
   * @param directApiCall the action IS the HTTP call, so the stored session
   *        decides the run whatever claim flow this company uses. False only for
   *        filing a claim, where the registry knows some flows sign in anyway.
   */
  const ensureLiveSessions = useCallback(
    async (
      target: GateTarget,
      action: string,
      { directApiCall = true }: { directApiCall?: boolean } = {}
    ): Promise<boolean> => {
      // Read fresh: the banner's copy can be minutes old, and a session that
      // lapsed since the page loaded is precisely the one being asked about.
      const health = await sessionHealth()

      if (!health.success) {
        toast.error(`Could not check the accounts' logins — nothing was started. ${health.error.message}`)

        return false
      }

      const accounts: AccountRef[] =
        'accounts' in target
          ? [...target.accounts]
          : (health.data.find(entry => platformKey(entry.platform) === platformKey(target.platform))?.credentials ?? [])
              .map(credential => ({ platform: target.platform, username: credential.username }))

      // No account to check is not a pass to withhold: a platform this app keeps
      // no logins for (Nykaa signs in with the company's own) has nothing here
      // to stop, and its own flow reports what it finds.
      if (accounts.length === 0) return true

      /**
       * Which logins can be skipped: the ones whose sign-in costs a code.
       *
       * The probe answers with a platform and a username, not with the
       * credential, so the flag is looked up from the health read both checks
       * already share.
       */
      const optionalIds = new Set(
        health.data.flatMap(entry =>
          entry.credentials
            .filter(credential => credential.isOtpBased === true)
            .map(credential => id(entry.platform, credential.username))
        )
      )

      const stale = inactiveAccounts(accounts, health.data)
      const staleIds = new Set(stale.map(account => id(account.platform, account.username)))

      // Only what the first check cleared: an account already known to be
      // expired is not worth a round trip to be told the same thing.
      const worthProbing = accounts.filter(account => !staleIds.has(id(account.platform, account.username)))
      const probed = worthProbing.length > 0 ? await checkClaimSessions(worthProbing, { directApiCall }) : null

      if (probed && !probed.success) {
        // A probe that could not run does not hide the accounts already known to
        // be expired — those are still the operator's next move.
        if (stale.length > 0) setGate({ accounts: stale, action, target })
        else toast.error(`Could not check the accounts' logins — nothing was started. ${probed.error.message}`)

        return false
      }

      const blocked: InactiveAccount[] = [
        ...stale,
        ...(probed?.success ? probed.data : []).map(account => ({
          platform: account.platform,
          username: account.username,
          credentialId: account.credentialId,
          state: account.state,
          optional: optionalIds.has(id(account.platform, account.username))
        }))
      ]

      /**
       * ONLY THE REQUIRED ONES STOP THE RUN.
       *
       * An account whose sign-in costs a one-time code is an errand, and the
       * action rarely needs that particular login — a refill across six wants
       * the five that can answer. So those are shown when the dialog opens for
       * something else, and the run goes ahead without them when they are all
       * that is left. What it must not do is attempt them: the runner leaves an
       * account with no live session out of the sweep entirely.
       */
      let required = blocked.filter(account => !account.optional)

      /*
       * RE-CAPTURE AND CARRY ON — AUTO_SESSION_CAPTURE_ON_RUNNIG_PROCESS=true.
       *
       * The dialog below is the right answer when a person has to sign in. For
       * a platform whose auto-login is on, nobody does: the same Re-capture the
       * dialog offers runs here by itself, and the action goes ahead. Only what
       * that could not fix — a refused password, an OTP that never came, a
       * platform with auto-login off — still opens the dialog, named as before.
       */
      if (autoCaptureOnRunningProcess() && required.length > 0) {
        required = await recaptureAutomatically(required, health.data, action)
      }

      if (required.length > 0) {
        setGate({ accounts: [...required, ...blocked.filter(account => account.optional)], action, target })

        return false
      }

      if (blocked.length > 0) {
        toast.info(
          `${blocked.length} account(s) need a one-time code and were left out — ` +
            'the rest are being processed'
        )
      }

      return true
    },
    [toast, recaptureAutomatically]
  )

  return { gate, closeGate, ensureLiveSessions, recheckGate }
}
