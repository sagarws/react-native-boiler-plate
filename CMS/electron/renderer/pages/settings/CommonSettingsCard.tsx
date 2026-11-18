import { useEffect, useState } from 'react'
import { Card } from '@renderer/components/ui/Card'
import { Switch } from '@renderer/components/ui/Switch'
import { useToast } from '@renderer/hooks/useToast'
import { preferencesClient, type Preferences } from '@renderer/services/preferences.service'

/**
 * Settings that belong to the whole installation rather than to one task or
 * one marketplace. First on the page, because it is what decides whether
 * anything below it runs at all.
 *
 * AUTOMATIONS AT LAUNCH. Every launch used to switch Automations on. That is
 * still the default; off opens the app with the switch off — the same off an
 * operator sets by hand in the sidebar, so it stays off until somebody moves
 * it. Changing this does not move the switch now; it decides the next launch.
 *
 * VISIBLE LOGIN INFO. Off by default: the Login page shows usernames only. On,
 * each login's password sits under its username with a copy button. The main
 * process checks this before it hands a password out, so off really is off.
 */
export const CommonSettingsCard = () => {
  const toast = useToast()
  const [preferences, setPreferences] = useState<Preferences | null>(null)
  const [busy, setBusy] = useState(false)
  const [loginInfoBusy, setLoginInfoBusy] = useState(false)

  useEffect(() => {
    let alive = true

    void preferencesClient.get().then(response => {
      if (alive && response.success) setPreferences(response.data)
    })

    return () => {
      alive = false
    }
  }, [])

  const toggle = async (enabled: boolean): Promise<void> => {
    setBusy(true)

    const response = await preferencesClient.setAutomationsOnAtLaunch(enabled)

    setBusy(false)

    if (!response.success) {
      toast.error(response.error.message)

      return
    }

    setPreferences(response.data)
    toast.success(
      enabled
        ? 'Automations will switch on when the app opens'
        : 'Automations will stay off when the app opens'
    )
  }

  const toggleLoginInfo = async (enabled: boolean): Promise<void> => {
    setLoginInfoBusy(true)

    const response = await preferencesClient.setShowLoginInfo(enabled)

    setLoginInfoBusy(false)

    if (!response.success) {
      toast.error(response.error.message)

      return
    }

    setPreferences(response.data)
    toast.success(
      enabled ? 'Passwords will show on the Login page' : 'Passwords are hidden on the Login page'
    )
  }

  return (
    <Card
      icon={<i className='tabler-settings' />}
      title='Common settings'
      description='Applies to this installation as a whole.'
    >
      <div className='flex flex-col gap-5'>
        <Switch
          // Shown as ON until the stored answer arrives, because ON is what an
          // installation that has never chosen does.
          checked={preferences?.automationsOnAtLaunch !== false}
          disabled={busy || preferences === null}
          onChange={next => void toggle(next)}
          label='Automations on when the app opens'
          description={
            <>
              On: every launch switches Automations on and the schedule runs. Off: the app opens with
              Automations off, and nothing runs until you switch them on in the sidebar. Takes effect
              the next time the app opens.
            </>
          }
        />
        <Switch
          checked={preferences?.showLoginInfo === true}
          disabled={loginInfoBusy || preferences === null}
          onChange={next => void toggleLoginInfo(next)}
          label='Visible Login info'
          description={
            <>
              On: the Login page shows each account&apos;s password under its username, with a
              button to copy it. Off: usernames only.
            </>
          }
        />
      </div>
    </Card>
  )
}
