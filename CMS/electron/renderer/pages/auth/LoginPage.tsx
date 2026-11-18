// React Imports
import { useEffect, useRef, useState } from 'react'

// MUI Imports
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Divider from '@mui/material/Divider'
import IconButton from '@mui/material/IconButton'
import InputAdornment from '@mui/material/InputAdornment'
import Typography from '@mui/material/Typography'

// Component Imports
import CustomTextField from '@core/components/mui/TextField'

import logoName from '@renderer/assets/logo-name.svg'
import type { ImpersonateInput, LoginInput } from '@shared/types/auth'
import { impersonateInputSchema, loginInputSchema } from '@shared/validation/auth.schema'
import { useAuth } from '@renderer/hooks/useAuth'
import { useToast } from '@renderer/hooks/useToast'

const EMPTY: LoginInput = { email: '', password: '' }

/**
 * Two ways in.
 *
 * `password` is the normal sign-in every user does. `impersonate` takes a user
 * id and no credential at all — it is a support tool, for reproducing what a
 * customer is seeing. The resulting session is indistinguishable from a real
 * one afterwards, so the mode is labelled plainly rather than tucked away, and
 * the screen says whose account you are about to enter.
 *
 * NOT A TAB ANY MORE. Two equal tabs told every operator, every morning, that
 * impersonation was half of how this app is entered. It is a secondary route
 * for a few support staff, so it sits under the primary action as a plain
 * labelled link — and only after the logo has been tapped to show it (see
 * TAPS_TO_REVEAL). Once shown, it is labelled as plainly as before.
 */
type Mode = 'password' | 'impersonate'

/** IMPERSON_LOGIN=true in .env. Off, the screen is email sign-in alone. */
const IMPERSONATION_ENABLED = __IMPERSON_LOGIN__

/**
 * The logo taps that show and hide the impersonation option.
 *
 * A way to keep the option off the screen of an operator looking over a
 * support person's shoulder, NOT a security control: a build without
 * IMPERSON_LOGIN=true ignores the taps, and the main process refuses the call
 * there anyway. Taps count only while they keep coming; a pause longer than
 * TAP_WINDOW_MS starts the count again.
 */
const TAPS_TO_REVEAL = 11
const TAPS_TO_HIDE = 2
const TAP_WINDOW_MS = 1500

/**
 * What the product does, in three marks.
 *
 * Two lines each, broken deliberately rather than by wrapping: the pairs read
 * as pairs. Tabler, like every other icon in the app — `npm run icons` picks
 * these class names up.
 */
const BRAND_POINTS: readonly { icon: string; lines: readonly [string, string] }[] = [
  { icon: 'tabler-video', lines: ['Record', 'Every Dispatch'] },
  { icon: 'tabler-shield-check', lines: ['Resolve', 'Every Claim'] },
  { icon: 'tabler-chart-bar', lines: ['More Trust', 'Less Fraud'] }
]

const COPY: Record<Mode, { title: string; subtitle: string }> = {
  password: { title: 'Welcome back', subtitle: 'Sign in to continue to TrackVid CMS.' },
  impersonate: {
    title: 'Impersonate a user',
    subtitle: 'Open the app as another user to see exactly what they see.'
  }
}

/**
 * Prefills the sign-in form from .env — IN DEVELOPMENT ONLY.
 *
 * THE GUARD IS BACK, and this reverses a deliberate decision: 537fce6 removed
 * it to give packaged builds a prefilled login, and the comment that stood here
 * said to "treat the account as public". It was right about the consequence and
 * wrong about the trade.
 *
 * Vite inlines both values at build time, so with no guard they were literal
 * strings inside app.asar — which `npx asar extract` opens in one command.
 * Verified before this change: the email and the password were both readable in
 * out/renderer/assets/AppRoot-*.js. That is a working TrackVid account handed
 * to anyone holding an installer, and no amount of packaging or obfuscation
 * changes it, because the app has to be able to read it too.
 *
 * `import.meta.env.DEV` is replaced by the literal `false` at build time, so
 * the whole branch — and both strings with it — is dead code the minifier
 * removes. It is a compile-time guard, not a runtime check: there is nothing
 * left in the bundle to find.
 *
 * If a prefilled operator login is genuinely wanted in packaged builds, prefill
 * the EMAIL only and leave the password blank. A username is not a credential;
 * this was.
 */
const PREFILL: LoginInput = import.meta.env.DEV
  ? {
      email: import.meta.env.RENDERER_VITE_LOGIN_EMAIL ?? '',
      password: import.meta.env.RENDERER_VITE_LOGIN_PASSWORD ?? ''
    }
  : { email: '', password: '' }

/**
 * Sign-in screen. Rendered instead of the app shell whenever there is no
 * session, so no authenticated surface can ever be reached without one.
 *
 * Credentials are validated against the same zod schema the main process uses,
 * then handed to auth:login - they are never held in state after submission.
 */
export const LoginPage = ({ appVersion }: { appVersion?: string | undefined }) => {
  const auth = useAuth()
  const toast = useToast()

  const [mode, setMode] = useState<Mode>('password')
  const [values, setValues] = useState<LoginInput>(PREFILL)
  const [userId, setUserId] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [showPassword, setShowPassword] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [revealed, setRevealed] = useState(false)
  const taps = useRef(0)
  const tapTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (tapTimer.current) clearTimeout(tapTimer.current)
    },
    []
  )

  const setValue = (key: keyof LoginInput, value: string): void => {
    setValues((current) => ({ ...current, [key]: value }))
    setFormError(null)
    setErrors((current) => {
      if (!(key in current)) return current
      const next = { ...current }
      delete next[key]
      return next
    })
  }

  const handleSubmit = async (): Promise<void> => {
    const parsed = loginInputSchema.safeParse(values)
    if (!parsed.success) {
      const fieldErrors: Record<string, string> = {}
      for (const issue of parsed.error.issues) {
        const key = issue.path.map(String).join('.') || 'form'
        fieldErrors[key] ??= issue.message
      }
      setErrors(fieldErrors)
      return
    }

    setSubmitting(true)
    const error = await auth.signIn(parsed.data)
    setSubmitting(false)

    if (!error) {
      // Clear the password from component state the moment it is no longer needed.
      setValues(EMPTY)
      toast.success('Signed in successfully')
      return
    }

    if (error.fields) setErrors(error.fields)
    else setFormError(error.message)
  }

  const handleImpersonate = async (): Promise<void> => {
    const parsed = impersonateInputSchema.safeParse({ userId } satisfies ImpersonateInput)
    if (!parsed.success) {
      setErrors({ userId: parsed.error.issues[0]?.message ?? 'Enter a valid user ID' })
      return
    }

    setSubmitting(true)
    const error = await auth.signInAs(parsed.data)
    setSubmitting(false)

    if (!error) {
      setUserId('')
      toast.success('Signed in by impersonation')
      return
    }

    if (error.fields) setErrors(error.fields)
    else setFormError(error.message)
  }

  const switchMode = (next: Mode): void => {
    setMode(next)
    // Errors belong to the form that produced them; carrying them across reads
    // as the new form being broken before it has been touched.
    setErrors({})
    setFormError(null)
  }

  const handleLogoTap = (): void => {
    if (!IMPERSONATION_ENABLED || submitting) return

    if (tapTimer.current) clearTimeout(tapTimer.current)
    tapTimer.current = setTimeout(() => {
      taps.current = 0
    }, TAP_WINDOW_MS)

    taps.current += 1
    if (taps.current < (revealed ? TAPS_TO_HIDE : TAPS_TO_REVEAL)) return

    taps.current = 0
    if (revealed) switchMode('password')
    setRevealed(!revealed)
  }

  const impersonating = IMPERSONATION_ENABLED && revealed && mode === 'impersonate'
  const copy = COPY[impersonating ? 'impersonate' : 'password']

  /* A refused sign-in arrives rather than blinking into place. No shake: this
     is usually a mistyped password, and shaking treats a typo as an alarm. */
  const formAlert = formError && (
    <Alert severity='error' role='alert' className='login-message'>
      {formError}
    </Alert>
  )

  return (
    /*
     * TWO HALVES: the brand, and the way in.
     *
     * `min-bs-dvh`, not `h-full`: this screen renders outside the app shell, so
     * there is no ancestor height for a percentage to resolve against.
     */
    <div className='flex min-bs-dvh'>
      {/*
       * THE BRAND HALF, AND IT DISAPPEARS BELOW 1024px.
       *
       * The window's minimum is 940px, so there is a real band where a split
       * would leave two cramped columns. Below the breakpoint the form simply
       * takes the whole window — at that size somebody is trying to sign in,
       * not read a value proposition.
       */}
      <aside
        aria-hidden='true'
        className='login-brand-panel hidden w-1/2 shrink-0 flex-col justify-between p-12 lg:flex'
      >
        {/* The wordmark on the logo's own teal ground — see login.css. */}
        <img
          src={logoName}
          alt=''
          draggable={false}
          onClick={handleLogoTap}
          className='login-enter h-9 w-auto self-start select-none'
        />

        <div className='login-enter login-enter-1 max-is-md'>
          <h2 className='login-brand-ink text-4xl font-extrabold leading-tight tracking-tight'>
            Smarter Claims.
            <br />
            <span className='login-brand-ink-soft'>Stronger eCommerce.</span>
          </h2>
          <p className='login-brand-ink-soft mbs-4 text-base leading-relaxed'>
            Manage your video records, resolve claims and keep your eCommerce business running
            smoothly.
          </p>
        </div>

        <ul className='login-enter login-enter-2 flex flex-wrap gap-x-8 gap-y-4'>
          {BRAND_POINTS.map(({ icon, lines }) => (
            <li key={lines[0]} className='flex items-center gap-3'>
              <span className='login-brand-chip flex shrink-0 items-center justify-center rounded-lg h-10 w-10'>
                <i className={`${icon} login-brand-ink-soft text-2xl`} />
              </span>
              <span className='login-brand-ink text-sm font-medium leading-tight'>
                {lines[0]}
                <br />
                {lines[1]}
              </span>
            </li>
          ))}
        </ul>
      </aside>

      {/*
       * THE WAY IN — Vercel's sign-in, which is a form on the page, not a card
       * on the page. The old version drew a bordered card inside a grey canvas
       * inside a window: three frames round four controls. The column is the
       * frame now, and the edge between the halves is the only line.
       */}
      <main className='flex flex-1 flex-col items-center justify-center pli-6 plb-10'>
        <div className='login-card flex flex-col is-full max-is-sm'>
          {/* On the split layout the panel already carries the wordmark;
              one per screen is enough. */}
          <img
            src={logoName}
            alt='TrackVid'
            draggable={false}
            onClick={handleLogoTap}
            className='login-enter mbe-10 h-8 w-auto self-start select-none lg:hidden'
          />

          {/* Impersonation wears a mark as well as a title, so the mode reads
              at a glance before any of the words do. */}
          <header key={copy.title} className='login-enter login-enter-1 mbe-8'>
            {impersonating && (
              <Box
                className='mbe-4 flex items-center justify-center rounded-lg h-10 w-10'
                sx={{ bgcolor: 'var(--mui-palette-warning-lightOpacity)', color: 'warning.main' }}
              >
                <i className='tabler-user-shield text-2xl' />
              </Box>
            )}
            <Typography variant='h4' component='h1' className='font-semibold'>
              {copy.title}
            </Typography>
            <Typography color='text.secondary' className='mt-1.5'>
              {copy.subtitle}
            </Typography>
          </header>

          {impersonating ? (
            <form
              key='impersonate'
              noValidate
              className='login-enter login-enter-2 flex flex-col gap-5'
              onSubmit={(event) => {
                event.preventDefault()
                void handleImpersonate()
              }}
            >
              <Alert severity='warning' icon={<i className='tabler-alert-triangle' />}>
                Everything you do next is recorded against that user, not you.
              </Alert>

              <CustomTextField
                fullWidth
                required
                autoFocus
                label='User ID'
                name='userId'
                autoComplete='off'
                placeholder='e.g. 6a3a629dfc3a2a4d651870bd'
                value={userId}
                error={Boolean(errors['userId'])}
                helperText={errors['userId']}
                disabled={submitting}
                slotProps={{
                  htmlInput: { spellCheck: false, className: 'font-mono' }
                }}
                onChange={(event) => {
                  setUserId(event.target.value)
                  setFormError(null)
                  setErrors({})
                }}
              />

              {formAlert}

              <Button type='submit' variant='contained' size='large' fullWidth loading={submitting}>
                Continue as user
              </Button>

              <Button
                variant='text'
                color='secondary'
                disabled={submitting}
                startIcon={<i className='tabler-arrow-left' />}
                onClick={() => switchMode('password')}
                className='self-center'
              >
                Back to email sign-in
              </Button>
            </form>
          ) : (
            <form
              key='password'
              noValidate
              className='login-enter login-enter-2 flex flex-col gap-5'
              onSubmit={(event) => {
                event.preventDefault()
                void handleSubmit()
              }}
            >
              <CustomTextField
                fullWidth
                required
                label='Email'
                name='email'
                type='email'
                /*
                 * THE CURSOR STARTS WHERE THE TYPING DOES.
                 *
                 * In development the email is prefilled from .env, so focusing
                 * it would mean an operator tabs past a field that is already
                 * correct every single morning. Focus follows the first EMPTY
                 * field instead.
                 */
                autoFocus={!values.email}
                autoComplete='username'
                placeholder='you@company.com'
                value={values.email}
                error={Boolean(errors['email'])}
                helperText={errors['email']}
                disabled={submitting}
                onChange={(event) => setValue('email', event.target.value)}
              />

              <CustomTextField
                fullWidth
                required
                label='Password'
                name='password'
                autoFocus={Boolean(values.email)}
                type={showPassword ? 'text' : 'password'}
                autoComplete='current-password'
                placeholder='Enter your password'
                value={values.password}
                error={Boolean(errors['password'])}
                helperText={errors['password']}
                disabled={submitting}
                onChange={(event) => setValue('password', event.target.value)}
                slotProps={{
                  input: {
                    /* INSIDE the field, where every password reveal lives. It
                       was a grey box beside the input, which read as a second
                       button competing with Sign in. */
                    endAdornment: (
                      <InputAdornment position='end'>
                        <IconButton
                          edge='end'
                          size='small'
                          aria-label={showPassword ? 'Hide password' : 'Show password'}
                          aria-pressed={showPassword}
                          disabled={submitting}
                          onClick={() => setShowPassword((current) => !current)}
                          onMouseDown={(event) => event.preventDefault()}
                        >
                          <i className={showPassword ? 'tabler-eye-off' : 'tabler-eye'} />
                        </IconButton>
                      </InputAdornment>
                    )
                  }
                }}
              />

              {formAlert}

              <Button type='submit' variant='contained' size='large' fullWidth loading={submitting}>
                Sign in
              </Button>

              {IMPERSONATION_ENABLED && revealed && (
                <>
                  <Divider>
                    <Typography variant='caption' color='text.disabled'>
                      SUPPORT
                    </Typography>
                  </Divider>
                  <Button
                    variant='outlined'
                    color='secondary'
                    size='large'
                    fullWidth
                    disabled={submitting}
                    startIcon={<i className='tabler-user-shield' />}
                    onClick={() => switchMode('impersonate')}
                  >
                    Impersonate a user
                  </Button>
                </>
              )}
            </form>
          )}

          {appVersion && (
            <Typography
              variant='caption'
              color='text.disabled'
              className='login-enter login-enter-3 mbs-10 text-center'
            >
              Version {appVersion}
            </Typography>
          )}
        </div>
      </main>
    </div>
  )
}
