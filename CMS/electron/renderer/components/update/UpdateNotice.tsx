import { useState } from 'react'
import type { UpdateState } from '@shared/types/update'
import { UpdateLogButton, UpdateLogDialog } from './UpdateLogDialog'
import { Button } from '@renderer/components/ui/Button'
import { formatBytes } from '@renderer/utils/format'

/** Thin determinate bar; the updater reports real percentages, so no fake motion. */
const ProgressBar = ({ percent }: { percent: number }) => (
  <div
    role="progressbar"
    aria-valuenow={percent}
    aria-valuemin={0}
    aria-valuemax={100}
    className="h-1.5 w-28 overflow-hidden rounded-full bg-subtle"
  >
    <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${percent}%` }} />
  </div>
)

/**
 * Top-bar notice for an OPTIONAL update — one the policy has not forced.
 *
 * Only phases worth the user's attention appear: bytes arriving, and a build
 * staged and waiting on them. Everything else (checking, idle, an error the app
 * recovered from) stays silent — an update that works is one the user never had
 * to think about.
 *
 * IT USED TO HAVE NO INSTALL ACTION, because every update was compulsory: the
 * main process restarted the app as soon as the download landed, and
 * `isForceFullyUpdate` in appsettings changed only the wording. Turning the flag
 * off changed nothing, and an operator mid-claim lost the app to a release
 * nobody had called urgent.
 *
 * Now the flag decides. A forced build never reaches this banner — it gets the
 * blocking screen below — so everything here is the optional case, and the
 * choice is real: install now, or carry on. "Later" only hides the notice; the
 * build is already staged on disk and `autoInstallOnAppQuit` applies it the
 * next time the app closes by itself, so nothing is thrown away.
 */
export const UpdateBanner = ({
  state,
  onInstall,
  onDismiss
}: {
  state: UpdateState
  onInstall: () => void
  onDismiss: () => void
}) => {
  if (state.phase === 'downloading') {
    return (
      <div className="flex min-w-0 items-center gap-3">
        <ProgressBar percent={state.percent} />
        <p className="truncate text-sm text-secondary">
          Downloading version {state.latest} — {state.percent}%
          {state.bytesPerSecond > 0 && (
            <span className="text-faint"> ({formatBytes(state.bytesPerSecond)}/s)</span>
          )}
        </p>
      </div>
    )
  }

  if (state.phase === 'downloaded') {
    // A real choice, because the policy did not force this one. Installing
    // closes the app, so it is the operator's call when that happens — they
    // are the one who knows whether a claim run is in flight.
    return (
      <div className="flex min-w-0 items-center gap-3">
        <p role="status" className="min-w-0 flex-1 truncate text-sm text-success-fg">
          <span className="font-medium">Version {state.latest} is ready to install.</span>{' '}
          <span className="text-muted">Installing closes and reopens the app.</span>
        </p>
        <Button className="shrink-0" onClick={onInstall}>
          Restart and install
        </Button>
        <Button variant="secondary" className="shrink-0" onClick={onDismiss}>
          Later
        </Button>
      </div>
    )
  }

  return null
}

/**
 * Blocking screen for a build the server has marked mandatory. There is no way
 * past it - that is the point of the flag.
 */
export const MandatoryUpdateScreen = ({
  state,
  onCheck,
  checking
}: {
  state: UpdateState
  onCheck: () => void
  checking: boolean
}) => {
  const [logOpen, setLogOpen] = useState(false)

  return (
  /*
   * `min-h-screen`, NOT `h-full`.
   *
   * `height: 100%` only resolves if every ancestor up to <html> has a height,
   * and this screen replaces the whole app before the layout that normally
   * provides one is mounted. So the container collapsed to the card's own
   * height and the card sat at the very top of the window — centred within a
   * box that was exactly its own size. The viewport is the one height that is
   * always there.
   */
  <div className="flex min-h-screen items-center justify-center bg-canvas px-6">
    {/* `relative`, so the log button can sit in the card's own corner rather
        than pushing the heading off centre. */}
    <div className="relative w-full max-w-md rounded-xl bg-surface p-8 text-center shadow-sm ring-1 ring-subtle">
      {/* THE ONE THING THIS SCREEN CANNOT SAY IN A SENTENCE. A blocked machine
          is usually somebody else's, and "what does it say?" has been the whole
          diagnosis so far. */}
      <UpdateLogButton onClick={() => setLogOpen(true)} />
      <UpdateLogDialog open={logOpen} onClose={() => setLogOpen(false)} />

      <h1 className="text-lg font-semibold text-primary">Update required</h1>
      <p className="mt-2 text-sm text-secondary">
        Version {state.current} is no longer supported.
        {state.latest ? ` Version ${state.latest} will install automatically.` : ''}
      </p>

      {state.releaseNotes && (
        <p className="mt-4 rounded-md bg-surface-sunken px-4 py-3 text-left text-xs whitespace-pre-line text-secondary">
          {state.releaseNotes}
        </p>
      )}

      <div className="mt-6 flex flex-col items-center gap-3">
        {state.phase === 'downloading' && (
          <>
            <ProgressBar percent={state.percent} />
            <p className="text-sm text-muted">Downloading — {state.percent}%</p>
          </>
        )}

        {/* NO BUTTON. A required update installs by itself once downloaded —
            the main process quits and runs the installer a moment later
            (updater.service, AUTO_INSTALL_DELAY_MS) — so a "Restart and
            install" here only offered to do what was already happening. */}
        {state.phase === 'downloaded' && (
          <p role="status" className="text-sm text-muted">
            Version {state.latest} downloaded — the app is restarting to install it.
          </p>
        )}

        {(state.phase === 'error' || state.phase === 'unsupported') && (
          <>
            <p className="text-sm text-danger-fg">{state.message}</p>
            <Button variant="secondary" className="w-full" loading={checking} onClick={onCheck}>
              Try again
            </Button>
          </>
        )}

        {/* THE ESCAPE HATCH, AND ONLY WHEN IT IS NEEDED.
            
            This used to show whenever a link was configured — including while
            the automatic download was running, which is what the screen says
            it is doing. Two ways to do one thing, offered at the moment the
            app has it in hand, invites somebody to fetch an installer by hand
            over a download that was about to finish.
            
            It is NOT removed altogether, and that is deliberate. This screen
            cannot be dismissed: on a machine where the app cannot fetch the
            build itself — an unpackaged build, a missing latest.yml, a feed it
            cannot reach — a forced policy with no link is a dead end, and the
            operator's only remaining move is to uninstall. So it appears
            exactly where that applies: after the automatic path has failed. */}
        {state.downloadUrl && (state.phase === 'error' || state.phase === 'unsupported') && (
          <a
            href={state.downloadUrl}
            target="_blank"
            rel="noreferrer"
            className="text-sm text-accent underline underline-offset-2"
          >
            Download {state.latest ?? 'the update'} manually
          </a>
        )}

        {(state.phase === 'checking' || state.phase === 'available' || state.phase === 'idle') && (
          <p className="text-sm text-muted">Preparing the update…</p>
        )}
      </div>
    </div>
  </div>
  )
}
