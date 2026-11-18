import { useEffect, useState } from 'react'
import Card from '@mui/material/Card'
import CircularProgress from '@mui/material/CircularProgress'
import LinearProgress from '@mui/material/LinearProgress'
import Paper from '@mui/material/Paper'
import Typography from '@mui/material/Typography'
import tableStyles from '@core/styles/table.module.css'
import type { RefillProgress, RefillRowResult } from '@shared/types/refill'
import { REFILL_LABELS } from '@shared/constants/refill'
import { Button } from '@renderer/components/ui/Button'
import { Modal } from '@renderer/components/ui/Modal'
import { onRefillProgress } from '@renderer/services/refill.service'
import { classNames } from '@renderer/utils/format'
import { TruncatedText } from '@renderer/components/ui/TruncatedText'

/**
 * Refill Data, while it runs.
 *
 * One marketplace round trip per claim — sometimes two — so a batch of fifty is
 * minutes. This counts down and names what it wrote, because "filled" and
 * "nothing to do" are both good outcomes and only one of them changed anything.
 *
 * Four outcomes, kept apart on purpose:
 *   Filled        something was written
 *   Unchanged     asked, and the row already had it
 *   Not found     no account holds the AWB, so nothing could be asked
 *   Failed        the call or the write broke — the only one to act on
 *
 * The page remounts this per run, so a new one starts empty without an effect
 * resetting state on the way in.
 */

interface Props {
  open: boolean
  total: number
  onClose: () => void
}

const OUTCOME: Record<
  RefillRowResult['outcome'],
  { label: string; className: string; icon: string }
> = {
  filled: { label: 'Filled', className: 'text-success-fg', icon: 'tabler-circle-check' },
  'nothing-to-do': { label: 'Unchanged', className: 'text-textSecondary', icon: 'tabler-circle-dashed' },
  'not-found': { label: 'Not found', className: 'text-textSecondary', icon: 'tabler-circle-dashed' },
  failed: { label: 'Failed', className: 'text-error', icon: 'tabler-circle-x' }
}

export const RefillProgressModal = ({ open, total, onClose }: Props) => {
  const [progress, setProgress] = useState<RefillProgress | null>(null)

  useEffect(() => {
    if (!open) return undefined

    return onRefillProgress(setProgress)
  }, [open])

  const count = progress?.total ?? total
  const done = progress?.done ?? 0
  const remaining = Math.max(0, count - done)
  const finished = progress ? !progress.running : false
  const percent = count > 0 ? Math.round((done / count) * 100) : 0
  const fields = (progress?.fields ?? []).map(field => REFILL_LABELS[field].label).join(', ')

  return (
    <Modal
      open={open}
      size="lg"
      title="Refilling claim data"
      description={
        finished
          ? `${count} claim${count === 1 ? '' : 's'} checked${fields ? ` — ${fields}` : ''}`
          : `${remaining} of ${count} to go${fields ? ` — ${fields}` : ''}`
      }
      onClose={onClose}
      footer={
        <>
          <Typography variant="caption" color="text.secondary" className="self-center">
            {finished ? 'Done.' : 'You can close this — the run keeps going.'}
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
              ? (progress?.notFound ?? 0) > 0 || (progress?.failed ?? 0) > 0
                ? // Not "every claim answered": some of them were not.
                  `${(progress?.notFound ?? 0) + (progress?.failed ?? 0)} of ${count} came back ` +
                  'with no answer — see below.'
                : 'Every claim answered.'
              : progress?.current
                ? `Asking about ${progress.current}…`
                : 'Starting…'}
          </Typography>
        </div>

        {/* Four, not three. "Not found" used to be counted as Unchanged, which
            reported the reassuring outcome for the alarming one: a row nobody
            on the platform has heard of needs looking at, and a row that
            already agrees with the marketplace needs nothing. */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {(
            [
              ['Filled', progress?.filled ?? 0, 'success.main'],
              ['Unchanged', progress?.untouched ?? 0, 'text.secondary'],
              ['Not found', progress?.notFound ?? 0, 'warning.main'],
              ['Failed', progress?.failed ?? 0, 'error.main']
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

        {(progress?.recent.length ?? 0) > 0 && (
          <Paper variant="outlined" className="max-h-56 overflow-auto">
            <table className={tableStyles.table}>
              <tbody>
                {progress?.recent.map(row => {
                  const { label, className, icon } = OUTCOME[row.outcome]

                  return (
                    <tr key={row.cmsId}>
                      <td className="font-medium text-textPrimary">{row.awbNumber}</td>
                      <td className={className}>
                        <span className="flex items-center gap-2">
                          <i className={classNames(icon, 'text-base')} aria-hidden="true" />
                          {label}
                        </span>
                      </td>
                      <td className="max-w-88">
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
