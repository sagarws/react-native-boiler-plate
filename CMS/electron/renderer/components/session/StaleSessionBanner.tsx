import { useCallback, useState } from 'react'
import { Button } from '@renderer/components/ui/Button'
import { useToast } from '@renderer/hooks/useToast'
import type { StaleEntry } from '@renderer/hooks/useStaleLogins'
import { recaptureSessions } from '@renderer/services/platformSession.service'
import Alert from '@mui/material/Alert'
import Chip from '@mui/material/Chip'

/**
 * "These sessions are not updated" — shown on the Login page.
 *
 * IT USED TO BE ON EVERY SIGNED-IN PAGE, for a good reason: a dead session is
 * not only a Login-page concern, it is why a claim fails on the queue and why
 * the Dashboard's numbers stopped moving, and an operator should not have to
 * visit a particular page to find that out.
 *
 * That reason still holds — which is why the WARNING did not move, only the
 * explanation did. The rail now carries a count on the Login entry on every
 * screen (see `useStaleLogins` and NAV_ITEMS), so the condition is still
 * visible everywhere; this strip, which names each platform and carries the
 * button that fixes them, now sits on the page where that work happens.
 *
 * What that buys: a full-width tinted band on all six screens, permanently, is
 * how a warning stops being read. A count in the rail does not wear out, and it
 * points at the page that explains itself.
 *
 * Renders nothing when everything is healthy, so it costs nothing visually on
 * the normal path.
 *
 * THE DATA COMES IN AS PROPS rather than from `useStaleLogins` directly, and
 * that is not a style preference. App already holds the hook to put the count
 * on the rail; mounting a second copy here would mean two components issuing
 * the same pair of IPC reads on every Login-page render and on every session
 * change — the duplicate requests the guidelines rule out. One reader, one
 * result, handed down.
 */

export interface StaleSessionBannerProps {
  /** One entry per platform with logins needing work — from `useStaleLogins`. */
  entries: StaleEntry[]
  /** Accounts, not platforms. The same number the rail badge shows. */
  accounts: number
}

export const StaleSessionBanner = ({
  entries: stale,
  accounts
}: StaleSessionBannerProps): React.JSX.Element | null => {
  const toast = useToast()
  const [updating, setUpdating] = useState(false)
  // The platform whose sign-in window is open right now, or null between rows.
  // Drives the green ring on that badge so an operator watching the banner can
  // see where the work is — otherwise a 30-second wait and a 5-minute wait look
  // identical from here.
  const [runningKey, setRunningKey] = useState<string | null>(null)

  /**
   * Re-captures each stale session in turn.
   *
   * Sequential, not parallel: every sign-in drives a real browser, several at
   * once would fight for the screen (and on Myntra, for the mouse), and one at a
   * time keeps a failure attributable to the platform it came from.
   */
  const updateAll = useCallback(async () => {
    setUpdating(true)

    // Snapshot the queue the operator pressed against. Every capture announces
    // a session change, which reloads `health` and recomputes `stale` —
    // iterating the live value would skip rows as they drop off. The shared
    // helper announces after EVERY capture, so the banner re-reads as it goes
    // rather than only at the end of a 30-minute batch.
    //
    // VERIFIED ONLY. The Create Claim banner lists unverified logins too, and
    // signing in with a password the marketplace has refused only repeats the
    // refusal — Delhivery locks the account after five. Those are named and
    // sent to Verify on the Login page instead.
    const queue = stale.flatMap(entry =>
      entry.stale
        .filter(credential => credential.isVerified && credential.refused !== true)
        .map(credential => ({
          platform: entry.platform.key,
          label: entry.platform.label,
          username: credential.username,
          credentialId: credential.credentialId
        }))
    )
    const needVerify = stale.flatMap(entry =>
      entry.stale
        .filter(credential => !credential.isVerified || credential.refused === true)
        .map(() => entry.platform.label)
    )

    if (needVerify.length > 0) {
      toast.info(
        `${[...new Set(needVerify)].join(', ')}: unverified — use Verify on the Login page first`
      )
    }

    if (queue.length === 0) {
      setUpdating(false)

      return
    }

    try {
      const { failed } = await recaptureSessions(queue, {
        onStart: target => setRunningKey(target.platform),
        onResult: (target, response) => {
          if (!response.success) toast.error(`${target.label}: ${response.error.message}`)
        }
      })

      if (failed === 0) toast.success('All logins updated')
    } finally {
      // finally, not after: an unexpected throw in captureSession left the
      // loader spinning forever and the banner unclickable. Whatever happens,
      // release the button and clear the running indicator.
      setRunningKey(null)
      setUpdating(false)
    }
  }, [stale, toast])

  if (stale.length === 0) return null

  return (
    /*
     * A PROPORTIONATE ALERT, not a red slab.
     *
     * This used to be a saturated full-width bar in `danger-solid`, and it was
     * the loudest thing on every screen — louder than a failed claim, louder
     * than the numbers it was warning about. Volume is a scarce resource and
     * this was spending all of it on a condition that is usually a five-minute
     * errand.
     *
     * So it takes the danger ROLE instead: a tint, a ring and readable text
     * (§32), which is the same vocabulary a failed row in the table uses. It
     * still sits above the page, still names every platform, and still carries
     * the one action that fixes it.
     *
     * NOT DISMISSIBLE, deliberately. A stale session is not a notification; it
     * is a statement that the next claim run will fail. It goes away when the
     * sessions are updated, which is the only thing that makes it untrue.
     */
    <Alert
      severity='error'
      icon={<i className='tabler-alert-circle' />}
      className='items-center'
      action={
        <Button size='sm' variant='secondary' loading={updating} onClick={() => void updateAll()}>
          Update now
        </Button>
      }
    >
      <div className='flex flex-wrap items-center gap-x-3 gap-y-1.5'>
        <span>
          <span className='font-medium'>
            {accounts === 1 ? '1 login needs updating' : `${accounts} logins need updating`}
          </span>{' '}
          — automations that sign in will fail until they are
        </span>

        <span className='flex flex-wrap items-center gap-1.5'>
          {stale.map(({ platform, stale: rows }) => (
            <Chip
              key={platform.key}
              size='small'
              variant='outlined'
              color={runningKey === platform.key ? 'success' : 'error'}
              title={rows.map(row => row.username).join(', ')}
              // Only when it says something — one is obviously one.
              label={rows.length > 1 ? `${platform.label} · ${rows.length}` : platform.label}
            />
          ))}
        </span>
      </div>
    </Alert>
  )
}
