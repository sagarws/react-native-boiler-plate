// React Imports
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

// MUI Imports
import Alert from '@mui/material/Alert'
import Card from '@mui/material/Card'
import CircularProgress from '@mui/material/CircularProgress'
import Divider from '@mui/material/Divider'
import IconButton from '@mui/material/IconButton'
import Typography from '@mui/material/Typography'

// Third-party Imports
import classnames from 'classnames'

// Shared Imports
import { PLATFORM_SESSION_CHANNELS } from '@shared/constants/channels'
import type {
  CredentialRow,
  PendingSummary,
  PlatformCredentials,
  PlatformDescriptor
} from '@shared/types/platformSession'
import {
  HEALTH_LABEL,
  HEALTH_TONE,
  healthOf,
  relativeTime,
  summarise
} from '@shared/utils/sessionHealth'
import { MANUAL_REASON, SIGN_IN_SWITCH_LOCKED } from '@shared/utils/sessionTargets'
import { ok, type Result } from '@shared/types/result'

// Component Imports
import { VerifiedCell } from './VerifiedCell'
import { AddCredentialModal } from './AddCredentialModal'
import { OtpPeekModal, type OtpSource } from './OtpPeekModal'
import { Badge } from '@renderer/components/ui/Badge'
import { PlatformLogo } from '@renderer/components/ui/PlatformLogo'
import { Button } from '@renderer/components/ui/Button'
import { ConfirmDialog } from '@renderer/components/ui/ConfirmDialog'
import { Switch } from '@renderer/components/ui/Switch'
import { Tooltip } from '@renderer/components/ui/Tooltip'
import { EmptyState, LoadingState } from '@renderer/components/data/StateBlocks'

// Hook & Service Imports
import { useDevMode } from '@renderer/context/DevModeContext'
import { useToast } from '@renderer/hooks/useToast'
import { invoke } from '@renderer/services/ipcClient'
import { copyToClipboard } from '@renderer/services/clipboard.service'
import { preferencesClient } from '@renderer/services/preferences.service'
import { notifySessionsChanged, onSessionsChanged } from '@renderer/services/sessionEvents'
import { registerPageRefresh } from '@renderer/services/refreshRegistry'
import {
  syncAjioPobs,
  syncDelhiveryDomestics,
  syncTataCliqSlaves
} from '@renderer/services/masterDataReport.service'
import {
  cancelCapture,
  captureSession,
  clearAllPlatformSessions,
  clearPlatformSession,
  listPlatforms,
  recaptureSessions,
  removeCredential,
  revealPassword,
  setAutoLogin,
  setCredentialOtpMode
} from '@renderer/services/platformSession.service'

// Style Imports
import tableStyles from '@core/styles/table.module.css'

/**
 * Platform sessions.
 *
 * Every platform's claim automation runs over HTTP, but none of them can sign in
 * that way — a session has to be minted in a real browser first. This page shows
 * which credentials currently have a usable one and lets an operator refresh the
 * ones that do not.
 *
 * Sessions are captured HERE, in this app's own browser window, and nowhere
 * else. There is deliberately no "ask the server to log in" action: an
 * automation routed to this machine must own its session too, or the desktop
 * app depends on the very server it is meant to replace.
 *
 * Signing in is manual on purpose — OTP and captcha are exactly what makes an
 * automated login unreliable, and here a human is watching the window.
 */

const AUTOMATION_LABELS: Record<string, string> = {
  claim: 'Claims',
  masterImport: 'Master import',
  ticketDownload: 'Tickets'
}

type CardBusy = 'idle' | 'capturing'

/*
 * SIX COLUMNS: name · health · session · cookies · sign-in cost · actions.
 *
 * A REAL TABLE NOW. This was a CSS grid with a shared column template, because
 * a platform row and its credential rows had to line up and the old system had
 * no table to put them in. TrackVid-Monitor's table does that by construction —
 * and gives the screen the same metrics as the Jobs table beside it.
 *
 * The OTP column is empty on every platform but Snapdeal, Flipkart and AJIO. It stays
 * a column rather than being squeezed beside the buttons, so the rows stay
 * aligned.
 */

/**
 * The account cell: the address it signs in with, then its type.
 *
 * ONE LINE. It used to sit under the platform's name, which made every
 * single-account platform two lines tall and AJIO three (with its POBs button
 * under that) — no two rows the same height. Its own column puts every row on
 * one 40px line, the rhythm Manage Claims and Background Process use.
 */
const AccountCell = ({
  credential,
  platform,
  showLoginInfo,
  autoLogin
}: {
  credential: CredentialRow
  platform: string
  /** Settings → Common settings → Visible Login info. */
  showLoginInfo: boolean
  autoLogin: boolean
}) => (
  <div className='flex min-w-0 max-w-60 flex-col'>
    <div className='flex min-w-0 items-center gap-1.5'>
      <span className='truncate text-textPrimary' title={credential.username}>
        {credential.username}
      </span>
      {credential.accountType && (
        <span className='shrink-0 text-textSecondary'>· {credential.accountType}</span>
      )}
    </div>
    {showLoginInfo && (
      <PasswordLine platform={platform} username={credential.username} autoLogin={autoLogin} />
    )}
    {showLoginInfo && credential.cloudflareEmail && (
      <CopyableLine
        label='Cloudflare email'
        prefix='Cloudflare'
        username={credential.username}
        value={credential.cloudflareEmail}
      />
    )}
  </div>
)

/** One line of login info under the username, with a copy button. */
const CopyableLine = ({
  label,
  prefix,
  username,
  value
}: {
  /** Names the value in the tooltip and the toast. */
  label: string
  /** Quiet word before the value, when the value alone does not say what it is. */
  prefix?: string
  username: string
  value: string
}) => {
  const toast = useToast()

  const copy = async (): Promise<void> => {
    const response = await copyToClipboard(value)

    if (response.success) toast.success(`${label} copied for ${username}`)
    else toast.error(response.error.message)
  }

  return (
    <div className='flex min-w-0 items-center gap-1'>
      {prefix && <span className='shrink-0 text-xs text-textDisabled'>{prefix}</span>}
      <span className='truncate font-mono text-xs text-textSecondary' title={value}>
        {value}
      </span>
      <Tooltip label={`Copy ${label.toLowerCase()}`}>
        <IconButton
          size='small'
          className='app-no-drag shrink-0 p-0.5'
          aria-label={`Copy the ${label.toLowerCase()} for ${username}`}
          onClick={event => {
            // Inside a grouped platform row, a click must not fold it.
            event.stopPropagation()
            void copy()
          }}
        >
          <i className='tabler-copy text-sm' />
        </IconButton>
      </Tooltip>
    </div>
  )
}

/**
 * The account's password, under its username, with a copy button.
 *
 * Asked for per row, only once Visible Login info is on. The main process is
 * the gate — it refuses with the setting off — so whatever it says is shown as
 * it said it. `autoLogin` is here only to ask again when the Sign-in switch
 * moves.
 */
const PasswordLine = ({
  platform,
  username,
  autoLogin
}: {
  platform: string
  username: string
  autoLogin: boolean
}) => {
  const [password, setPassword] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true

    // Each answer replaces the last, rather than clearing first: a re-ask
    // keeps the old line on screen instead of flashing "Reading…".
    void revealPassword({ platform, username }).then(response => {
      if (!alive) return
      setPassword(response.success ? response.data.password : null)
      setError(response.success ? null : response.error.message)
    })

    return () => {
      alive = false
    }
  }, [platform, username, autoLogin])

  if (error) {
    return (
      <span className='truncate text-xs text-textDisabled' title={error}>
        {error}
      </span>
    )
  }

  if (password === null) {
    return <span className='text-xs text-textDisabled'>Reading password…</span>
  }

  return <CopyableLine label='Password' username={username} value={password} />
}

/** What the platform's automations are, as quiet text rather than a row of pills. */
const UsedFor = ({ platform }: { platform: PlatformDescriptor }) => {
  const text = platform.automations
    .map(automation => AUTOMATION_LABELS[automation] ?? automation)
    .join(' · ')

  // Capped, with the whole list on hover: AJIO's "Claims · Master import ·
  // Tickets" was the longest thing in the row and pushed Actions off the card.
  return (
    <span className='block max-w-40 truncate text-textSecondary' title={text}>
      {text}
    </span>
  )
}

/**
 * The per-credential list a platform cannot file without.
 *
 * TWO PLATFORMS, ONE BUTTON. AJIO scopes every return to a place of business;
 * Tata CliQ scopes every return to the slave that owns it, and its pick is
 * server-side session state. Different words, identical shape: a list swept
 * from the portal, stored on the credential, and a precondition that is
 * invisible until something fails for want of it.
 *
 * A registry rather than a second copy of the button — the repo's own rule, and
 * the reason a third platform with the same shape is one entry here.
 */
/** One sync's answer reduced to what the toast reports, whatever the list holds. */
const withCount = <T extends { added: number; removed: number }>(
  response: Result<T>,
  count: (data: T) => number
): Result<{ count: number; added: number; removed: number }> =>
  response.success
    ? ok({ count: count(response.data), added: response.data.added, removed: response.data.removed })
    : response

const SCOPE_LISTS: Record<
  string,
  {
    /** On the button, plural. */
    label: string
    count: (credential: CredentialRow) => number
    syncedAt: (credential: CredentialRow) => string | null
    /** What is stored, for the synced tooltip. */
    describe: (count: number) => string
    /** Why an empty list matters, for the never-synced tooltip. */
    blocked: string
    /** Singular, for the result toast. */
    noun: string
    /** Sweeps and stores the list; resolves to how many it now holds. */
    sync: (username: string) => Promise<Result<{ count: number; added: number; removed: number }>>
  }
> = {
  ajio: {
    label: 'POBs',
    noun: 'POB',
    sync: async (username) => withCount(await syncAjioPobs(username), data => data.pobIds.length),
    count: (credential) => credential.pobCount,
    syncedAt: (credential) => credential.pobSyncedAt,
    describe: (count) => `${count} place(s) of business`,
    // The claim search, account mapping, the SKU picker and the master-data
    // report all refuse without one.
    blocked:
      'No places of business stored — AJIO claims, account mapping and the SKU lookup all need them. Press to sync.'
  },
  tatacliq: {
    label: 'Slaves',
    noun: 'slave',
    sync: async (username) => withCount(await syncTataCliqSlaves(username), data => data.slaves.length),
    count: (credential) => credential.slaveCount,
    syncedAt: (credential) => credential.slavesSyncedAt,
    describe: (count) => `${count} slave(s)`,
    blocked:
      'No slaves stored — a Tata CliQ return is only visible to the slave that owns it, so a claim has nothing to search under. Press to sync.'
  },
  delhivery: {
    label: 'Domestic',
    noun: 'Domestic account',
    sync: async (username) =>
      withCount(await syncDelhiveryDomestics(username), data => data.domestics.length),
    count: (credential) => credential.domesticCount,
    syncedAt: (credential) => credential.domesticsSyncedAt,
    describe: (count) => `${count} Domestic account(s)`,
    blocked:
      'No Domestic accounts stored — the claim form falls back to EXPRESS / SURFACE until they are. Press to sync.'
  }
}

/**
 * That list, and a way to fetch it.
 *
 * One button beside the account name rather than a column of its own: only two
 * platforms have such a list, so a column would be empty on seven rows out of
 * nine and would take width from the five that always have something to say.
 *
 * The count is ON the button, as it is in Monitor — the number IS the state,
 * and "POBs (0)" would read as a working list of nothing, so a never-synced
 * account says so instead.
 */
const ScopeButton = ({
  platform,
  credential,
  busy,
  onSync
}: {
  platform: PlatformDescriptor
  credential: CredentialRow
  busy: boolean
  onSync: () => void
}) => {
  const scope = SCOPE_LISTS[platform.key]

  if (!scope) return null

  const count = scope.count(credential)
  const synced = count > 0

  return (
    <Button
      size="sm"
      variant="secondary"
      onClick={onSync}
      disabled={busy}
      className={classnames('whitespace-nowrap', { 'text-warning-fg': !synced })}
      title={
        synced
          ? `${scope.describe(count)}, synced ${relativeTime(scope.syncedAt(credential))}. Press to re-sync.`
          : scope.blocked
      }
    >
      {busy ? 'Syncing…' : synced ? `${scope.label} (${count})` : `${scope.label} — not synced`}
    </Button>
  )
}

/**
 * Does signing in to this account cost a one-time code?
 *
 * SNAPDEAL AND FLIPKART ONLY. Both raise a code on some seller accounts and not
 * others — it is a setting on the account, not a property of the marketplace —
 * and nothing here can work out which without spending a login finding out. An
 * account that is never challenged waits out the whole OTP budget for nothing;
 * one that is, with nowhere to read the code from, fails after the same wait
 * talking about email. So it is asked of the person who owns the account.
 *
 * Tata CliQ is absent deliberately: every one of its logins raises a code, and
 * a switch there could only break a sign-in that works.
 */
// Must match OTP_OPTIONAL_PLATFORMS in the main process and in TrackVid-BE's
// credentialOtpMode controller — a platform missing there is refused on write.
const OTP_OPTIONAL = new Set(['snapdeal', 'flipkart', 'ajio'])

/**
 * Platforms whose every login asks for a code — no switch, just "Get OTP" —
 * and the codes an account there can be sent. Tata CliQ sends two: the seller
 * zone's own, and Cloudflare Access's when the zone is behind it. Keys are the
 * main process's mailbox readers (otpSource READERS).
 */
const ALWAYS_OTP_SOURCES: Record<string, OtpSource[]> = {
  tatacliq: [
    {
      key: 'tatacliq-cloudflare',
      label: 'Cloudflare Access',
      hint: 'The "Enter your code" page on tulunistore.cloudflareaccess.com'
    },
    { key: 'tatacliq', label: 'Seller Zone login', hint: "The seller portal's own OTP box after the password" }
  ]
}

const OtpModeCell = ({
  platform,
  credential
}: {
  platform: string
  credential: CredentialRow
}) => {
  const toast = useToast()
  // Optimistic, and reverted if the write fails: a switch that waits for a
  // round trip before moving reads as a switch that did not work.
  const [value, setValue] = useState<boolean>(credential.isOtpBased === true)
  const [busy, setBusy] = useState(false)
  // "Get OTP" — offered only while the switch is on: an account that signs in
  // without a code has nothing in the mailbox worth reading.
  const [peeking, setPeeking] = useState(false)

  const alwaysSources = ALWAYS_OTP_SOURCES[platform.toLowerCase()]

  if (alwaysSources && credential.credentialId) {
    return (
      <div className='flex items-center gap-2 whitespace-nowrap'>
        <Button
          size='sm'
          variant='secondary'
          icon={<i className='tabler-mail-code' />}
          title={`Read the newest code in the mailbox for ${credential.username}`}
          onClick={() => setPeeking(true)}
        >
          Get OTP
        </Button>
        {peeking && (
          <OtpPeekModal
            onClose={() => setPeeking(false)}
            platform={platform.toLowerCase()}
            username={credential.username}
            sources={alwaysSources}
          />
        )}
      </div>
    )
  }

  if (!OTP_OPTIONAL.has(platform.toLowerCase()) || !credential.credentialId) return <span />

  const change = async (next: boolean): Promise<void> => {
    setValue(next)
    setBusy(true)

    const response = await setCredentialOtpMode({
      platform: platform.toLowerCase(),
      credentialId: credential.credentialId,
      isOtpBased: next
    })

    setBusy(false)

    if (!response.success) {
      setValue(!next)
      toast.error(response.error.message)

      return
    }

    toast.success(
      next
        ? `${credential.username} will be signed in with a one-time code`
        : `${credential.username} will be signed in without waiting for a code`
    )
  }

  return (
    <div className='flex items-center gap-2 whitespace-nowrap'>
      <Switch
        compact
        checked={value}
        disabled={busy}
        onChange={next => void change(next)}
        label={
          <Typography variant='body2' color='text.secondary'>
            OTP
          </Typography>
        }
      />
      {value && (
        <>
          <Button
            size='sm'
            variant='secondary'
            icon={<i className='tabler-mail-code' />}
            title={`Read the newest code in the mailbox for ${credential.username}`}
            onClick={() => setPeeking(true)}
          >
            Get OTP
          </Button>
          {peeking && (
            <OtpPeekModal
              onClose={() => setPeeking(false)}
              platform={platform.toLowerCase()}
              username={credential.username}
            />
          )}
        </>
      )}
    </div>
  )
}

/**
 * The Sign-in column: Auto or Manual, and — where the company setting is what
 * decides it — the switch that changes it.
 *
 * ONE FLAG PER PLATFORM, shown on every row of it. Flipping it on one Flipkart
 * account flips every Flipkart account, and the tooltip says so; the setting
 * is the company's `isAutoLoginOnActiveSession.<platform>`, the same one
 * Monitor writes.
 *
 * No switch when something other than that flag decides — this installation
 * has scripted sign-in off, or the build has no script for the portal — since
 * flipping the company setting would change nothing the operator can see.
 */
const SignInCell = ({
  platform,
  autoLogin,
  blockedBy
}: {
  platform: string
  autoLogin: boolean
  blockedBy: PlatformCredentials['autoLoginBlockedBy']
}) => {
  const toast = useToast()
  // Optimistic, reverted on failure — the same reasoning as the OTP switch.
  const [value, setValue] = useState(autoLogin)
  const [busy, setBusy] = useState(false)

  const switchable = blockedBy === undefined || blockedBy === 'company'
  const locked = SIGN_IN_SWITCH_LOCKED.has(platform)

  if (!switchable) {
    return (
      <Tooltip className='align-middle' label={MANUAL_REASON[blockedBy ?? 'company']}>
        <span className='inline-flex items-center gap-1 text-warning-fg'>
          <i className='tabler-hand-finger text-base' />
          Manual
        </span>
      </Tooltip>
    )
  }

  const change = async (next: boolean): Promise<void> => {
    setValue(next)
    setBusy(true)

    const response = await setAutoLogin({ platform, enabled: next })

    setBusy(false)

    if (!response.success) {
      setValue(!next)
      toast.error(response.error.message)

      return
    }

    toast.success(
      next
        ? 'Automatic sign-in is on — the Login update will sign these accounts in by itself'
        : 'Automatic sign-in is off — sign these accounts in by hand with Re-capture'
    )
  }

  return (
    <Tooltip
      className='align-middle'
      label={
        (value ? 'Re-capture signs in by itself.' : 'Re-capture opens a window for you to sign in.') +
        (locked
          ? ' This switch can only be changed in Trackvid-Monitor.'
          : ' Applies to every account of this platform.')
      }
    >
      <span className='inline-flex whitespace-nowrap'>
        <Switch
          compact
          checked={value}
          disabled={busy || locked}
          onChange={next => void change(next)}
          label={
            <Typography variant='body2' color={value ? 'text.secondary' : 'warning.main'}>
              {value ? 'Auto' : 'Manual'}
            </Typography>
          }
        />
      </span>
    </Tooltip>
  )
}

/**
 * What to do about a platform that will not sign itself in.
 *
 * Each names one action. `company` is first among equals: it is the switch an
 * operator actually reaches for, and it is also where the backend stops
 * handing out the stored password — so with it off, this app cannot script the
 * sign-in however much it would like to.
 */
/*
 * The sentences themselves moved to @shared/utils/sessionTargets, beside the
 * rule that decides which accounts the Session update will attempt. The
 * scheduled run writes them into its job rows and its log too, and a second
 * copy here had already drifted into naming the wrong fix for one of the three.
 */


const CredentialCells = ({
  credential,
  platform,
  autoLogin,
  blockedBy,
  pending,
  busy,
  onCapture,
  onCancel,
  onUpdate,
  onClear,
  onRemoveAccount,
  showOtp,
  scope,
  locked
}: {
  credential: CredentialRow
  /**
   * Something else on the page is running — a Refresh, a Clear all, another
   * row's capture. The actions wait for it rather than racing it: a session
   * updated mid-refresh is overwritten on screen by the read already in flight.
   */
  locked: boolean
  /** Whether the table has an OTP column at all — see `showOtp` on the page. */
  showOtp: boolean
  /** The POBs / Slaves button for this credential, when its platform has one. */
  scope: React.ReactNode
  /** Lower-cased platform key — the OTP switch is only for some of them. */
  platform: string
  autoLogin: boolean
  blockedBy: PlatformCredentials['autoLoginBlockedBy']
  pending: PendingSummary | undefined
  busy: CardBusy
  onCapture: () => void
  onCancel: () => void
  onUpdate: () => void
  onClear: () => void
  /** Deletes the account itself — username, password and all. */
  onRemoveAccount: () => void
}) => {
  const health = healthOf(credential.session)
  const session = credential.session
  // The Login and Cookies columns are diagnostics: developer mode only.
  const { devMode } = useDevMode()

  return (
    <>
      <td>
        <Badge tone={HEALTH_TONE[health]}>{HEALTH_LABEL[health]}</Badge>
      </td>

      {/* `whitespace-nowrap`: the badge and its Verify button must not be
          squeezed into "Verifi…" by a table that is already scrolling
          horizontally — a truncated verdict is worse than no column. */}
      <td className='whitespace-nowrap'>
        <VerifiedCell platform={platform} credential={credential} />
      </td>

      {/* SIGN-IN, its own column. It sat beside the status as a second green
          pill on every row, which read as a second status. Says what
          Re-capture will actually do — and, when it will not sign itself in,
          why: the tooltip names the one thing that would change it, which is
          also what the nightly Session update reports when it has to skip an
          account. */}
      <td>
        {/* Keyed on the server value so a reload after the switch (or a change
            made in Monitor) resets the optimistic state. */}
        <SignInCell key={String(autoLogin)} platform={platform} autoLogin={autoLogin} blockedBy={blockedBy} />
      </td>

      {/* Diagnostics: developer mode only. One line each — the capture time
          and source moved into the tooltip, where the cookie names already
          were. */}
      {devMode && (
        <td>
          {session ? (
            <Tooltip
              label={`Captured ${relativeTime(session.savedAt)}${session.source ? ` · ${session.source}` : ''}`}
            >
              <span
                className={classnames(
                  'font-medium',
                  health === 'expired'
                    ? 'text-error'
                    : health === 'expiring'
                      ? 'text-warning-fg'
                      : 'text-textPrimary'
                )}
              >
                {relativeTime(session.expiresAt)}
              </span>
            </Tooltip>
          ) : (
            <span className='text-textDisabled'>Never captured</span>
          )}
        </td>
      )}

      {/* The NAMES on hover, not just the count. When a marketplace refuses a
          session that was just captured, the count says nothing — which
          cookies is the whole question. Names only; a value IS the session. */}
      {devMode && (
        <td className='tabular-nums'>
          {session ? (
            <Tooltip label={session.cookieNames.length ? [...session.cookieNames].sort().join(', ') : null}>
              <span>{session.cookieNames.length}</span>
            </Tooltip>
          ) : (
            <span className='text-textDisabled'>—</span>
          )}
        </td>
      )}

      {showOtp && (
        <td className='min-w-52'>
          <OtpModeCell platform={platform} credential={credential} />
        </td>
      )}

      <td align='right'>
        <div className='flex items-center justify-end gap-2'>
          {busy === 'capturing' ? (
            <>
              <CircularProgress size={14} />
              <span className='text-textSecondary'>
                {autoLogin
                  ? 'Signing in — finish any code, then close the window'
                  : 'Sign in — the window closes by itself once you are in'}
              </span>
              <Button size='sm' variant='secondary' onClick={onCancel}>
                Cancel
              </Button>
            </>
          ) : (
            <>
              {/* The per-credential list a platform cannot file without —
                  POBs on AJIO, slaves on Tata CliQ. With the actions now, not
                  stacked under the account name. */}
              {scope}
              {/* Only when there is something to send. This session was captured
                  here and works; the server just never got it. */}
              {pending && (
                <Button
                  size='sm'
                  variant='primary'
                  disabled={locked}
                  onClick={onUpdate}
                  title={`Captured ${relativeTime(pending.capturedAt)} — not yet saved to the server`}
                >
                  Update
                </Button>
              )}
              {/* Filled only when the login needs it, so a glance down the
                  column finds the rows that need work. */}
              <Button
                size='sm'
                variant={health === 'active' ? 'secondary' : 'primary'}
                disabled={locked}
                onClick={onCapture}
              >
                {session ? 'Re-capture' : 'Capture'}
              </Button>
              {/* ONLY WHEN THERE IS A SESSION TO REMOVE — on a never-captured
                  row it would read like it might delete the account. An icon,
                  so the one action that matters is the only word in the
                  column; the tooltip and the confirmation both name it. */}
              {session ? (
                <Tooltip label='Remove the saved login. The account and its password stay.'>
                  <IconButton
                    size='small'
                    aria-label={`Remove the saved login for ${credential.username}`}
                    disabled={locked}
                    onClick={onClear}
                  >
                    <i className='tabler-trash text-lg' />
                  </IconButton>
                </Tooltip>
              ) : (
                // Holds the icon's place so the Capture buttons line up.
                <span aria-hidden='true' className='inline-block w-8' />
              )}
              {/* THE ACCOUNT ITSELF, not its session — a different icon and a
                  different word, because the trash beside it keeps the
                  account and this one does not. */}
              <Tooltip label='Delete this account — its username, password and saved login.'>
                <IconButton
                  size='small'
                  aria-label={`Delete the account ${credential.username}`}
                  disabled={locked}
                  onClick={onRemoveAccount}
                >
                  <i className='tabler-user-x text-lg' />
                </IconButton>
              </Tooltip>
            </>
          )}
        </div>
      </td>
    </>
  )
}


/**
 * One platform row.
 *
 * EXPANDS ONLY WHEN THERE IS SOMETHING TO EXPAND. A platform with a single
 * credential shows it inline — a disclosure arrow that reveals one row is
 * friction pretending to be organisation, and most platforms here have
 * exactly one account.
 *
 * EVERY ROW HAS THE SAME FIRST COLUMN. The arrow sits in a column of its own,
 * empty on single-account rows, so every platform's mark and name start at the
 * same x — the arrow used to push Flipkart's out of line with the rest.
 */
const PlatformRow = ({
  platform,
  credentials,
  autoLogin,
  blockedBy,
  pendingFor,
  busyFor,
  onCapture,
  onCancel,
  onUpdate,
  onClear,
  onRemoveAccount,
  syncingScope,
  onSyncScope,
  showOtp,
  showLoginInfo,
  locked
}: {
  platform: PlatformDescriptor
  locked: boolean
  /** Settings → Common settings → Visible Login info. */
  showLoginInfo: boolean
  credentials: CredentialRow[]
  autoLogin: boolean
  /** Why not, when not — see MANUAL_REASON. */
  blockedBy: PlatformCredentials['autoLoginBlockedBy']
  pendingFor: (credential: CredentialRow) => PendingSummary | undefined
  onUpdate: (platform: PlatformDescriptor, credential: CredentialRow) => void
  onClear: (platform: PlatformDescriptor, credential: CredentialRow) => void
  onRemoveAccount: (platform: PlatformDescriptor, credential: CredentialRow) => void
  busyFor: (credential: CredentialRow) => CardBusy
  onCapture: (platform: PlatformDescriptor, credential: CredentialRow) => void
  onCancel: (platform: PlatformDescriptor) => void
  syncingScope: (credential: CredentialRow) => boolean
  onSyncScope: (platform: PlatformDescriptor, credential: CredentialRow) => void
  showOtp: boolean
}) => {
  const counts = summarise(credentials.map(c => healthOf(c.session)))
  const many = credentials.length > 1
  const { devMode } = useDevMode()
  // Open by default when something in there needs attention: the reason to
  // collapse is to hide what is fine, never to hide what is broken.
  const [open, setOpen] = useState(counts.needsAttention > 0)
  const single = credentials[0]

  /**
   * Cells after Status on a row that is not a credential: Verified, Sign-in,
   * dev, OTP, Actions.
   *
   * Counted rather than rendered, so adding a column means changing this number
   * too — miss it and every grouped platform row is one cell short, which reads
   * as the table having lost its alignment rather than as a missing blank.
   */
  const trailingBlanks = 1 + 1 + (devMode ? 2 : 0) + (showOtp ? 1 : 0) + 1

  const name = (
    <div className='flex min-w-0 items-center gap-2'>
      {/* The marketplace's own mark, so a row is recognised before it is read. */}
      <PlatformLogo name={platform.label} size={18} />
      <span className='truncate font-medium text-textPrimary'>{platform.label}</span>
    </div>
  )

  const cellsFor = (credential: CredentialRow) => (
    <CredentialCells
      credential={credential}
      platform={platform.key}
      autoLogin={autoLogin}
      blockedBy={blockedBy}
      pending={pendingFor(credential)}
      busy={busyFor(credential)}
      onCapture={() => onCapture(platform, credential)}
      onCancel={() => onCancel(platform)}
      onUpdate={() => onUpdate(platform, credential)}
      onClear={() => onClear(platform, credential)}
      onRemoveAccount={() => onRemoveAccount(platform, credential)}
      showOtp={showOtp}
      locked={locked}
      scope={
        <ScopeButton
          platform={platform}
          credential={credential}
          busy={syncingScope(credential)}
          onSync={() => onSyncScope(platform, credential)}
        />
      }
    />
  )

  if (many) {
    return (
      <>
        <tr
          tabIndex={0}
          aria-expanded={open}
          className='cursor-pointer hover:bg-actionHover'
          onClick={() => setOpen(current => !current)}
          onKeyDown={event => {
            if (event.key !== 'Enter' && event.key !== ' ') return
            event.preventDefault()
            setOpen(current => !current)
          }}
        >
          <td>
            <i
              aria-hidden='true'
              className={classnames(
                'tabler-chevron-right block text-lg text-textSecondary transition-transform',
                open && 'rotate-90'
              )}
            />
          </td>
          <td>{name}</td>
          <td className='text-textSecondary'>{credentials.length} accounts</td>
          <td>
            <UsedFor platform={platform} />
          </td>
          {/* The platform's standing in one badge: how many need work, or that
              none do. The same count the banner above uses. */}
          <td>
            {counts.needsAttention > 0 ? (
              <Badge tone='warning'>{counts.needsAttention} need attention</Badge>
            ) : (
              <Badge tone='success'>{counts.total} saved</Badge>
            )}
          </td>
          {Array.from({ length: trailingBlanks }, (_, index) => (
            <td key={index} />
          ))}
        </tr>

        {open &&
          credentials.map(credential => (
            <tr
              key={credential.credentialId || credential.username}
              /* Tinted so a child row is never mistaken for a platform row at a
                 glance. The attribute is what lets the pinned Action cell paint
                 the same tint over its own opaque base — see
                 styles/table-chrome.css. */
              data-subrow=''
              style={{ backgroundColor: 'var(--mui-palette-action-hover)' }}
            >
              <td />
              <td />
              <td>
                <AccountCell
                  credential={credential}
                  platform={platform.key}
                  showLoginInfo={showLoginInfo}
                  autoLogin={autoLogin}
                />
              </td>
              <td />
              {/* `cellsFor` opens at Status and carries Verified with it. */}
              {cellsFor(credential)}
            </tr>
          ))}
      </>
    )
  }

  return (
    // One credential: the platform row IS the credential row.
    <tr className='hover:bg-actionHover'>
      <td />
      <td>{name}</td>
      <td>
        {single ? (
          <AccountCell
            credential={single}
            platform={platform.key}
            showLoginInfo={showLoginInfo}
            autoLogin={autoLogin}
          />
        ) : (
          <span className='text-textDisabled'>No credentials</span>
        )}
      </td>
      <td>
        <UsedFor platform={platform} />
      </td>
      {single ? (
        cellsFor(single)
      ) : (
        <>
          <td />
          {Array.from({ length: trailingBlanks }, (_, index) => (
            <td key={index} />
          ))}
        </>
      )}
    </tr>
  )
}

export const SessionsPage = () => {
  const toast = useToast()
  const { devMode } = useDevMode()
  /**
   * The AJIO account whose POBs are being swept, or null.
   *
   * One at a time: the sweep takes the automation lock, so a second press would
   * queue behind the first with no sign of it on screen.
   */
  const [scopeBusy, setScopeBusy] = useState<string | null>(null)
  const [platforms, setPlatforms] = useState<PlatformDescriptor[] | null>(null)
  const [health, setHealth] = useState<PlatformCredentials[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  /** Refresh's auto sign-in sweep — longer than the read, so its own flag. */
  const [autoCapturing, setAutoCapturing] = useState(false)
  // The sweep outlives a navigation; this stops it starting the next account.
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true

    return () => {
      mountedRef.current = false
    }
  }, [])
  const [clearingAll, setClearingAll] = useState(false)
  /**
   * The removal waiting on a confirmation, if any.
   *
   * Holds the target rather than a bare boolean so the dialog can NAME the
   * account. A confirmation that says "remove this session?" over a table of
   * near-identical rows does not catch the mis-click it exists to catch.
   */
  /** The account whose deletion is being confirmed — the account, not its session. */
  const [pendingRemove, setPendingRemove] = useState<{
    platform: PlatformDescriptor
    credential: CredentialRow
  } | null>(null)
  const [removingAccount, setRemovingAccount] = useState(false)
  /** The Add login form. */
  const [adding, setAdding] = useState(false)
  const [pendingClear, setPendingClear] = useState<{
    platform: PlatformDescriptor
    credential: CredentialRow
  } | null>(null)
  const [confirmingAll, setConfirmingAll] = useState(false)
  // Sessions captured on this machine the backend has not accepted yet.
  const [pending, setPending] = useState<PendingSummary[]>([])
  // Keyed by credentialId (falling back to username) so two rows on the same
  // platform can be worked on independently.
  const [rowBusy, setRowBusy] = useState<Record<string, CardBusy>>({})
  /** Settings → Common settings → Visible Login info. Off until read. */
  const [showLoginInfo, setShowLoginInfo] = useState(false)

  useEffect(() => {
    let alive = true

    void preferencesClient.get().then(response => {
      if (alive && response.success) setShowLoginInfo(response.data.showLoginInfo)
    })

    return () => {
      alive = false
    }
  }, [])

  const rowKey = (platform: PlatformDescriptor, credential: CredentialRow): string =>
    `${platform.key}:${credential.credentialId || credential.username}`

  /**
   * @param announce tell the rest of the app the sessions changed. FALSE when
   *        this reload is itself the answer to that announcement: this page
   *        listens to it too, so announcing again re-ran this reload, which
   *        announced again — the Refresh spinner never stopped.
   */
  const loadHealth = useCallback(async (announce = true): Promise<PlatformCredentials[] | null> => {
    setRefreshing(true)
    const response = await invoke<PlatformCredentials[]>(PLATFORM_SESSION_CHANNELS.health)
    setRefreshing(false)
    if (!response.success) {
      setLoadError(response.error.message)
      return null
    }
    setLoadError(null)
    setHealth(response.data)

    // The layout's stale-session alert reads the same data and is not this
    // component's parent, so it cannot be told by props.
    if (announce) notifySessionsChanged()

    const queued = await invoke<PendingSummary[]>(PLATFORM_SESSION_CHANNELS.pending)

    if (queued.success) setPending(queued.data)

    return response.data
  }, [])

  // Both reads run in parallel and every setState happens after the await, so
  // unmounting mid-flight cannot write to a dead component.
  // Sync's page tier: while this screen is open, Sync reloads its list too.
  // Withdrawn on unmount, so Sync never refetches a page nobody is looking at.
  // Sync only re-reads — the auto sign-in sweep below is Refresh's alone.
  useEffect(
    () =>
      registerPageRefresh(async () => {
        await loadHealth()
      }),
    [loadHealth]
  )

  // The banner's "Update now" captures a session at a time and needs each row
  // on THIS page to update as its capture completes — otherwise an operator
  // sees a completed platform still marked Expired here until they hit the
  // global refresh. Same reload path, driven by the banner instead of the ⟳.
  useEffect(() => onSessionsChanged(() => void loadHealth(false)), [loadHealth])

  useEffect(() => {
    let cancelled = false

    void (async () => {
      const [platformList, healthList] = await Promise.all([
        listPlatforms(),
        invoke<PlatformCredentials[]>(PLATFORM_SESSION_CHANNELS.health)
      ])
      if (cancelled) return

      if (platformList.success) setPlatforms(platformList.data)
      else setLoadError(platformList.error.message)

      if (healthList.success) setHealth(healthList.data)
      else setLoadError(healthList.error.message)
    })()

    return () => {
      cancelled = true
    }
  }, [])

  const byPlatform = useMemo(
    () => new Map((health ?? []).map((entry) => [entry.platform, entry])),
    [health]
  )

  const overall = useMemo(
    () => summarise((health ?? []).flatMap((p) => p.credentials.map((c) => healthOf(c.session)))),
    [health]
  )

  /**
   * How many credentials hold a stored session at all.
   *
   * Counts the JAR, not its health: an expired or rejected session is still
   * something to remove — it is the likeliest thing anybody would want removed
   * — so gating "Clear all" on `overall.active` would hide the button in the
   * one state it is most wanted.
   */
  const savedSessions = useMemo(
    () => (health ?? []).flatMap(p => p.credentials).filter(c => c.session).length,
    [health]
  )

  /** Only platforms this company actually has a credential for get a section. */
  const visible = useMemo(
    () => (platforms ?? []).filter((p) => (byPlatform.get(p.key)?.credentials.length ?? 0) > 0),
    [platforms, byPlatform]
  )

  /**
   * Platforms the server said nothing about. Never empty against a current API;
   * on an older build it is how the page admits it cannot see a platform rather
   * than quietly leaving it out.
   */
  const unreported = useMemo(
    () =>
      (platforms ?? []).filter((p) => {
        const entry = byPlatform.get(p.key)
        return entry !== undefined && !entry.reported
      }),
    [platforms, byPlatform]
  )

  const setBusy = useCallback((key: string, state: CardBusy) => {
    setRowBusy((current) => ({ ...current, [key]: state }))
  }, [])

  const pendingFor = useCallback(
    (platform: PlatformDescriptor, credential: CredentialRow): PendingSummary | undefined =>
      pending.find(
        (entry) =>
          entry.platform === platform.key &&
          entry.username.toLowerCase() === credential.username.toLowerCase()
      ),
    [pending]
  )

  const handleUpdate = useCallback(
    async (platform: PlatformDescriptor, credential: CredentialRow) => {
      const key = rowKey(platform, credential)

      setBusy(key, 'capturing')

      const response = await invoke<{ platform: string }>(PLATFORM_SESSION_CHANNELS.flushPending, {
        platform: platform.key,
        username: credential.username
      })

      setBusy(key, 'idle')

      if (response.success) toast.success(`${platform.label} login saved to the server`)
      else toast.error(response.error.message)

      // Either outcome changes the queue — success drains it, a rejection
      // discards it — so the card must stop offering Update.
      await loadHealth()
    },
    [loadHealth, setBusy, toast]
  )

  /**
   * Removes one credential's saved session.
   *
   * CONFIRMED, because it cannot be undone and the cost is not obvious from the
   * button: the next automation on this account signs in again, and on a
   * platform whose sign-in needs a one-time code that means somebody has to be
   * there to read it. The dialog names the account so a mis-click on a
   * neighbouring row is caught before it costs anything.
   */
  const handleClear = useCallback(
    async (platform: PlatformDescriptor, credential: CredentialRow) => {
      const key = rowKey(platform, credential)

      setBusy(key, 'capturing')

      const response = await clearPlatformSession(platform.key, credential.username)

      setBusy(key, 'idle')

      if (response.success) toast.success(`${platform.label} login removed for ${credential.username}`)
      else toast.error(response.error.message)

      await loadHealth()
      // Everything that reads session health — the banner, the Settings card —
      // is now describing a session that is gone.
      notifySessionsChanged()
    },
    [loadHealth, setBusy, toast]
  )

  /**
   * Deletes one account — username, password and its saved login — from the
   * company, here and on the server. Confirmed first, naming the account.
   */
  const handleRemoveAccount = useCallback(
    async (platform: PlatformDescriptor, credential: CredentialRow) => {
      setRemovingAccount(true)

      const response = await removeCredential({ platform: platform.key, username: credential.username })

      setRemovingAccount(false)
      setPendingRemove(null)

      if (response.success) toast.success(`${platform.label} account ${credential.username} deleted`)
      else toast.error(response.error.message)

      await loadHealth()
      notifySessionsChanged()
    },
    [loadHealth, toast]
  )

  /**
   * Removes every saved session this company holds.
   *
   * TYPED CONFIRMATION, not an OK button. This signs the whole company out of
   * every marketplace at once, and the accounts that cost a one-time code can
   * only be brought back with a person present — so on a bad day this is not an
   * inconvenience, it is a working day lost. The difference between it and the
   * per-row Remove beside it is one word on a dialog, which is not enough.
   */
  const handleClearAll = useCallback(async () => {
    setConfirmingAll(false)
    setClearingAll(true)

    const response = await clearAllPlatformSessions()

    setClearingAll(false)

    if (response.success) toast.success('Every saved login was removed')
    else toast.error(response.error.message)

    await loadHealth()
    notifySessionsChanged()
  }, [loadHealth, toast])

  /**
   * Is anything on this page already in flight?
   *
   * One thing at a time. Re-capture used to stay live while Refresh spun, so a
   * session was updated under a health read that then painted the old state
   * back over it — and the reverse, Refresh during a capture, did the same.
   */
  const anyRowBusy = Object.values(rowBusy).some(state => state !== 'idle')
  const locked = refreshing || autoCapturing || clearingAll || anyRowBusy

  const busyFor = useCallback(
    (credential: CredentialRow): CardBusy => {
      const suffix = credential.credentialId || credential.username
      const match = Object.entries(rowBusy).find(([key]) => key.endsWith(`:${suffix}`))
      return match?.[1] ?? 'idle'
    },
    [rowBusy]
  )

  const handleCapture = useCallback(
    async (platform: PlatformDescriptor, credential: CredentialRow) => {
      if (locked) return

      const key = rowKey(platform, credential)
      setBusy(key, 'capturing')
      const response = await captureSession({
        platform: platform.key,
        username: credential.username,
        // The server renew keys on the id: the same marketplace address can sit
        // under more than one company.
        credentialId: credential.credentialId
      })
      setBusy(key, 'idle')

      if (!response.success) {
        toast.error(response.error.message)
        return
      }
      toast.success(
        `${platform.label} login saved for ${response.data.username} (${response.data.cookieCount} cookies)`
      )
      // The card renders from stored health, so it stays stale until re-read.
      await loadHealth()
    },
    [loadHealth, locked, setBusy, toast]
  )

  /**
   * Refresh: re-read, then sign in again every account whose platform signs in
   * by itself.
   *
   * WHATEVER THE AUTOMATIONS SWITCH SAYS. That switch halts background work;
   * this is an operator's press, and the capture channel never consults it —
   * only the "something is already running" guard, which still holds.
   *
   * UNATTENDED, so no window ever opens: the targets are platforms whose
   * sign-in is scripted (`autoLogin` is the effective value, company switch and
   * machine flag together), and one that still cannot sign in fails at once
   * under its own name.
   *
   * VERIFIED ONLY, as the banner's Update now: signing in with a password the
   * marketplace refused only repeats the refusal, and Delhivery locks the
   * account after five.
   */
  const handleRefresh = useCallback(async () => {
    const fresh = await loadHealth()

    if (!fresh || !mountedRef.current) return

    const labels = new Map((platforms ?? []).map(p => [p.key, p.label]))
    const queue = fresh
      .filter(entry => entry.autoLogin)
      .flatMap(entry =>
        entry.credentials
          .filter(credential => credential.visible !== false && credential.isVerified && credential.refused !== true)
          .map(credential => ({
            platform: entry.platform,
            label: labels.get(entry.platform) ?? entry.platform,
            username: credential.username,
            credentialId: credential.credentialId,
            key: `${entry.platform}:${credential.credentialId || credential.username}`
          }))
      )

    if (queue.length === 0) return

    setAutoCapturing(true)
    toast.info(`Signing in ${queue.length} account${queue.length === 1 ? '' : 's'} automatically`)

    try {
      let blocked = false
      const { failed } = await recaptureSessions(queue, {
        unattended: true,
        // Another automation holding the browser refuses every remaining
        // account the same way, so the sweep stops on the first such refusal.
        // Matched on the guard's wording, because CONFLICT alone also covers
        // "signed in, but the server did not keep it", which is per account.
        shouldStop: () => blocked || !mountedRef.current,
        onStart: target => setBusy(target.key, 'capturing'),
        onResult: (target, response) => {
          setBusy(target.key, 'idle')

          if (response.success) return

          if (response.error.code === 'CONFLICT' && /is running/.test(response.error.message)) {
            blocked = true
            toast.error(response.error.message)

            return
          }
          toast.error(`${target.label} · ${target.username}: ${response.error.message}`)
        }
      })

      if (mountedRef.current && failed === 0 && !blocked) toast.success('Every auto sign-in login updated')
    } finally {
      if (mountedRef.current) setAutoCapturing(false)
    }
  }, [loadHealth, platforms, setBusy, toast])

  const handleCancel = useCallback((platform: PlatformDescriptor) => {
    // Closing the window resolves the pending capture, which clears busyKey.
    void cancelCapture(platform.key)
  }, [])

  /**
   * Sweeps whichever per-credential list this platform needs — AJIO's POBs or
   * Tata CliQ's slaves. See SCOPE_LISTS.
   *
   * The two services differ only in which portal they ask; the reporting is the
   * same, so it is written once. The marketplace's own wording is passed
   * straight through on failure: AJIO's names the Enterprise switch when that
   * is what went wrong, and Tata CliQ's says to re-capture the session.
   */
  const handleSyncScope = async (
    platform: PlatformDescriptor,
    credential: CredentialRow
  ): Promise<void> => {
    const scope = SCOPE_LISTS[platform.key]

    if (!scope) return

    setScopeBusy(credential.username)

    const response = await scope.sync(credential.username)

    setScopeBusy(null)

    if (!response.success) {
      toast.error(response.error.message)

      return
    }

    const data = response.data
    const count = data.count
    const noun = scope.noun

    toast.success(
      `${count} ${noun}${count === 1 ? '' : 's'} for ${credential.username}` +
        (data.added > 0 ? ` · ${data.added} new` : '') +
        (data.removed > 0 ? ` · ${data.removed} gone` : '')
    )

    await loadHealth()
  }

  /*
   * The OTP column only when some platform on the page has the switch.
   *
   * It is Snapdeal's and Flipkart's alone, and was a column of blank cells on
   * every company without them — the widest empty thing in the table.
   */
  const showOtp = visible.some(
    platform =>
      (OTP_OPTIONAL.has(platform.key.toLowerCase()) || platform.key.toLowerCase() in ALWAYS_OTP_SOURCES) &&
      (byPlatform.get(platform.key)?.credentials.length ?? 0) > 0
  )

  return (
    /* The same frame as Manage Claims and Background Process: one header card,
       then the table card, 16px apart. `trackvid-table-fill` makes this column
       exactly as tall as the content area and gives the table every pixel the
       controls above do not use — see styles/behaviour.css. */
    <div className='ts-layout-content-height-fixed trackvid-table-fill flex flex-col gap-4'>
      <Card className='flex shrink-0 flex-col gap-3 p-3'>
        <div className='flex flex-wrap items-center justify-between gap-3'>
          <Typography variant='body2' color='text.secondary' className='max-w-prose'>
            Sign in to a marketplace once. Automations check each saved login with the marketplace
            before using it, and sign in again if it has stopped working.
          </Typography>
          <div className='flex items-center gap-2'>
            {/* HIDDEN UNTIL THERE IS SOMETHING TO CLEAR. On a company that has
                captured nothing it is a destructive-looking button that does
                nothing — which is how a button gets pressed "to see what it
                does". */}
            <Button
              size='sm'
              variant='secondary'
              icon={<i className='tabler-user-plus' />}
              onClick={() => setAdding(true)}
              disabled={locked || platforms === null}
              title='Add a marketplace login — it is checked by signing in with it'
            >
              Add login
            </Button>
            {savedSessions > 0 && (
              <Button
                size='sm'
                variant='secondary'
                icon={<i className='tabler-trash' />}
                onClick={() => setConfirmingAll(true)}
                loading={clearingAll}
                disabled={locked}
                title='Removes every saved login for this company, on every platform'
              >
                Clear all logins
              </Button>
            )}
            <Button
              size='sm'
              variant='secondary'
              icon={<i className='tabler-refresh' />}
              onClick={() => void handleRefresh()}
              loading={refreshing || autoCapturing}
              disabled={locked}
              title='Re-reads every login, then signs in again each account whose platform signs in by itself'
            >
              Refresh
            </Button>
          </div>
        </div>

        {/*
          ONE WARNING, NOT TWO. There used to be a second alert here, amber,
          under the red banner above the page — "1 of 10 credentials need…"
          under "3 logins need updating" — counting the same thing by different
          rules, so they disagreed. The banner is the one that carries the fix,
          so it is the only thing that counts problems. This line only says what
          cannot disagree with it: how many accounts hold a saved login.
        */}
        {overall.total > 0 && (
          <>
            <Divider />
            <Typography variant='body2' color='text.secondary' className='inline-flex items-center gap-1.5'>
              <i className='tabler-circle-check text-base text-success-fg' />
              <span className='tabular-nums'>{overall.active}</span> of{' '}
              <span className='tabular-nums'>{overall.total}</span> accounts have a working saved login
            </Typography>
          </>
        )}
      </Card>

      {loadError && (
        <Alert severity='error' icon={<i className='tabler-alert-circle' />} className='shrink-0'>
          {loadError}
        </Alert>
      )}

      {unreported.length > 0 && (
        <Alert severity='warning' icon={<i className='tabler-alert-triangle' />} className='shrink-0'>
          The server did not report {unreported.map(p => p.label).join(', ')}. This API build
          predates those platforms — credentials may exist but cannot be shown here.
        </Alert>
      )}

      {(!platforms || visible.length > 0 || !loadError) && (
        <Card className='trackvid-table-scroll'>
          {visible.length > 0 && (
            <table className={`${tableStyles.table} pinned-end`}>
              <thead>
                <tr>
                  {/* The expand arrow's column — empty on single-account rows,
                      so every platform name starts at the same x. */}
                  <th className='w-12' aria-label='Expand' />
                  <th>Platform</th>
                  <th>Account</th>
                  <th>Used for</th>
                  <th>Status</th>
                  {/* SEPARATE FROM STATUS, because they answer different
                      questions and were being read as one. Status is about the
                      stored SESSION — is it still good? Verified is about the
                      CREDENTIAL — does the marketplace accept this password at
                      all? A refused password makes every capture fail for ever,
                      and as a small chip beside the account name nobody saw it. */}
                  <th className='whitespace-nowrap'>Verified</th>
                  <th>Sign-in</th>
                  {devMode && (
                    <>
                      <th>Expires</th>
                      <th>Cookies</th>
                    </>
                  )}
                  {showOtp && <th className='min-w-52'>OTP</th>}
                  <th align='right'>Actions</th>
                </tr>
              </thead>
              <tbody>
                {visible.map(platform => (
                  <PlatformRow
                    key={platform.key}
                    platform={platform}
                    credentials={byPlatform.get(platform.key)?.credentials ?? []}
                    // Defaults to true, matching what the app actually does when
                    // the setting cannot be read: it attempts the scripted
                    // sign-in.
                    autoLogin={byPlatform.get(platform.key)?.autoLogin ?? true}
                    blockedBy={byPlatform.get(platform.key)?.autoLoginBlockedBy}
                    pendingFor={credential => pendingFor(platform, credential)}
                    onUpdate={(p, c) => void handleUpdate(p, c)}
                    onClear={(p, c) => setPendingClear({ platform: p, credential: c })}
                    onRemoveAccount={(p, c) => setPendingRemove({ platform: p, credential: c })}
                    busyFor={busyFor}
                    onCapture={(p, c) => void handleCapture(p, c)}
                    onCancel={handleCancel}
                    syncingScope={credential => scopeBusy === credential.username}
                    onSyncScope={(platform, credential) => void handleSyncScope(platform, credential)}
                    showOtp={showOtp}
                    showLoginInfo={showLoginInfo}
                    locked={locked}
                  />
                ))}
              </tbody>
            </table>
          )}

          {!platforms && !loadError && <LoadingState label='Reading this company’s marketplaces…' />}

          {platforms && visible.length === 0 && !loadError && (
            <EmptyState
              icon={<i className='tabler-building-store text-3xl' />}
              title='No marketplaces yet'
              message='This company has no marketplace credentials configured, so there is nothing to sign in to. They are added in TrackVid.'
            />
          )}
        </Card>
      )}

      {/* NAMES THE ACCOUNT. Over a table of near-identical rows, "remove this
          session?" does not catch the mis-click a confirmation exists for. */}
      <ConfirmDialog
        open={pendingClear !== null}
        destructive
        title='Remove this login?'
        message={
          pendingClear
            ? `The saved ${pendingClear.platform.label} login for ${pendingClear.credential.username} ` +
              'will be removed here and on the server. The account and its password are kept — only ' +
              'the login goes, and the next automation on this account signs in again.'
            : ''
        }
        confirmLabel='Remove login'
        onConfirm={() => {
          const target = pendingClear

          setPendingClear(null)

          if (target) void handleClear(target.platform, target.credential)
        }}
        onCancel={() => setPendingClear(null)}
      />

      {/* THE ACCOUNT, NOT THE SESSION — and said so, because the trash icon
          beside this one keeps the account. */}
      <ConfirmDialog
        open={pendingRemove !== null}
        destructive
        busy={removingAccount}
        title='Delete this account?'
        message={
          pendingRemove
            ? `${pendingRemove.platform.label} account ${pendingRemove.credential.username} will be deleted ` +
              'from this company — its username, password and saved login. No automation will use it again ' +
              'until it is added back.'
            : ''
        }
        confirmLabel='Delete account'
        onConfirm={() => {
          if (pendingRemove) void handleRemoveAccount(pendingRemove.platform, pendingRemove.credential)
        }}
        onCancel={() => setPendingRemove(null)}
      />

      {adding && (
        <AddCredentialModal
          open
          platforms={platforms ?? []}
          onClose={() => setAdding(false)}
          onAdded={() => {
            void loadHealth()
            notifySessionsChanged()
          }}
        />
      )}

      {/* The cost is spelled out rather than implied. This one is not an
          inconvenience on a bad day: every account signs in again, and the ones
          whose sign-in needs a one-time code need somebody there to read it. */}
      <ConfirmDialog
        open={confirmingAll}
        destructive
        busy={clearingAll}
        title='Remove every saved login?'
        message={
          `All ${savedSessions} saved login${savedSessions === 1 ? '' : 's'} for this company will be ` +
          'removed, across every platform and account. Each one has to be signed in again, and any ' +
          'that needs a one-time code will need somebody present to read it. This cannot be undone.'
        }
        confirmLabel='Remove all logins'
        onConfirm={() => void handleClearAll()}
        onCancel={() => setConfirmingAll(false)}
      />
    </div>
  )
}
