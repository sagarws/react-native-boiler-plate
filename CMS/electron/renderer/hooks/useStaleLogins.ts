import { useEffect, useMemo, useState } from 'react'
import { PLATFORM_SESSION_CHANNELS } from '@shared/constants/channels'
import type {
  CredentialRow,
  PlatformCredentials,
  PlatformDescriptor
} from '@shared/types/platformSession'
import { sessionUpdateTargets } from '@shared/utils/sessionTargets'
import { healthOf } from '@shared/utils/sessionHealth'
import { invoke } from '@renderer/services/ipcClient'
import { onSessionsChanged } from '@renderer/services/sessionEvents'

/**
 * Which marketplace logins the app is going to have to re-capture.
 *
 * LIFTED OUT OF StaleSessionBanner so two places can ask the same question.
 * The banner is no longer on every screen — it explains the problem on the
 * Login page, where the fix is — and the rail carries a count on the Login
 * entry everywhere else. Those two MUST agree: a rail saying 2 over a page
 * listing 3 is worse than either number alone, and that is exactly the
 * contradiction the note inside `stale` records happening once before.
 *
 * One hook, one rule, one number. Both callers mount their own copy, which
 * costs two IPC reads on a page change and keeps them independent; the reads
 * are cheap and both re-run on `onSessionsChanged` anyway.
 */

export interface StaleEntry {
  platform: PlatformDescriptor
  stale: CredentialRow[]
}

export interface StaleLogins {
  /** One entry per platform that has at least one login needing work. */
  entries: StaleEntry[]
  /** Accounts, not platforms — what the banner and the badge both count. */
  accounts: number
  /**
   * Logins a CLAIM cannot be filed with right now — for the Create Claim page.
   *
   * Wider than `entries`: every login with no working session, whether or not
   * it is verified, and including a platform whose automatic sign-in is off in
   * Monitor (Myntra, "Manual") — the Login update cannot sign that one in
   * unattended, but a claim on it still needs a live session. Narrower on one
   * point: an `expiring` session still files a claim, so it is not here.
   */
  claimEntries: StaleEntry[]
  claimAccounts: number
}

export const useStaleLogins = (): StaleLogins => {
  const [platforms, setPlatforms] = useState<PlatformDescriptor[]>([])
  const [health, setHealth] = useState<PlatformCredentials[]>([])

  useEffect(() => {
    // `cancelled` matters here: this lives for the whole signed-in session, and
    // an in-flight read can outlive a sign-out.
    let cancelled = false

    const load = async (): Promise<void> => {
      const [platformList, healthList] = await Promise.all([
        invoke<PlatformDescriptor[]>(PLATFORM_SESSION_CHANNELS.list),
        invoke<PlatformCredentials[]>(PLATFORM_SESSION_CHANNELS.health)
      ])

      if (cancelled) return
      if (platformList.success) setPlatforms(platformList.data)
      if (healthList.success) setHealth(healthList.data)
    }

    void load()

    // A capture anywhere in the app changes what belongs here, and the Sessions
    // page is a child of the layout rather than a parent, so it cannot pass the
    // news down.
    const unsubscribe = onSessionsChanged(() => void load())

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])

  const byPlatform = useMemo(
    () => new Map(health.map((entry) => [entry.platform, entry])),
    [health]
  )

  /**
   * The accounts the Session update will work on — `sessionUpdateTargets`, the
   * same function the nightly task and the Settings card call.
   *
   * IT USED TO HAVE ITS OWN RULE, expired-or-never-captured, and that made the
   * app contradict itself on one screen: the banner named Snapdeal while the
   * list under Session update named Snapdeal AND Myntra, whose session was
   * expiring. Both were "right" by their own rule, which is exactly the problem
   * — an operator cannot tell which number to believe, so they believe neither.
   *
   * So `expiring` is counted here. The argument for leaving it out was that a
   * session with hours left still works and red teaches people to ignore the
   * warning; the argument against is that this and the button on it are about
   * what the app is going to re-capture, and it was hiding a third of that.
   * One rule, one set of names, every screen.
   *
   * The CLAIM GATE keeps its own narrower rule on purpose — see
   * shared/utils/sessionPreflight. That answers a different question ("can this
   * claim be filed right now"), where an expiring session is a yes.
   */
  const entries = useMemo<StaleEntry[]>(() => {
    const known = new Set(platforms.map((platform) => platform.key))
    const targets = sessionUpdateTargets(health, (key) => known.has(key))

    return platforms
      .map((platform) => ({
        platform,
        stale: (byPlatform.get(platform.key)?.credentials ?? []).filter((credential) =>
          targets.some(
            (target) =>
              target.platform === platform.key && target.username === credential.username
          )
        )
      }))
      .filter((entry) => entry.stale.length > 0)
  }, [platforms, byPlatform, health])

  const accounts = useMemo(
    () => entries.reduce((total, entry) => total + entry.stale.length, 0),
    [entries]
  )

  const claimEntries = useMemo<StaleEntry[]>(
    () =>
      platforms
        .map((platform) => ({
          platform,
          stale: (byPlatform.get(platform.key)?.credentials ?? []).filter((credential) => {
            // EVERY login, verified or not: a claim on any of them is passed
            // over until it has a live session, and the operator asked to see
            // all of them here. An unverified one needs Verify on the Login page
            // before a re-capture can work — its badge there says so.
            if (credential.visible === false) return false

            const state = healthOf(credential.session)

            return state === 'expired' || state === 'rejected' || state === 'none'
          })
        }))
        .filter((entry) => entry.stale.length > 0),
    [platforms, byPlatform]
  )

  const claimAccounts = useMemo(
    () => claimEntries.reduce((total, entry) => total + entry.stale.length, 0),
    [claimEntries]
  )

  return { entries, accounts, claimEntries, claimAccounts }
}
