import { useState } from 'react'
import Alert from '@mui/material/Alert'
import MenuItem from '@mui/material/MenuItem'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import type { PlatformDescriptor } from '@shared/types/platformSession'
import { credentialFieldsFor } from '@shared/constants/credentialFields'
import { Button } from '@renderer/components/ui/Button'
import { Modal } from '@renderer/components/ui/Modal'
import { useToast } from '@renderer/hooks/useToast'
import { addCredential } from '@renderer/services/platformSession.service'

/**
 * Add a marketplace login — the Login page's counterpart to the admin panel's
 * "Add Account", with the same fields per platform (see credentialFields).
 *
 * VERIFIED BY SIGNING IN, not by a check that says nothing. Saving stores the
 * login unverified and then signs in with it exactly as Re-capture does — on
 * this machine, honouring the platform's Auto/Manual sign-in — so a working
 * login comes back Verified with a session already saved. One that does not
 * sign in is kept, marked unverified, and its reason is shown here.
 *
 * Mounted only while open, so every opening starts from an empty form.
 */
export const AddCredentialModal = ({
  open,
  platforms,
  onClose,
  onAdded
}: {
  open: boolean
  platforms: PlatformDescriptor[]
  onClose: () => void
  /** Called after a save, verified or not — the page re-reads the list. */
  onAdded: () => void
}) => {
  const toast = useToast()
  const [platform, setPlatform] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [accountType, setAccountType] = useState('')
  const [phoneNumber, setPhoneNumber] = useState('')
  const [vendorCode, setVendorCode] = useState('')
  const [cloudflareEmail, setCloudflareEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  /** Saved but not verified: a second save would only be refused as a duplicate. */
  const [saved, setSaved] = useState(false)
  /** Set by the first Save press, so empty fields are marked only once it has been tried. */
  const [tried, setTried] = useState(false)

  const fields = credentialFieldsFor(platform)

  // NOTHING PRE-SELECTED. A default account type (Myntra's FBM, AJIO's VMS) was
  // saved without anyone choosing it, and a wrong one files claims under the
  // wrong partner shape — so it is chosen, every time, like every other field.
  const choosePlatform = (next: string): void => {
    setPlatform(next)
    setAccountType('')
  }

  /** What each field is missing, by field — every field shown is required. */
  const errors = {
    platform: platform ? null : 'Choose a marketplace',
    username: username.trim() ? null : 'Enter the username or email',
    password: password ? null : 'Enter the password',
    accountType: fields.accountTypes && !accountType ? 'Choose the account type' : null,
    phoneNumber: fields.phoneNumber && !phoneNumber.trim() ? `Enter the ${fields.phoneNumber.label.toLowerCase()}` : null,
    vendorCode: fields.vendorCode && !vendorCode.trim() ? `Enter the ${fields.vendorCode.label.toLowerCase()}` : null,
    // Optional, so only a malformed address is an error — never an empty one.
    cloudflareEmail:
      fields.cloudflareEmail && cloudflareEmail.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cloudflareEmail.trim())
        ? 'Enter a valid email, or leave it empty'
        : null
  }
  const invalid = Object.values(errors).some(message => message !== null)
  /** The message under a field — only after Save has been pressed. */
  const shown = (message: string | null): { error: boolean; helperText?: string } =>
    tried && message ? { error: true, helperText: message } : { error: false }

  const submit = async (): Promise<void> => {
    setTried(true)

    if (invalid) {
      setProblem('Fill in every field to add this login.')

      return
    }

    setBusy(true)
    setProblem(null)

    const response = await addCredential({
      platform,
      username: username.trim(),
      password,
      ...(fields.accountTypes ? { accountType } : {}),
      ...(fields.phoneNumber ? { phoneNumber: phoneNumber.trim() } : {}),
      ...(fields.vendorCode ? { vendorCode: vendorCode.trim() } : {}),
      ...(fields.cloudflareEmail && cloudflareEmail.trim() ? { cloudflareEmail: cloudflareEmail.trim() } : {})
    })

    setBusy(false)

    if (!response.success) {
      // Nothing was saved — a duplicate, a missing field, the server down.
      setProblem(response.error.message)

      return
    }

    onAdded()

    if (response.data.verified) {
      toast.success(`${username.trim()} added and verified — it is in the automations.`)
      onClose()

      return
    }

    setSaved(true)

    // Saved, but the sign-in did not prove it. Said here, not in a toast: the
    // next thing to do is usually to fix the password with Verify on its row.
    setProblem(
      `Saved, but not verified — ${response.data.reason ?? 'the sign-in did not complete'}. ` +
        'It stays out of the automations until Verify on its row succeeds.'
    )
  }

  const label = platforms.find(entry => entry.key === platform)?.label ?? 'the marketplace'

  return (
    <Modal open={open} onClose={() => (busy ? undefined : onClose())} title='Add login'>
      <Stack spacing={2}>
        <Typography variant='body2' color='text.secondary'>
          The login is saved, then TrackVid signs in with it to check it. It goes into the automations
          only if that sign-in works.
        </Typography>

        <TextField
          select
          size='small'
          label='Marketplace'
          required
          value={platform}
          disabled={busy}
          {...shown(errors.platform)}
          onChange={event => choosePlatform(event.target.value)}
        >
          {platforms.map(entry => (
            <MenuItem key={entry.key} value={entry.key}>
              {entry.label}
            </MenuItem>
          ))}
        </TextField>

        <TextField
          size='small'
          label='Username / email'
          required
          {...shown(errors.username)}
          value={username}
          disabled={busy}
          autoComplete='off'
          onChange={event => setUsername(event.target.value)}
        />

        <TextField
          size='small'
          type='password'
          label='Password'
          required
          {...shown(errors.password)}
          value={password}
          disabled={busy}
          autoComplete='new-password'
          onChange={event => setPassword(event.target.value)}
        />

        {fields.accountTypes && (
          <TextField
            select
            size='small'
            label='Account type'
            required
            {...shown(errors.accountType)}
            value={accountType}
            disabled={busy}
            onChange={event => setAccountType(event.target.value)}
          >
            {fields.accountTypes.map(option => (
              <MenuItem key={option.value} value={option.value}>
                {option.label}
              </MenuItem>
            ))}
          </TextField>
        )}

        {fields.phoneNumber && (
          <TextField
            size='small'
            label={fields.phoneNumber.label}
            required
            {...shown(errors.phoneNumber)}
            value={phoneNumber}
            disabled={busy}
            onChange={event => setPhoneNumber(event.target.value)}
          />
        )}

        {fields.vendorCode && (
          <TextField
            size='small'
            label={fields.vendorCode.label}
            required
            {...shown(errors.vendorCode)}
            value={vendorCode}
            disabled={busy}
            onChange={event => setVendorCode(event.target.value)}
          />
        )}

        {fields.cloudflareEmail && (
          <TextField
            size='small'
            type='email'
            label={fields.cloudflareEmail.label}
            placeholder={fields.cloudflareEmail.placeholder}
            {...(tried && errors.cloudflareEmail
              ? { error: true, helperText: errors.cloudflareEmail }
              : {
                  error: false,
                  helperText: `Inbox Cloudflare mails its login code to. Empty uses ${fields.cloudflareEmail.placeholder}.`
                })}
            value={cloudflareEmail}
            disabled={busy}
            autoComplete='off'
            onChange={event => setCloudflareEmail(event.target.value)}
          />
        )}

        {problem !== null && <Alert severity='warning'>{problem}</Alert>}

        <Stack direction='row' spacing={1} justifyContent='flex-end'>
          <Button size='sm' variant='secondary' disabled={busy} onClick={onClose}>
            {problem !== null ? 'Close' : 'Cancel'}
          </Button>
          {!saved && (
            <Button size='sm' loading={busy} disabled={busy} onClick={() => void submit()}>
              {busy ? `Signing in to ${label}…` : 'Save and verify'}
            </Button>
          )}
        </Stack>
      </Stack>
    </Modal>
  )
}
