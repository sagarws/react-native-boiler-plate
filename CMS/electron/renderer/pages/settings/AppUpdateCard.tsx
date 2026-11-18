import { useState } from 'react'
import { Download, PackageCheck, RefreshCw, RotateCw } from 'lucide-react'
import LinearProgress from '@mui/material/LinearProgress'
import Typography from '@mui/material/Typography'
import { Badge } from '@renderer/components/ui/Badge'
import { Button } from '@renderer/components/ui/Button'
import { Card } from '@renderer/components/ui/Card'
import { ConfirmDialog } from '@renderer/components/ui/ConfirmDialog'
import { useUpdater } from '@renderer/hooks/useUpdater'
import { useToast } from '@renderer/hooks/useToast'
import { updateClient } from '@renderer/services/update.service'

/**
 * What this machine is running, and the one button that changes it.
 *
 * ONE CARD, because the two halves are the same question asked twice. The
 * version was on the profile screen and the offer to install arrived as a
 * banner over whatever the operator was doing — so "am I up to date?" and "how
 * do I update?" lived in different places, and the answer to the first was in
 * the one screen nobody opens.
 *
 * THE BUTTON SAYS WHAT WILL HAPPEN, which changes with the phase: check, then
 * download, then restart. A single label ("Update") would be a lie in two of
 * the three states — the app restarts to install, and an operator mid-claim
 * deserves to know that before pressing it, not after.
 *
 * NOTHING IS AUTOMATIC HERE. A mandatory release still blocks the app through
 * its own screen; this card is for the operator who wants to go and look.
 */

const PHASE_LABEL: Record<string, { text: string; tone: 'neutral' | 'warning' | 'success' }> = {
  idle: { text: 'Up to date', tone: 'success' },
  checking: { text: 'Checking…', tone: 'neutral' },
  available: { text: 'Update available', tone: 'warning' },
  downloading: { text: 'Downloading', tone: 'warning' },
  downloaded: { text: 'Ready to install', tone: 'success' },
  error: { text: 'Check failed', tone: 'warning' },
  // Development, or a build with no feed: there is nothing to offer and saying
  // "up to date" would claim a check that never happened.
  unsupported: { text: 'Updates not available in this build', tone: 'neutral' }
}

const megabytes = (bytes: number): string => `${(bytes / 1024 / 1024).toFixed(1)} MB`

export const AppUpdateCard = () => {
  const { state, checking, check, install } = useUpdater()
  const toast = useToast()
  const [confirmingReinstall, setConfirmingReinstall] = useState(false)
  const [reinstalling, setReinstalling] = useState(false)

  /*
   * REINSTALL THIS VERSION — for a release re-uploaded under the same version
   * number. The updater compares numbers and would never fetch it; this
   * downloads the current installer regardless, checks it against latest.yml,
   * and reinstalls (the app closes and reopens). Installed builds only.
   */
  const reinstall = async (): Promise<void> => {
    setReinstalling(true)

    const response = await updateClient.reinstall()

    // On success the app is already quitting; only a failure comes back here.
    setReinstalling(false)
    setConfirmingReinstall(false)

    if (!response.success) toast.error(response.error.message)
  }
  const phase = PHASE_LABEL[state.phase] ?? PHASE_LABEL.idle
  // ENABLED EVEN IN A BUILD THAT CANNOT INSTALL ONE.
  //
  // 'unsupported' used to disable this, which made the button dead in every
  // development build — and with it the only way to ask the server what the
  // release policy currently says. The check now always reaches the policy
  // feed; only the INSTALL half needs a packaged app. A download already in
  // flight is still a reason to wait, because starting another is not a check.
  const canCheck = state.phase !== 'downloading' && !checking

  return (
    <Card
      icon={<RotateCw size={16} />}
      title="App version"
      description="Which build this machine is running, and where it stands against the latest release."
      headerAction={<Badge tone={phase?.tone ?? 'neutral'}>{phase?.text ?? 'Up to date'}</Badge>}
      footer={
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button
            variant="secondary"
            icon={<RefreshCw size={16} />}
            loading={checking || state.phase === 'checking'}
            disabled={!canCheck}
            onClick={check}
          >
            Check for updates
          </Button>

          <Button
            variant="secondary"
            icon={<PackageCheck size={16} />}
            loading={reinstalling}
            disabled={state.phase === 'unsupported' || state.phase === 'downloading' || reinstalling}
            title={
              state.phase === 'unsupported'
                ? 'Reinstall is only available in an installed app'
                : 'Download this version again from the update server and reinstall it'
            }
            onClick={() => setConfirmingReinstall(true)}
          >
            Reinstall app
          </Button>

          {/* Only once there is something to do. A button that is always there
              and usually does nothing teaches people it does nothing. */}
          {state.phase === 'downloaded' && (
            <Button icon={<Download size={16} />} onClick={install}>
              Restart &amp; install {state.latest}
            </Button>
          )}
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
          <span className="text-sm text-muted">Installed</span>
          <span className="font-mono text-sm text-primary">{state.current || '—'}</span>

          {state.latest && state.latest !== state.current && (
            <>
              <span className="text-sm text-muted">Latest</span>
              <span className="font-mono text-sm text-primary">{state.latest}</span>
            </>
          )}
        </div>

        {state.phase === 'downloading' && (
          <div className="flex flex-col gap-1">
            <LinearProgress variant="determinate" value={state.percent} />
            <Typography variant="caption" color="text.secondary">
              {state.percent}%
              {state.totalBytes > 0 && ` of ${megabytes(state.totalBytes)}`}
              {state.bytesPerSecond > 0 && ` · ${megabytes(state.bytesPerSecond)}/s`}
            </Typography>
          </div>
        )}

        {/* The restart is the part worth saying out loud: an operator with a
            claim run going should finish it first. */}
        {state.phase === 'downloaded' && (
          <p className="max-w-prose text-sm text-muted">
            Version {state.latest} is downloaded. Installing closes the app and reopens it — any
            automation running on this machine stops, and unfinished claims are picked up on the
            next run.
          </p>
        )}

        {state.phase === 'available' && (
          <p className="max-w-prose text-sm text-muted">
            Version {state.latest} is downloading in the background. You can carry on working; this
            card says when it is ready to install.
          </p>
        )}

        {state.message && (
          <p role="alert" className="max-w-prose text-sm text-danger-fg">
            {state.message}
          </p>
        )}

        {/* The way out when this build cannot fetch its own update. The policy
            names a version even where there is no manifest to read one from,
            so an operator here can still see what they are missing and go and
            get it by hand. */}
        {state.downloadUrl && state.latest && state.latest !== state.current && (
          <p className="max-w-prose text-sm text-muted">
            Version {state.latest} can be downloaded and installed manually:{' '}
            <a
              href={state.downloadUrl}
              target="_blank"
              rel="noreferrer"
              className="text-accent underline underline-offset-2"
            >
              open the download
            </a>
            .
          </p>
        )}

        {state.releaseNotes && (
          <div className="flex flex-col gap-1">
            <span className="text-sm font-medium text-primary">What changed</span>
            <p className="max-w-prose whitespace-pre-line text-sm text-muted">
              {state.releaseNotes}
            </p>
          </div>
        )}
      </div>
      <ConfirmDialog
        open={confirmingReinstall}
        busy={reinstalling}
        title="Reinstall the app?"
        message={
          `Downloads the latest installer from the update server — even at version ${state.current} — ` +
          'and reinstalls it. The app closes and reopens by itself; anything running stops at its next step.'
        }
        confirmLabel="Download and reinstall"
        onConfirm={() => void reinstall()}
        onCancel={() => setConfirmingReinstall(false)}
      />
    </Card>
  )
}
