import { useCallback, useEffect, useMemo, useState } from 'react'

// MUI Imports
import Alert from '@mui/material/Alert'
import Card from '@mui/material/Card'
import Divider from '@mui/material/Divider'
import IconButton from '@mui/material/IconButton'
import LinearProgress from '@mui/material/LinearProgress'
import Paper from '@mui/material/Paper'
import Typography from '@mui/material/Typography'

import {
  NYKAA_DDR_ISSUE,
  isNykaaDdrRetryable,
  type NykaaDdrBucketCounts,
  type NykaaDdrRun,
  type NykaaDdrUpload
} from '@shared/types/nykaaBulkDdr'
import { Button } from '@renderer/components/ui/Button'
import { Modal } from '@renderer/components/ui/Modal'
import { useToast } from '@renderer/hooks/useToast'
import {
  chooseDdrFile,
  ddrRunStatus,
  downloadDdrTemplate,
  onDdrProgress,
  openDdrReport,
  retryDdrRun,
  startDdrRun
} from '@renderer/services/nykaaBulkDdr.service'

/**
 * The Nykaa DDR bulk claim.
 *
 * One upload slot, because Nykaa has one claim to raise here: DDR — the return
 * shows delivered and never arrived. Every row is raised with the issue
 * "Delivered but Not Received"; the rest comes from the sheet.
 *
 * A run files in the main process, so this window can be closed while it runs;
 * reopening it reads the run back.
 */

interface Props {
  open: boolean
  onClose: () => void
}

/** Skipped rows, worst-to-know-about first. */
const BUCKET_LABELS: [Exclude<keyof NykaaDdrBucketCounts, 'claimable'>, string][] = [
  ['noAccount', 'No matching Nykaa login'],
  ['missingAwb', 'No Return AWB'],
  ['missingSku', 'No SKU ID'],
  ['badReturnType', 'Return Type not RTO / DTO'],
  ['duplicate', 'Duplicate sheet row']
]

export const NykaaDdrBulkModal = ({ open, onClose }: Props) => {
  const toast = useToast()
  const [upload, setUpload] = useState<NykaaDdrUpload | null>(null)
  const [run, setRun] = useState<NykaaDdrRun | null>(null)
  const [busy, setBusy] = useState(false)

  // A run outlives this window, so the current one is fetched on open.
  useEffect(() => {
    if (!open) return

    let live = true

    void ddrRunStatus().then(result => {
      if (live && result.success) setRun(result.data)
    })

    return () => {
      live = false
    }
  }, [open])

  useEffect(() => onDdrProgress(setRun), [])

  const running = run?.status === 'running'

  const pick = useCallback(async () => {
    const result = await chooseDdrFile()

    if (!result.success) {
      // Cancelling the dialog is not an error worth a toast.
      if (result.error.message !== 'No file chosen') toast.error(result.error.message)

      return
    }

    setUpload(result.data)
  }, [toast])

  const template = useCallback(async () => {
    const result = await downloadDdrTemplate()

    if (result.success) toast.success('Template saved')
    else if (result.error.message !== 'Cancelled') toast.error(result.error.message)
  }, [toast])

  const submit = useCallback(async () => {
    if (!upload) return

    setBusy(true)

    const result = await startDdrRun(upload)

    setBusy(false)

    if (!result.success) {
      toast.error(result.error.message)

      return
    }

    setRun(result.data)

    if (result.data.claimable === 0) toast.error('Nothing in that sheet can be filed — see the breakdown')
    else toast.success(`Filing ${result.data.claimable} DDR claim${result.data.claimable === 1 ? '' : 's'}`)
  }, [toast, upload])

  const retryable = useMemo(
    () => (run && !running ? run.rows.filter(isNykaaDdrRetryable).length : 0),
    [run, running]
  )

  const retry = useCallback(async () => {
    setBusy(true)

    const result = await retryDdrRun()

    setBusy(false)

    if (!result.success) {
      toast.error(result.error.message)

      return
    }

    setRun(result.data)
    toast.success(`Retrying ${result.data.claimable} claim${result.data.claimable === 1 ? '' : 's'}`)
  }, [toast])

  const progress = run && run.claimable > 0 ? Math.round((run.done / run.claimable) * 100) : 0

  return (
    <Modal
      open={open}
      title="Nykaa DDR Bulk Claim"
      description={`Upload a sheet with SKU ID, Return AWB and Return Type (RTO / DTO) — plus Account (the Nykaa login's username) or Vendor Code when there are several logins. Every row is raised on Nykaa's dispute portal as "${NYKAA_DDR_ISSUE}", from this machine.`}
      onClose={onClose}
      busy={busy}
      footer={
        <>
          <Button
            size="sm"
            variant="ghost"
            icon={<i className="tabler-download text-base" />}
            onClick={() => void template()}
          >
            Download template
          </Button>
          <div className="flex-1" />
          <Button size="sm" variant="secondary" onClick={onClose} disabled={busy}>
            {running ? 'Close — keeps running' : 'Cancel'}
          </Button>
          <Button size="sm" loading={busy} disabled={!upload || running} onClick={() => void submit()}>
            {running ? 'Running…' : 'Submit'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Paper
          variant="outlined"
          className="flex items-start gap-3 p-3 transition-colors"
          sx={upload ? { borderColor: 'success.main' } : undefined}
        >
          <i
            className={
              upload
                ? 'tabler-file-spreadsheet mt-0.5 shrink-0 text-base text-success-fg'
                : 'tabler-file-spreadsheet mt-0.5 shrink-0 text-base text-textDisabled'
            }
          />

          <div className="min-is-0 flex-1">
            <Typography variant="body2" color="text.primary" className="font-medium">
              DDR — Delivered but Not Received
            </Typography>
            <Typography variant="caption" color="text.secondary" className="mt-0.5 block">
              Nykaa shows the return as delivered and you never received it. Subject “Delivery dispute Returns”; a
              Description column replaces the standard message for that row.
            </Typography>

            {upload && (
              <Typography variant="caption" color="success.main" className="mbs-2 block truncate font-medium">
                {upload.fileName} · {upload.rowCount} row{upload.rowCount === 1 ? '' : 's'}
              </Typography>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-1">
            <Button
              size="sm"
              variant={upload ? 'ghost' : 'secondary'}
              icon={<i className="tabler-upload text-base" />}
              disabled={running}
              onClick={() => void pick()}
            >
              {upload ? 'Replace' : 'Upload'}
            </Button>

            {upload && (
              <IconButton size="small" aria-label="Remove the DDR file" disabled={running} onClick={() => setUpload(null)}>
                <i className="tabler-x text-lg" />
              </IconButton>
            )}
          </div>
        </Paper>

        {run && (
          <Card variant="outlined" className="flex flex-col gap-3 p-3">
            <div className="flex items-baseline justify-between gap-3">
              <Typography variant="body2" color="text.primary" className="font-medium">
                {run.status === 'done'
                  ? run.attempts > 1
                    ? `Finished — combined result of ${run.attempts} attempts`
                    : 'Finished'
                  : run.status === 'failed'
                    ? 'Stopped'
                    : `Filing ${run.done} of ${run.claimable}`}
              </Typography>
              <Typography variant="caption" color="text.secondary" className="truncate">
                {run.upload.fileName}
                {run.accounts.length ? ` · ${run.accounts.join(', ')}` : ''}
              </Typography>
            </div>

            <LinearProgress variant="determinate" value={run.status === 'done' ? 100 : progress} />

            <div className="flex flex-wrap gap-x-4 gap-y-1">
              <Typography variant="caption" color="success.main" className="inline-flex items-center gap-1">
                <i className="tabler-circle-check text-base" />
                {run.summary.success} filed
              </Typography>
              {run.summary.alreadyFiled > 0 && (
                <Typography variant="caption" color="text.secondary" className="inline-flex items-center gap-1">
                  <i className="tabler-copy text-base" />
                  {run.summary.alreadyFiled} already had a ticket
                </Typography>
              )}
              {run.summary.failed > 0 && (
                <Typography variant="caption" color="error.main" className="inline-flex items-center gap-1">
                  <i className="tabler-circle-x text-base" />
                  {run.summary.failed} failed
                </Typography>
              )}
              {run.summary.dryRun > 0 && (
                <Typography variant="caption" color="warning.main" className="inline-flex items-center gap-1">
                  <i className="tabler-flask text-base" />
                  {run.summary.dryRun} held (submit disabled)
                </Typography>
              )}
            </div>

            {BUCKET_LABELS.some(([key]) => run.buckets[key] > 0) && (
              <>
                <Divider />
                {/* Why rows will NOT be filed — the moment an operator can still fix the sheet. */}
                <div className="flex flex-wrap gap-x-4 gap-y-1">
                  {BUCKET_LABELS.filter(([key]) => run.buckets[key] > 0).map(([key, label]) => (
                    <Typography key={key} variant="caption" color="text.secondary">
                      {label}: <span className="font-medium text-textPrimary">{run.buckets[key]}</span>
                    </Typography>
                  ))}
                </div>
              </>
            )}

            {run.error && <Alert severity="error">{run.error}</Alert>}

            {(retryable > 0 || run.reportPath) && (
              <div className="flex flex-wrap gap-2">
                {retryable > 0 && (
                  <Button
                    size="sm"
                    loading={busy}
                    disabled={busy}
                    icon={<i className="tabler-refresh text-base" />}
                    title="Re-reads the same sheet and files every row that has no ticket yet, into this same report"
                    onClick={() => void retry()}
                  >
                    Retry ({retryable})
                  </Button>
                )}
                {run.reportPath && (
                  <Button
                    size="sm"
                    variant="secondary"
                    icon={<i className="tabler-folder-open text-base" />}
                    onClick={() => void openDdrReport()}
                  >
                    Show report
                  </Button>
                )}
              </div>
            )}
          </Card>
        )}
      </div>
    </Modal>
  )
}
