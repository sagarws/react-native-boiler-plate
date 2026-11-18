import { useState } from 'react'
import Link from '@mui/material/Link'
import { BROWSER_DOWNLOAD_LINKS } from '@shared/types/browserCheck'
import type { CredentialRow } from '@shared/types/platformSession'
import { Badge } from '@renderer/components/ui/Badge'
import { Button } from '@renderer/components/ui/Button'
import { Modal } from '@renderer/components/ui/Modal'
import { useToast } from '@renderer/hooks/useToast'
import { verifyCredential } from '@renderer/services/platformSession.service'

/**
 * Whether the marketplace accepts this login at all — and the way to fix it.
 *
 * SEPARATE FROM THE STATUS COLUMN, because they answer different questions and
 * were being read as one. Status is about the stored SESSION: is it still good?
 * This is about the CREDENTIAL: does the marketplace accept this password at
 * all? A refused password makes every capture fail for ever, and it used to say
 * so in a small chip beside the account name that nobody looked at.
 *
 * WHY THE BUTTON IS HERE and not in Actions. The flag is a dead end on its own:
 * once a marketplace has refused a password, every automation skips the account
 * and nothing in the app could set it back. The fix is a new password, so the
 * place to offer it is next to the word that says it is wrong.
 *
 * THE SAVED LOGIN FIRST. Verify signs in with the username and password
 * already in the company settings — no dialog. A refusal is often a session
 * problem or a password that has since been fixed elsewhere, and asking the
 * operator to retype a password they may not have is the wrong first move.
 * Only when the marketplace turns the saved login down does the dialog open,
 * with its words, for a corrected one.
 *
 * THE DIALOG DOES NOT TRUST ITSELF. Typing a password proves nothing, so saving
 * it is followed by a real sign-in and the flag records what that concluded —
 * see `verifyCredential` in the main process for why the order is write, try,
 * write, rather than the optimistic one.
 */
/**
 * The core's "matching ChromeDriver … could not be downloaded" refusal. Matched
 * on its words because only the message crosses IPC, not the error's `reason`.
 */
const isDriverDownloadRefusal = (message: string): boolean =>
  /ChromeDriver/i.test(message) && /could not be downloaded/i.test(message)

export const VerifiedCell = ({
  platform,
  credential
}: {
  /** Lower-cased platform key. */
  platform: string
  credential: CredentialRow
}) => {
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [username, setUsername] = useState(credential.username)
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [refusal, setRefusal] = useState<string | null>(null)

  const [checking, setChecking] = useState(false)

  /** Verify: sign in with the saved login; ask for a new one only if it is refused. */
  const start = async (): Promise<void> => {
    setChecking(true)

    const response = await verifyCredential({
      platform,
      username: credential.username,
      newUsername: credential.username,
      password: ''
    })

    setChecking(false)

    if (response.success) {
      toast.info(`${credential.username} verified — it is back in the automations.`)

      return
    }

    setUsername(credential.username)
    setPassword('')
    setRefusal(`The saved login was refused: ${response.error.message}`)
    setOpen(true)
  }

  const submit = async (): Promise<void> => {
    setBusy(true)
    setRefusal(null)

    const response = await verifyCredential({
      platform,
      username: credential.username,
      newUsername: username.trim(),
      password
    })

    setBusy(false)

    if (!response.success) {
      // Shown IN the dialog, not as a toast: the operator is mid-correction and
      // the next thing they do is type a different password. A toast would send
      // them back to a list with no idea what to try.
      setRefusal(response.error.message)

      return
    }

    setOpen(false)
    toast.info(`${credential.username} verified — it is back in the automations.`)
  }

  return (
    <>
      <div className='flex items-center gap-1.5'>
        {credential.isVerified ? (
          <Badge tone='success'>Verified</Badge>
        ) : (
          <>
            <Badge tone='danger'>Unverified</Badge>
            <Button size='sm' variant='secondary' loading={checking} disabled={checking} onClick={() => void start()}>
              {checking ? 'Signing in…' : 'Verify'}
            </Button>
          </>
        )}
      </div>

      <Modal
        open={open}
        onClose={() => (busy ? undefined : setOpen(false))}
        title={`Verify ${credential.username}`}
      >
        <div className='flex flex-col gap-3'>
          <p className='text-sm text-textSecondary'>
            {/* Says what will happen, because it is more than a save: it opens a
                browser and signs in, which takes a moment and may fail. */}
            The saved login was tried and the marketplace refused it, so every automation is
            skipping it. Correct it below and TrackVid will sign in with it — it goes back into the
            automations only if that sign-in works.
          </p>

          <label className='flex flex-col gap-1 text-sm'>
            <span className='text-textSecondary'>Username</span>
            <input
              value={username}
              disabled={busy}
              onChange={event => setUsername(event.target.value)}
              className='rounded-md bg-surface px-2 py-1.5 text-textPrimary ring-1 ring-subtle'
            />
          </label>

          <label className='flex flex-col gap-1 text-sm'>
            <span className='text-textSecondary'>Password</span>
            <input
              type='password'
              value={password}
              disabled={busy}
              autoComplete='off'
              onChange={event => setPassword(event.target.value)}
              className='rounded-md bg-surface px-2 py-1.5 text-textPrimary ring-1 ring-subtle'
            />
          </label>

          {refusal !== null && (
            // The marketplace's own words. "Verification failed" would send
            // somebody to re-type the same password; "Invalid Username or
            // Password" tells them what to change.
            <div className='flex flex-col gap-1 rounded-md bg-danger-surface px-2 py-1.5 text-xs text-danger-fg ring-1 ring-danger-border'>
              <p>{refusal}</p>
              {isDriverDownloadRefusal(refusal) && (
                // Opening the page is the operator's own test of the block: if it
                // does not load in their browser, TrackVid cannot reach it either.
                <Link
                  href={BROWSER_DOWNLOAD_LINKS.chromedriver}
                  target='_blank'
                  rel='noreferrer'
                  underline='always'
                  color='inherit'
                  sx={{ fontSize: '0.75rem', fontWeight: 500 }}
                >
                  {BROWSER_DOWNLOAD_LINKS.chromedriver} <i className='tabler-external-link text-xs' />
                </Link>
              )}
            </div>
          )}

          <div className='flex justify-end gap-2'>
            <Button size='sm' variant='secondary' disabled={busy} onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              size='sm'
              loading={busy}
              disabled={busy || username.trim() === '' || password === ''}
              onClick={() => void submit()}
            >
              {busy ? 'Signing in…' : 'Save and verify'}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  )
}
