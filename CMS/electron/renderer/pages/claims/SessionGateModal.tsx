import { useState } from 'react'
import Alert from '@mui/material/Alert'
import Divider from '@mui/material/Divider'
import Paper from '@mui/material/Paper'
import Typography from '@mui/material/Typography'
import { Badge, type BadgeTone } from '@renderer/components/ui/Badge'
import { Button } from '@renderer/components/ui/Button'
import { Modal } from '@renderer/components/ui/Modal'
import { useToast } from '@renderer/hooks/useToast'
import { recaptureSessions } from '@renderer/services/platformSession.service'
import type { InactiveAccount } from '@shared/utils/sessionPreflight'

/**
 * A marketplace action stopped before it started anything: some of the accounts
 * it needs have a session that is expired, never captured, or no longer accepted.
 *
 * Nothing has started, so the operator loses nothing by fixing it first. Offers
 * the re-capture right here — the same sign-in the Sessions page and the banner
 * run — for every account it can; a login that is not on this machine at all
 * cannot be re-captured and says so.
 *
 * The action NAMES ITSELF ("Create Ticket", "Check TAT", …) because the dialog
 * is the same for all of them and "press it again" is useless advice when five
 * buttons could have raised it.
 *
 * SOME ACCOUNTS ARE OPTIONAL. A login whose sign-in costs a one-time code is an
 * errand — somebody has to go and fetch a code — and the action rarely needs
 * that particular account: a refill across six logins wants the five that can
 * answer. Those are listed because they explain why the run will be narrower
 * than expected, badged so nobody hunts for a code that nothing is waiting on,
 * and never the reason the dialog opened.
 */

interface Props {
  accounts: InactiveAccount[] | null
  /** The button that was pressed, as it reads on screen. */
  action: string
  onClose: () => void
  /**
   * Asks the same question again, after a re-capture — see `recheckGate`.
   *
   * Without it this dialog ends at "press it again", which is fine when the
   * capture worked and a trap when it did not: the operator presses, the same
   * dialog returns, and nothing says the server still has no session.
   */
  onRecheck?: () => Promise<InactiveAccount[] | null>
}

const STATE: Record<InactiveAccount['state'], { label: string; tone: BadgeTone }> = {
  expired: { label: 'Login expired', tone: 'danger' },
  none: { label: 'Never captured', tone: 'warning' },
  missing: { label: 'No login on this machine', tone: 'neutral' },
  // Not the same as expired, and worth saying so: the stored session has not
  // run out, the marketplace has stopped accepting it. An operator reading
  // "expired" next to a session captured this morning would reasonably think
  // the app was wrong.
  dead: { label: 'Marketplace rejected it', tone: 'danger' }
}

const title = (platform: string): string => platform.charAt(0).toUpperCase() + platform.slice(1)

export const SessionGateModal = ({ accounts, action, onClose, onRecheck }: Props) => {
  const toast = useToast()
  const [capturing, setCapturing] = useState<string | null>(null)

  /**
   * Re-capture takes the REQUIRED ones only.
   *
   * An optional account can be signed in from the Sessions page by anybody who
   * wants to; making it part of a batch here would hand an operator a queue of
   * OTP windows to sit through for accounts the run does not need.
   */
  const recapturable = (accounts ?? []).flatMap(account =>
    account.credentialId && !account.optional
      ? [{ platform: account.platform, username: account.username, credentialId: account.credentialId }]
      : []
  )

  const optional = (accounts ?? []).filter(account => account.optional)

  const recapture = async (): Promise<void> => {
    try {
      const { failed } = await recaptureSessions(recapturable, {
        onStart: target => setCapturing(`${target.platform}::${target.username}`),
        onResult: (target, response) => {
          if (!response.success) toast.error(`${title(target.platform)} (${target.username}): ${response.error.message}`)
        }
      })

      if (failed !== 0) return

      // Ask again rather than assume. A capture can report success and still
      // leave the server without a session — and telling the operator to press
      // a button that will re-open this dialog is the worst way to find out.
      const still = onRecheck ? await onRecheck() : []

      if (!still || still.filter(account => !account.optional).length === 0) {
        toast.success(`Logins updated — press ${action} again`)
        onClose()

        return
      }

      toast.error(
        `Signed in, but TrackVid still reports no live login for ` +
          `${still.map(account => account.username).join(', ')}. Nothing was started.`
      )
    } finally {
      setCapturing(null)
    }
  }

  return (
    <Modal
      open={accounts !== null}
      title="Update logins first"
      description={`Nothing was started. Kindly re-capture these logins, then press ${action} again.`}
      onClose={onClose}
      busy={capturing !== null}
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose} disabled={capturing !== null}>
            Cancel
          </Button>
          <Button
            size="sm"
            icon={<i className="tabler-refresh text-base" />}
            loading={capturing !== null}
            disabled={recapturable.length === 0}
            onClick={() => void recapture()}
          >
            Re-capture {recapturable.length > 1 ? `${recapturable.length} logins` : 'login'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Alert severity="warning" icon={<i className="tabler-alert-circle text-base" />}>
          {action} on an account without a live login would stop partway, for every row of that
          account. Re-capture opens each sign-in window in turn.
        </Alert>

        {/* Every account that needs one, not the first of them — a platform can
            hold a dozen logins, so the list scrolls rather than pushing the
            re-capture button off the screen. */}
        <Paper variant="outlined" component="ul" className="m-0 max-h-64 list-none overflow-y-auto p-0">
          {(accounts ?? []).map((account, index) => {
            const key = `${account.platform}::${account.username}`

            return (
              <li key={key}>
                {index > 0 && <Divider />}
                <div className="flex items-center gap-3 plb-2 pli-3">
                  <Typography variant="body2" color="text.primary" className="w-24 shrink-0 font-medium">
                    {title(account.platform)}
                  </Typography>
                  <Typography
                    variant="body2"
                    color="text.secondary"
                    className="min-is-0 flex-1 truncate"
                    title={account.username}
                  >
                    {account.username}
                  </Typography>
                  {capturing === key ? (
                    <Badge tone="warning">Signing in…</Badge>
                  ) : (
                    <>
                      {account.optional && <Badge tone="neutral">Optional</Badge>}
                      <Badge tone={account.optional ? 'neutral' : STATE[account.state].tone}>
                        {STATE[account.state].label}
                      </Badge>
                    </>
                  )}
                </div>
              </li>
            )
          })}
        </Paper>

        {optional.length > 0 && (
          <Typography variant="caption" color="text.secondary">
            {optional.length === 1
              ? `${optional[0]?.username} signs in with a one-time code.`
              : `${optional.length} of these sign in with a one-time code.`}{' '}
            You can leave {optional.length === 1 ? 'it' : 'them'} — {action} will run without{' '}
            {optional.length === 1 ? 'that account' : 'those accounts'}, and their rows stay as
            they are. Capture {optional.length === 1 ? 'it' : 'them'} from the Login page when
            you have the code to hand.
          </Typography>
        )}

        {(accounts ?? []).some(account => account.state === 'missing') && (
          <Typography variant="caption" color="text.secondary">
            An account with no login on this machine has to be added to the company (and synced) before
            anything can run for it here.
          </Typography>
        )}
      </div>
    </Modal>
  )
}
