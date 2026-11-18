import { useState } from 'react'
import { Modal } from '@renderer/components/ui/Modal'
import { Button } from '@renderer/components/ui/Button'
import { Input } from '@renderer/components/ui/Input'
import { Switch } from '@renderer/components/ui/Switch'
import { useDevMode } from '@renderer/context/DevModeContext'

/**
 * The password box behind five clicks on the logo.
 *
 * Deliberately unlabelled anywhere in the UI: an operator who has not been told
 * about developer mode has no reason to find it, and a menu item would be an
 * invitation. Five clicks is the convention for exactly this, and is hard to do
 * by accident.
 *
 * The password goes to the server and a yes or a no comes back — nothing here
 * ever holds it. The field is cleared on every close, so it does not sit in
 * memory or reappear the next time the box is opened.
 */
export const DevModeModal = ({ open, onClose }: { open: boolean; onClose: () => void }) => {
  const { devMode, unlock, disable } = useDevMode()
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  /**
   * What the toggle is showing, which is not yet what is stored.
   *
   * Flipping it changes nothing until Submit. Turning developer mode off takes
   * the extra screens away mid-session, and an operator who meant to look at
   * something and grazed a switch should get the chance not to.
   *
   * Keyed on the live value so it starts from the truth every time the box is
   * opened, without an effect to reset it.
   */
  const [wanted, setWanted] = useState<boolean | null>(null)
  const on = wanted ?? devMode

  /**
   * Closing clears the field.
   *
   * Done on the way out rather than on the way in: the value should not outlive
   * the box that collected it, and clearing on open would leave it sitting in
   * memory between one close and the next.
   */
  const close = (): void => {
    setPassword('')
    setError(null)
    // Discarded, not applied: an unsubmitted toggle is a change nobody made.
    setWanted(null)
    onClose()
  }

  const verify = async (): Promise<void> => {
    setBusy(true)

    const failure = await unlock(password)

    setBusy(false)
    setError(failure)

    if (!failure) close()
  }

  /** Applies the toggle. Leaving it on is a no-op, so Submit is always safe. */
  const submit = async (): Promise<void> => {
    if (on) {
      close()

      return
    }

    setBusy(true)
    await disable()
    setBusy(false)
    close()
  }

  return (
    <Modal
      open={open}
      title="Developer mode"
      description={
        devMode
          ? 'Developer mode is on for this installation.'
          : 'Extra screens for diagnosing this installation. Ask an administrator for the password.'
      }
      onClose={close}
      busy={busy}
      footer={
        devMode ? (
          <>
            <Button variant="secondary" onClick={close} disabled={busy}>
              Cancel
            </Button>
            <Button
              // Danger only when it is about to take something away — a Submit
              // that changes nothing should not look like one that does.
              variant={on ? 'primary' : 'danger'}
              onClick={() => void submit()}
              loading={busy}
            >
              Submit
            </Button>
          </>
        ) : (
          <>
            <Button variant="secondary" onClick={close} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={() => void verify()} loading={busy} disabled={!password}>
              Verify
            </Button>
          </>
        )
      }
    >
      {devMode ? (
        <div className="space-y-3">
          <Switch
            checked={on}
            onChange={setWanted}
            label="Developer mode"
            description={
              on
                ? 'On for this installation, including after a restart.'
                : 'Turning it off hides the bulk tools and the company data view until it is unlocked again.'
            }
          />

          <p className="text-xs text-muted">
            Everything it shows is data this account can already read — it is off by default so
            those screens are not on by accident. Unlocking it again needs the password.
          </p>
        </div>
      ) : (
        <form
          onSubmit={event => {
            event.preventDefault()
            void verify()
          }}
        >
          <Input
            autoFocus
            type="password"
            aria-label="Developer-mode password"
            placeholder="Password"
            value={password}
            onChange={event => {
              setPassword(event.target.value)
              // Cleared as soon as they start correcting it — a stale "wrong
              // password" under a field being retyped reads as a second refusal.
              setError(null)
            }}
          />

          {error && (
            <p role="alert" className="mt-2 text-xs text-danger-fg">
              {error}
            </p>
          )}
        </form>
      )}
    </Modal>
  )
}
