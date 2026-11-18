import { useEffect, useState } from 'react'
import Card from '@mui/material/Card'
import CircularProgress from '@mui/material/CircularProgress'
import LinearProgress from '@mui/material/LinearProgress'
import Paper from '@mui/material/Paper'
import Typography from '@mui/material/Typography'
import tableStyles from '@core/styles/table.module.css'
import type { TatCheckProgress, TatRowResult } from '@shared/types/tatCheck'
import { Button } from '@renderer/components/ui/Button'
import { Modal } from '@renderer/components/ui/Modal'
import { onTatCheckProgress } from '@renderer/services/tatCheck.service'
import { classNames } from '@renderer/utils/format'
import { TruncatedText } from '@renderer/components/ui/TruncatedText'

/**
 * Check TAT, while it runs.
 *
 * One marketplace round trip per claim, so twenty-five rows take a couple of
 * minutes — long enough that a spinner on a button says nothing. This counts
 * down instead: how many are left, what each answer was, and how many claims
 * have been moved to Failed to Proceed as it goes.
 *
 * The three outcomes are kept apart on purpose:
 *   Expired    the marketplace refused the window — moved, and gone from Pending
 *   Claimable  still fileable, nothing written
 *   Unknown    could not be established — nothing written, and the row is still
 *              sitting in Pending waiting for someone
 *
 * Fed by an event rather than polling, so it keeps counting even if the run
 * outlives the click that started it.
 *
 * The page remounts this with a fresh `key` per run, so a new check starts from
 * empty without an effect resetting state on the way in — the previous run's
 * numbers would otherwise show for the moment before its first event lands.
 */

interface Props {
  open: boolean
  /** Shown before the first progress event lands. */
  total: number
  onClose: () => void
}

const OUTCOME: Record<
  TatRowResult['outcome'],
  { label: string; className: string; icon: string }
> = {
  expired: { label: 'ME1: TAT expired', className: 'text-error', icon: 'tabler-clock' },
  // Its own label, because the fix is its own: Refill Data can repair a wrong
  // sub-order number, and nothing can repair a closed window.
  blocked: { label: 'ME2: Bad sub-order number', className: 'text-warning-fg', icon: 'tabler-ban' },
  within: { label: 'Claimable', className: 'text-success-fg', icon: 'tabler-circle-check' },
  unknown: { label: 'Not checked', className: 'text-textSecondary', icon: 'tabler-help-circle' }
}

export const TatCheckModal = ({ open, total, onClose }: Props) => {
  const [progress, setProgress] = useState<TatCheckProgress | null>(null)

  useEffect(() => {
    if (!open) return undefined

    return onTatCheckProgress(setProgress)
  }, [open])

  const count = progress?.total ?? total
  const done = progress?.done ?? 0
  const remaining = Math.max(0, count - done)
  const finished = progress?.finished ?? false
  const percent = count > 0 ? Math.round((done / count) * 100) : 0

  return (
    <Modal
      open={open}
      size="md"
      title="Checking claim windows"
      description={
        finished
          ? `${count} claim${count === 1 ? '' : 's'} checked`
          : `${remaining} of ${count} to go — asking the marketplace about each claim`
      }
      // Closing mid-run only closes the dialog; the run carries on and its
      // writes still land. Saying so beats implying it can be cancelled.
      onClose={onClose}
      footer={
        <>
          <Typography variant="caption" color="text.secondary" className="self-center">
            {finished ? 'Done.' : 'You can close this — the check keeps running.'}
          </Typography>
          <div className="flex-1" />
          <Button size="sm" onClick={onClose}>{finished ? 'Close' : 'Hide'}</Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div>
          <LinearProgress
            variant="determinate"
            value={percent}
            color={finished ? 'success' : 'primary'}
          />
          <Typography
            variant="caption"
            color="text.secondary"
            component="p"
            className="mbs-2 flex items-center gap-2"
          >
            {!finished && <CircularProgress size={12} color="inherit" />}
            {finished
              ? 'Every claim answered.'
              : progress?.current
                ? `Checking ${progress.current}…`
                : 'Starting…'}
          </Typography>
        </div>

        {/* Four, because "cannot be filed" has two causes with two different
            fixes: a closed window, which nothing repairs, and a sub-order
            number, which Refill Data does. */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {(
            [
              ['Expired', progress?.expired ?? 0, 'error.main'],
              ['Bad sub-order', progress?.blocked ?? 0, 'warning.main'],
              ['Claimable', progress?.within ?? 0, 'success.main'],
              ['Not checked', progress?.unknown ?? 0, 'text.secondary']
            ] as const
          ).map(([label, value, tone]) => (
            <Card key={label} variant="outlined" className="p-3 text-center">
              <Typography variant="subtitle2" color={tone} className="font-semibold tabular-nums">
                {value}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {label}
              </Typography>
            </Card>
          ))}
        </div>

        <Typography variant="body2" color="text.secondary">
          Moved to <span className="font-medium">Failed to Proceed</span> —{' '}
          <span className="font-medium">ME1: TAT expired</span> or{' '}
          <span className="font-medium">ME2: Invalid sub order number.</span>:{' '}
          <span className="font-semibold tabular-nums">{progress?.moved ?? 0}</span>
        </Typography>

        {(progress?.recent.length ?? 0) > 0 && (
          <Paper variant="outlined" className="max-h-56 overflow-auto">
            <table className={tableStyles.table}>
              <tbody>
                {progress?.recent.map(row => {
                  const { label, className, icon } = OUTCOME[row.outcome]

                  return (
                    <tr key={row.cmsId}>
                      <td className="font-medium text-textPrimary">{row.awb}</td>
                      <td className={className}>
                        <span className="flex items-center gap-2">
                          <i className={classNames(icon, 'text-base')} aria-hidden="true" />
                          {label}
                        </span>
                      </td>
                      <td className="max-w-72">
                        <TruncatedText text={row.message} />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </Paper>
        )}
      </div>
    </Modal>
  )
}
