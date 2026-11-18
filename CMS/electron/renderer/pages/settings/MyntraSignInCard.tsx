import { useEffect, useState } from 'react'
import { Card } from '@renderer/components/ui/Card'
import { MonitorOff } from 'lucide-react'
import { Switch } from '@renderer/components/ui/Switch'
import { useToast } from '@renderer/hooks/useToast'
import { preferencesClient, type Preferences } from '@renderer/services/preferences.service'

/**
 * How this machine signs in to Myntra.
 *
 * MYNTRA IS THE ONE LOGIN THAT NEEDS A SCREEN, and it is the reason this card
 * exists. Its LOG IN button ignores a synthetic click, so the established path
 * finishes the sign-in with a real mouse click at screen coordinates — which
 * means a window has to be open, on a display, with nothing over it. Every
 * other platform signs itself in with the window doing the typing.
 *
 * A capture of a successful sign-in shows the click produces one ordinary JSON
 * request. Submitting that from inside the page does the same job with no click
 * and no window, which is what this switch turns on.
 *
 * OFF BY DEFAULT, and the reason is honest: the login page also loads
 * reCAPTCHA. It asked for nothing in the capture, so it is invisible or
 * on-suspicion — and a browser signing in without a window is the kind of thing
 * that raises suspicion. If it is ever challenged, the run falls back to the
 * window and the click by itself; nothing is lost but the time.
 */

export const MyntraSignInCard = () => {
  const toast = useToast()
  const [preferences, setPreferences] = useState<Preferences | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void preferencesClient.get().then(response => {
      if (response.success) setPreferences(response.data)
    })
  }, [])

  const toggle = async (enabled: boolean): Promise<void> => {
    setBusy(true)

    const response = await preferencesClient.setMyntraHeadlessLogin(enabled)

    setBusy(false)

    if (!response.success) {
      toast.error(response.error.message)

      return
    }

    setPreferences(response.data)
    toast.success(
      enabled
        ? 'Myntra will sign in without opening a window'
        : 'Myntra will sign in the established way — window and click'
    )
  }

  return (
    <Card
      icon={<MonitorOff size={16} />}
      title="Myntra sign-in"
      description="Myntra is the only marketplace whose sign-in needs a window on screen: its LOG IN button ignores a scripted click, so the established path finishes with a real mouse click."
    >
      <Switch
        checked={preferences?.myntraHeadlessLogin === true}
        disabled={busy || preferences === null}
        onChange={next => void toggle(next)}
        label="Sign in without a window"
        description={
          <>
            Submits the same request the click produces, from inside the login page — so the
            nightly Login update can do Myntra with nobody at the machine. If Myntra answers with
            a captcha or asks for a code, the run falls back to the window and the click on its own.
          </>
        }
      />
    </Card>
  )
}
