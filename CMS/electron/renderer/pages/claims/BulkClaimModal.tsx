import { useCallback, useEffect, useMemo, useState } from 'react'

// MUI Imports
import Alert from '@mui/material/Alert'
import Card from '@mui/material/Card'
import Divider from '@mui/material/Divider'
import IconButton from '@mui/material/IconButton'
import LinearProgress from '@mui/material/LinearProgress'
import Paper from '@mui/material/Paper'
import Typography from '@mui/material/Typography'

// Icon Imports — the shared Tabler set, bundled; see scripts/build-icon-subset.
import type { BulkClaimType, BulkSpfPlan, BulkSpfRun, BulkSpfUpload } from '@shared/types/bulkSpf'
import { Button } from '@renderer/components/ui/Button'
import { Modal } from '@renderer/components/ui/Modal'
import { Switch } from '@renderer/components/ui/Switch'
import { useToast } from '@renderer/hooks/useToast'
import {
  bulkRunStatus,
  chooseBulkFile,
  fillPobIds,
  downloadBulkTemplate,
  onBulkProgress,
  openBulkReport,
  planBulkRun,
  retryFailedBulkRun,
  startBulkRun
} from '@renderer/services/bulkSpf.service'
import { isRetryableRow, type BulkRetryScope } from '@shared/utils/bulkRetry'
import { BulkPlanModal } from './BulkPlanModal'
import { RetryScopeModal } from './RetryScopeModal'

/**
 * The AJIO NDR/DDR bulk claim.
 *
 * Two slots, because the operator is telling us something the spreadsheet
 * cannot: WHICH claim to raise. The slot a file lands in decides it. That is
 * the one thing here that is not derivable from the data, which is why the
 * modal is two rows rather than one file picker.
 *
 * Either slot alone is enough to submit — a week with only not-delivered
 * returns is an ordinary week, and forcing an empty second upload would mean
 * inventing a file.
 *
 * A run is a background job. Submit returns as soon as the rows are sorted; the
 * claims file in the main process, the corner panel follows them, and this
 * window can be minimised (or closed) without stopping anything. Every run is a
 * TrackVid job whose history — counts and the AWBs it did not file — History
 * reopens.
 */

interface Props {
  open: boolean
  onClose: () => void
  /** Hide the window and leave the run going — the corner panel can bring it back. */
  onMinimise: () => void
  /**
   * Show the Jobs page. Closes this window on the way, since the page is where
   * the run is read back from and the window is not what keeps it alive.
   */
  onOpenJobs?: (() => void) | undefined
}

const ROWS: { type: BulkClaimType; title: string; blurb: string }[] = [
  {
    type: 'NDR',
    title: 'NDR — Not Delivered Returns',
    blurb: 'The return never arrived. Asks AJIO to trace it, then pay out under SPF if it is lost.'
  },
  {
    type: 'DDR',
    title: 'DDR — Delivery Disputes Returns',
    blurb: 'AJIO says it was delivered and you never received it. Asks for the POD.'
  }
]

/** Skipped rows, worst-to-know-about first. */
const BUCKET_LABELS: [keyof BulkSpfRun['buckets'], string][] = [
  ['noAccount', 'POB not on any AJIO login here'],
  ['missingPob', 'No POB ID'],
  ['alreadyClaimed', 'Already claimed'],
  ['unknownType', 'Unknown claim type'],
  ['notSelected', 'Not selected'],
  ['duplicate', 'Duplicate sheet row'],
  ['noReturnNumber', 'No return number']
]

export const BulkClaimModal = ({ open, onClose, onMinimise, onOpenJobs }: Props) => {
  const toast = useToast()
  const [uploads, setUploads] = useState<Partial<Record<BulkClaimType, BulkSpfUpload>>>({})
  const [run, setRun] = useState<BulkSpfRun | null>(null)
  const [busy, setBusy] = useState(false)
  /** The POB fill: its own flag, because it can run before anything is uploaded. */
  const [filling, setFilling] = useState(false)
  // Selected Proceed: review the sorted rows and tick which to file before the
  // run starts. Kept while the page is mounted, so it survives closing the window.
  const [selectedProceed, setSelectedProceed] = useState(false)
  const [plan, setPlan] = useState<BulkSpfPlan | null>(null)
  // Bumped per plan: remounts the review so its selection starts from THAT plan.
  const [planSerial, setPlanSerial] = useState(0)

  // A run outlives this modal — an operator can close it, walk away and come
  // back — so the current one is fetched on open rather than assumed absent.
  useEffect(() => {
    if (!open) return

    void bulkRunStatus().then(result => {
      if (result.success) setRun(result.data)
    })
  }, [open])

  useEffect(() => onBulkProgress(setRun), [])

  const running = run?.status === 'running' || run?.status === 'preparing'
  const chosen = useMemo(
    () => Object.values(uploads).filter((upload): upload is BulkSpfUpload => Boolean(upload)),
    [uploads]
  )

  const pick = useCallback(
    async (claimType: BulkClaimType) => {
      const result = await chooseBulkFile(claimType)

      if (!result.success) {
        // Cancelling the dialog is not an error worth a toast.
        if (result.error.message !== 'No file chosen') toast.error(result.error.message)

        return
      }

      setUploads(current => ({ ...current, [claimType]: result.data }))
    },
    [toast]
  )

  /*
   * THE WAY IN FOR AN OPERATOR WHO HAS ONLY AWBs.
   *
   * The POB is an AJIO-internal id, and a bulk-claim row without one is never
   * attempted — so a sheet made from courier AWBs could not be used at all.
   * This takes that sheet and returns the one the claim needs, filled from the
   * machine's backup where possible and from AJIO where not.
   *
   * It writes a FILE rather than filling the upload slot directly: the operator
   * should see what was and was not found before anything is claimed, and the
   * rows that could not be filled carry their reason in the sheet.
   */
  const fillPob = useCallback(async () => {
    setFilling(true)

    const result = await fillPobIds()

    setFilling(false)

    if (!result.success) {
      // Neither cancel is a failure: one is "changed my mind before", the
      // other "changed my mind after". Only a real fault gets a red toast.
      const cancelled = ['No file chosen', 'Save cancelled']

      if (!cancelled.includes(result.error.message)) toast.error(result.error.message)

      return
    }

    const { filled, total, missing, outputPath } = result.data

    // The counts, not just "done": a sheet where half the rows found nothing
    // is a different situation from one that filled completely, and the
    // operator decides what to do about it.
    if (missing === 0) {
      toast.success(`All ${total} row(s) filled — saved as ${outputPath.split(/[\\/]/).pop()}`)
    } else {
      toast.info(
        `${filled} of ${total} row(s) filled — ${missing} not found. Saved as ${outputPath
          .split(/[\\/]/)
          .pop()}; the sheet says why for each.`
      )
    }
  }, [toast])

  const template = useCallback(async () => {
    const result = await downloadBulkTemplate()

    if (result.success) toast.success('Template saved')
    else if (result.error.message !== 'Cancelled') toast.error(result.error.message)
  }, [toast])

  /** Selected Proceed's first step: sort the rows and open the review. Files nothing. */
  const review = useCallback(async () => {
    setBusy(true)

    const result = await planBulkRun(chosen)

    setBusy(false)

    if (!result.success) {
      toast.error(result.error.message)

      return
    }

    setPlanSerial(serial => serial + 1)
    setPlan(result.data)
  }, [chosen, toast])

  /** Starts the background job — every claimable row, or only `selectedKeys` from the review. */
  const submit = useCallback(async (selectedKeys?: string[]) => {
    setBusy(true)

    const result = await startBulkRun(chosen, selectedKeys)

    setBusy(false)

    if (!result.success) {
      toast.error(result.error.message)

      return
    }

    setPlan(null)
    setRun(result.data)

    if (!result.data.jobRecorded) {
      toast.error('Filing continues, but TrackVid did not record this job — it will not appear in History')
    }

    if (result.data.claimable === 0) toast.error('Nothing in those files is claimable — see the breakdown')
    else toast.success(`Filing ${result.data.claimable} claim${result.data.claimable === 1 ? '' : 's'}`)
  }, [chosen, toast])

  /*
   * Retry files failed and/or skipped rows again — the operator picks which in
   * the popup — INTO THIS RUN, same job, same report, so the card below always
   * shows the combined result of every attempt.
   */
  const retryable = useMemo(
    () => (run && !running ? run.rows.filter(row => isRetryableRow(row)).length : 0),
    [run, running]
  )
  const [retryOpen, setRetryOpen] = useState(false)

  const retry = useCallback(
    async (scope: BulkRetryScope) => {
      setBusy(true)

      const result = await retryFailedBulkRun(scope)

      setBusy(false)

      if (!result.success) {
        toast.error(result.error.message)

        return
      }

      setRetryOpen(false)
      setRun(result.data)
      toast.success(`Retrying ${result.data.retrying ?? 0} claim${result.data.retrying === 1 ? '' : 's'}`)
    },
    [toast]
  )

  const attempts = run?.attempts ?? 1
  const progress = run && run.claimable > 0 ? Math.round((run.done / run.claimable) * 100) : 0

  return (
    <>
      <BulkPlanModal
        key={planSerial}
        open={open && plan !== null}
        plan={plan}
        busy={busy}
        onClose={() => setPlan(null)}
        onSubmit={selectedKeys => void submit(selectedKeys)}
      />
      <RetryScopeModal
        key={retryOpen ? 'retry-open' : 'retry-closed'}
        open={open && retryOpen}
        rows={run?.rows ?? []}
        busy={busy}
        onClose={() => setRetryOpen(false)}
        onRetry={scope => void retry(scope)}
      />
    <Modal
      open={open}
      title="NDR/DDR Bulk Claim"
      description="Upload AJIO's return report or the template — Return AWB, SKU and POB ID. Claims are filed straight from the sheet on this machine, one AJIO sign-in per account."
      // While a job runs, closing the window only hides it — the run is not the
      // window's, and the corner panel can bring it back.
      onClose={running ? onMinimise : onClose}
      busy={busy}
      headerActions={
        <>
          <Switch
            compact
            label="Selected Proceed"
            checked={selectedProceed}
            disabled={running || busy}
            onChange={setSelectedProceed}
          />
          {running && (
            <IconButton
              size="small"
              onClick={onMinimise}
              aria-label="Minimise"
              title="Minimise — the job carries on in the corner"
            >
              <i className="tabler-minimize text-lg" />
            </IconButton>
          )}
        </>
      }
      footer={
        <>
          <Button
            size="sm"
            variant="ghost"
            icon={<i className="tabler-download text-base" />}
            onClick={() => void template()}>
            Download template
          </Button>
          <div className="flex-1" />
          {/* Beside Cancel rather than in the upload rows: it is a step BEFORE
              either upload, and it belongs to the sheet rather than to NDR or
              DDR. */}
          <Button
            size="sm"
            variant="secondary"
            loading={filling}
            disabled={filling || busy || running}
            icon={<i className="tabler-map-pin text-base" />}
            onClick={() => void fillPob()}
          >
            {filling ? 'Filling POB ID…' : 'Fill POB ID'}
          </Button>
          {running ? (
            <Button
              size="sm"
              variant="secondary"
              icon={<i className="tabler-minimize text-base" />}
              onClick={onMinimise}
            >
              Run in the background
            </Button>
          ) : (
            <Button size="sm" variant="secondary" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
          )}
          {/* Selected Proceed changes what this button MEANS, so it changes its
              name: "Select" opens the review, and filing happens from the
              review's own Submit. A "Submit" that only opens a table would
              promise something it does not do. */}
          {selectedProceed ? (
            <Button
              size="sm"
              loading={busy}
              icon={<i className="tabler-list-check text-base" />}
              disabled={chosen.length === 0 || running}
              onClick={() => void review()}
            >
              {running ? 'Running…' : 'Select'}
            </Button>
          ) : (
            <Button
              size="sm"
              loading={busy}
              disabled={chosen.length === 0 || running}
              onClick={() => void submit()}
            >
              {running ? 'Running…' : `Submit${chosen.length ? ` (${chosen.length})` : ''}`}
            </Button>
          )}
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {ROWS.map(row => {
          const upload = uploads[row.type]

          return (
            <Paper
              key={row.type}
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
                  {row.title}
                </Typography>
                <Typography variant="caption" color="text.secondary" className="mt-0.5 block">
                  {row.blurb}
                </Typography>

                {upload && (
                  <Typography
                    variant="caption"
                    color="success.main"
                    className="mbs-2 block truncate font-medium"
                  >
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
                  onClick={() => void pick(row.type)}
                >
                  {upload ? 'Replace' : 'Upload'}
                </Button>

                {upload && (
                  <IconButton
                    size="small"
                    aria-label={`Remove the ${row.type} file`}
                    disabled={running}
                    onClick={() =>
                      setUploads(current => {
                        const next = { ...current }

                        delete next[row.type]

                        return next
                      })
                    }
                  >
                    <i className="tabler-x text-lg" />
                  </IconButton>
                )}
              </div>
            </Paper>
          )
        })}

        {run && (
          <Card variant="outlined" className="flex flex-col gap-3 p-3">
            <div className="flex items-baseline justify-between gap-3">
              <Typography variant="body2" color="text.primary" className="font-medium">
                {run.status === 'done'
                  ? attempts > 1
                    ? `Finished — combined result of ${attempts} attempts`
                    : 'Finished'
                  : run.status === 'failed'
                    ? 'Stopped'
                    : attempts > 1
                      ? `Retrying ${run.retrying ?? 0} — ${run.done} of ${run.claimable} done`
                      : `Filing ${run.done} of ${run.claimable}`}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {run.accounts.join(', ')}
              </Typography>
            </div>

            <Typography variant="caption" color="text.disabled" className="-mbs-2 block">
              Job ID <span className="select-all font-mono text-textSecondary">{run.id}</span>
              {/* `=== false`, not falsy: a run saved before this field existed has
                  none, and "not recorded" would blame TrackVid for a run that
                  predates job records altogether. */}
              {run.jobRecorded === false && ' · not recorded in TrackVid'}
            </Typography>

            <LinearProgress
              variant="determinate"
              value={run.status === 'done' ? 100 : progress}
            />

            <div className="flex flex-wrap gap-x-4 gap-y-1">
              <Typography variant="caption" color="success.main" className="inline-flex items-center gap-1">
                <i className="tabler-circle-check text-base" />
                {run.summary.success} filed
              </Typography>
              {run.summary.failed > 0 && (
                <Typography variant="caption" color="error.main" className="inline-flex items-center gap-1">
                  <i className="tabler-circle-x text-base" />
                  {run.summary.failed} failed
                </Typography>
              )}
              {run.summary.notClaimable > 0 && (
                <Typography variant="caption" color="text.secondary" className="inline-flex items-center gap-1">
                  <i className="tabler-ban text-base" />
                  {run.summary.notClaimable} not claimable
                </Typography>
              )}
              {run.summary.dryRun > 0 && (
                <Typography variant="caption" color="warning.main" className="inline-flex items-center gap-1">
                  <i className="tabler-flask text-base" />
                  {run.summary.dryRun} held (submit disabled)
                </Typography>
              )}
            </div>

            <Divider />

            {/* Why rows will NOT be claimed. Shown before anything runs, because
                this is the moment an operator can still fix the file. */}
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {BUCKET_LABELS.filter(([key]) => run.buckets[key] > 0).map(([key, label]) => (
                <Typography key={key} variant="caption" color="text.secondary">
                  {label}: <span className="font-medium text-textPrimary">{run.buckets[key]}</span>
                </Typography>
              ))}
            </div>

            {run.error && <Alert severity="error">{run.error}</Alert>}

            {(retryable > 0 || run.reportPath) && (
              <div className="flex flex-wrap gap-2">
                {retryable > 0 && (
                  <Button
                    size="sm"
                    loading={busy}
                    disabled={busy}
                    icon={<i className="tabler-refresh text-base" />}
                    title="Files failed and/or skipped rows again into this same job — the result above stays one combined report"
                    onClick={() => setRetryOpen(true)}
                  >
                    Retry ({retryable})
                  </Button>
                )}
                {run.reportPath && (
                  <Button
                    size="sm"
                    variant="secondary"
                    icon={<i className="tabler-folder-open text-base" />}
                    onClick={() => void openBulkReport()}
                  >
                    Show report
                  </Button>
                )}
              </div>
            )}
          </Card>
        )}

        {/* Always offered, run or no run: history is TrackVid's, not this window's. */}
        <Button
          size="sm"
          variant="ghost"
          icon={<i className="tabler-history text-base" />}
          className="self-start"
          onClick={() => onOpenJobs?.()}
        >
          History
        </Button>
      </div>
    </Modal>
    </>
  )
}
