// React Imports
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { SCHEDULED_TASK_IDS, scheduledTaskInfo } from '@shared/constants/automationSchedule'

// MUI Imports
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Card from '@mui/material/Card'
import CircularProgress from '@mui/material/CircularProgress'
import Divider from '@mui/material/Divider'
import Typography from '@mui/material/Typography'

// Third-party Imports
import classnames from 'classnames'
import { createColumnHelper, flexRender, getCoreRowModel, useReactTable } from '@tanstack/react-table'
import type { ColumnDef } from '@tanstack/react-table'

// Shared Imports
import type { JobDetail, JobKind, JobRow } from '@shared/types/jobs'
import { JOB_LABEL, JOB_NOTE_LABEL, hasJobReport } from '@shared/constants/jobs'

// Component Imports
import CustomChip from '@core/components/mui/Chip'
import { EmptyState, LoadingState } from '@renderer/components/data/StateBlocks'
import { FilterTab } from '@renderer/components/ui/FilterTab'
import { Button } from '@renderer/components/ui/Button'

// Service Imports
import { clearJobs, downloadJobReport, jobDetail, listJobs } from '@renderer/services/jobs.service'
import { bulkRunStatus, retryFailedBulkRun } from '@renderer/services/bulkSpf.service'
import { RetryScopeModal } from '@renderer/pages/claims/RetryScopeModal'
import { isRetryableRow, type BulkRetryScope } from '@shared/utils/bulkRetry'
import type { BulkSpfRun } from '@shared/types/bulkSpf'
import { registerPageRefresh } from '@renderer/services/refreshRegistry'
import { onReClaimProgress } from '@renderer/services/reClaim.service'
import { ConfirmDialog } from '@renderer/components/ui/ConfirmDialog'
import { useToast } from '@renderer/hooks/useToast'

// Type Imports
import type { ThemeColor } from '@core/types'

// Style Imports
import tableStyles from '@core/styles/table.module.css'

/**
 * Jobs — every batch run this machine has done.
 *
 * A job is work an operator STARTED and came back to: the AJIO NDR/DDR bulk
 * claim and the Myntra re-claim. Both take minutes to hours, both run in the
 * background, and both end in the same two questions — what went through, and
 * what did not and why.
 *
 * WHY A PAGE AND NOT A MODAL. The bulk claim's history was a modal opened from
 * the Claims page, which made it reachable only from the screen that starts one,
 * and only for AJIO. A re-claim run has no record anywhere else at all —
 * TrackVid never hears about it — so "what did we dispute last week" needs an
 * address. The modal's button now brings the operator here.
 *
 * READ FROM THIS MACHINE. A job run on another operator's machine is not here,
 * and cannot be: the ticket ids and the marketplace's refusals were only ever
 * written locally. A row says so rather than showing an empty list as though
 * nothing succeeded.
 *
 * MIGRATED to the ported design system. Every call, every piece of state and
 * every string is unchanged; the table is now TanStack with TrackVid-Monitor's
 * own table styles, so its density, its head and its rules match the rest of
 * the product. The page-level title is gone — the shell's navbar says where you
 * are, and the screen was showing it twice.
 *
 * ONE ROW OPEN AT A TIME, which is deliberate and predates the migration: a job
 * detail is two scrolling lists, and two of them open at once turns the page
 * into a wall. TanStack's own expansion model allows many, so the single `open`
 * id is kept rather than adopted away.
 */

const STATUS_COLOR: Record<JobRow['status'], ThemeColor> = {
  running: 'secondary',
  done: 'success',
  stopped: 'warning',
  failed: 'error'
}

const STATUS_LABEL: Record<JobRow['status'], string> = {
  running: 'Running',
  done: 'Finished',
  stopped: 'Stopped',
  failed: 'Failed'
}

/**
 * Every kind, plus the "all" pseudo-filter.
 *
 * Derived from JOB_LABEL rather than listed here. The hand-written list this
 * replaces had fallen a kind behind — master backup jobs were in the table with
 * no chip to find them by, and nothing caught it, because an array cannot be
 * exhaustive over a union. Built from the registry, a new kind arrives with its
 * chip already on.
 */
/**
 * The four automations, for the second row under "Scheduled".
 *
 * From the same registry the Settings card draws, in the order they run — so
 * the list here cannot disagree with the schedule about what exists or what it
 * is called, which is exactly how the old hand-written filter list fell a kind
 * behind.
 */
const SCHEDULED_FILTERS: { value: string; label: string }[] = [
  { value: 'all', label: 'All scheduled' },
  ...SCHEDULED_TASK_IDS.map(id => ({
    value: scheduledTaskInfo(id).label,
    label: scheduledTaskInfo(id).label
  }))
]

const FILTERS: { value: JobKind | 'all'; label: string }[] = [
  { value: 'all', label: 'All' },
  ...(Object.keys(JOB_LABEL) as JobKind[]).map(kind => ({ value: kind, label: JOB_LABEL[kind] }))
]

const dash = (value: string | null | undefined): string =>
  value && value.trim().length > 0 ? value : '—'

/** Local time, because a job is something the operator remembers doing. */
const stamp = (iso: string | null): string => {
  if (!iso) return '—'

  const date = new Date(iso)

  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString()
}

/** How long it ran, in the roughest unit that is still true. */
const took = (job: JobRow): string => {
  if (!job.finishedAt) return job.status === 'running' ? 'running' : '—'

  const ms = Date.parse(job.finishedAt) - Date.parse(job.startedAt)

  if (!Number.isFinite(ms) || ms < 0) return '—'
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`

  return `${(ms / 3_600_000).toFixed(1)}h`
}

/** A nested list inside an opened job. Small, dense, and its own scroll box. */
const DetailTable = ({
  title,
  count,
  empty,
  head,
  children
}: {
  title: string
  count: number
  empty: string
  head: React.ReactNode
  children: React.ReactNode
}) => (
  <section className='flex flex-col gap-1.5'>
    <Typography variant='body2' className='font-medium'>
      {title}{' '}
      <Typography component='span' variant='body2' color='text.secondary'>
        ({count})
      </Typography>
    </Typography>

    {count === 0 ? (
      <Typography variant='body2' color='text.secondary'>
        {empty}
      </Typography>
    ) : (
      /* Its own scroll box, capped: a run with three hundred refusals must not
         push the job under it off the screen. */
      <Box
        className='overflow-auto rounded'
        sx={{ maxBlockSize: 256, border: 1, borderColor: 'divider' }}
      >
        <table className={tableStyles.table}>
          <thead>
            <tr>{head}</tr>
          </thead>
          <tbody>{children}</tbody>
        </table>
      </Box>
    )}
  </section>
)

/** One job's two lists, loaded when the row is opened. */
const JobRowDetail = ({ job }: { job: JobRow }) => {
  const toast = useToast()
  const [detail, setDetail] = useState<JobDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  /*
   * RETRY, FOR AN NDR/DDR BULK CLAIM — the same as the bulk claim window's:
   * pick Failed, Skipped or Both, and they are filed again INTO THIS JOB.
   *
   * Only the most recent run can be retried: a retry re-reads the uploaded
   * sheets, and that run is the one this machine keeps them for. An older job
   * shows the button disabled, saying why, rather than not at all.
   */
  const isBulk = job.kind === 'ajio-bulk-claim'
  const [bulkRun, setBulkRun] = useState<BulkSpfRun | null>(null)
  const [retryOpen, setRetryOpen] = useState(false)
  const [retrying, setRetrying] = useState(false)

  useEffect(() => {
    if (!isBulk) return

    let cancelled = false

    void bulkRunStatus().then(response => {
      if (!cancelled && response.success) setBulkRun(response.data)
    })

    return () => {
      cancelled = true
    }
  }, [isBulk, job.jobId])

  const latest = bulkRun !== null && bulkRun.id === job.jobId
  const runRunning = bulkRun?.status === 'running' || bulkRun?.status === 'preparing'
  const retryable = latest && !runRunning ? bulkRun.rows.filter(row => isRetryableRow(row)).length : 0

  const retry = async (scope: BulkRetryScope): Promise<void> => {
    setRetrying(true)

    const response = await retryFailedBulkRun(scope, job.jobId)

    setRetrying(false)

    if (!response.success) {
      toast.error(response.error.message)

      return
    }

    setRetryOpen(false)
    setBulkRun(response.data)
    toast.success(
      `Retrying ${response.data.retrying ?? 0} claim${response.data.retrying === 1 ? '' : 's'} — progress is in the NDR/DDR Bulk Claim window`
    )
  }

  const save = async (): Promise<void> => {
    setSaving(true)

    const response = await downloadJobReport(job.jobId, job.kind)

    setSaving(false)

    if (response.success) {
      toast.success(
        `Report saved — ${response.data.succeeded} successful, ${response.data.failed} failed`
      )
    } else if (response.error.message !== 'Cancelled') {
      // Closing the save dialog is not a failure worth a toast.
      toast.error(response.error.message)
    }
  }

  useEffect(() => {
    let cancelled = false

    void jobDetail(job.jobId, job.kind).then(response => {
      if (cancelled) return

      if (response.success) setDetail(response.data)
      else setError(response.error.message)
    })

    return () => {
      cancelled = true
    }
    // The job id is the identity; a status tick on a running job should not
    // re-fetch the whole list of tickets underneath the operator's cursor.
  }, [job.jobId, job.kind, toast])

  if (error) {
    return (
      <Box className='plb-4 pli-6'>
        <Alert severity='error' icon={<i className='tabler-alert-circle' />}>
          {error}
        </Alert>
      </Box>
    )
  }

  if (!detail) {
    return (
      <Box role='status' className='flex items-center gap-3 plb-4 pli-6'>
        <CircularProgress size={16} />
        <Typography variant='body2' color='text.secondary'>
          Loading…
        </Typography>
      </Box>
    )
  }

  const showFailed = !detail.summary || detail.failedRows.length > 0
  const anyTicket = detail.succeededRows.some(row => row.ticketId)
  const anyNote = detail.succeededRows.some(row => row.note)
  // A bulk claim counts which filing produced each row — 1, +1 per Retry.
  const anyAttempt =
    detail.succeededRows.some(row => typeof row.attempt === 'number') || detail.failedRows.some(row => typeof row.attempt === 'number')

  return (
    <Box className='flex flex-col gap-4 plb-4 pli-6'>
      {/* THE OTHER HALF OF THE CLAMP. The row shows this line cut to one line
          with an ellipsis, because it is a sentence in a table column; here it
          is shown whole, wrapped, which is what the operator opened the row
          for. `break-words` because the sentence carries email addresses and
          file names that have no spaces to break at. */}
      {job.detail && (
        <Typography variant='body2' color='text.secondary' className='break-words'>
          {job.detail}
        </Typography>
      )}

      {/* Above the lists, not below them: a job with three hundred refusals
          scrolls, and the button that gets them out of here should not be the
          thing you have to scroll to. Absent for a job with nothing to export —
          a backup's rows went into the backup. */}
      {(hasJobReport(detail.kind) || isBulk) && (
        <div className='flex justify-end gap-2'>
          {isBulk && (
            <Button
              size='sm'
              icon={<i className='tabler-refresh' />}
              loading={retrying}
              disabled={retryable === 0 || retrying}
              title={
                !latest
                  ? 'Only the most recent bulk claim can be retried'
                  : runRunning
                    ? 'This bulk claim is still running'
                    : retryable === 0
                      ? 'Every claim in this run was filed — nothing to retry'
                      : 'File the failed and/or skipped claims again, into this job'
              }
              onClick={() => setRetryOpen(true)}
            >
              {retryable > 0 ? `Retry (${retryable})` : 'Retry'}
            </Button>
          )}
          {hasJobReport(detail.kind) && (
            <Button
            variant='secondary'
            size='sm'
            icon={<i className='tabler-download' />}
            loading={saving}
            onClick={() => void save()}
          >
            Download report
          </Button>
          )}
        </div>
      )}

      {isBulk && (
        <RetryScopeModal
          key={retryOpen ? 'retry-open' : 'retry-closed'}
          open={retryOpen}
          rows={latest ? bulkRun.rows : []}
          busy={retrying}
          onClose={() => setRetryOpen(false)}
          onRetry={scope => void retry(scope)}
        />
      )}

      {/* What the run was, for a job whose outcome is not a list of rows. */}
      {detail.summary && detail.summary.length > 0 && (
        <Box
          className='grid gap-x-6 gap-y-2 rounded plb-3 pli-4 sm:grid-cols-2 lg:grid-cols-3'
          sx={{ backgroundColor: 'action.hover' }}
        >
          {detail.summary.map(line => (
            <div key={line.label} className='flex items-baseline justify-between gap-3'>
              <Typography variant='body2' color='text.secondary'>
                {line.label}
              </Typography>
              <Typography variant='body2' className='font-medium tabular-nums'>
                {line.value}
              </Typography>
            </div>
          ))}
        </Box>
      )}

      {detail.error && (
        <Alert severity='error' icon={<i className='tabler-alert-circle' />}>
          {detail.error}
        </Alert>
      )}

      {detail.partial && !detail.error && (
        <Typography variant='body2' color='text.secondary'>
          This job did not run to the end, so the lists below are what it reached — not everything
          it was given.
        </Typography>
      )}

      <div className={classnames('grid gap-4', showFailed && 'lg:grid-cols-2')}>
        {/* Succeeded first: it is the answer to "did it work", and on a good
            run the failures list is empty. */}
        <DetailTable
          title='Successful'
          count={detail.succeededRows.length}
          empty='Nothing went through on this run.'
          head={
            <>
              <th>{detail.refLabel}</th>
              {/* A bulk claim produces a ticket number; a re-claim reopens the
                  ticket it was given, so there is no second id. */}
              {anyTicket && <th>Ticket</th>}
              {/* From the registry, not a ladder of kind checks: the ladder's
                  fallback was "SKU", so every job type added after it silently
                  got a column headed SKU over data that was nothing of the
                  sort. */}
              {anyNote && <th>{JOB_NOTE_LABEL[detail.kind]}</th>}
              {anyAttempt && <th>Attempt</th>}
            </>
          }
        >
          {detail.succeededRows.map(row => (
            <tr key={`${row.ref}-${row.ticketId ?? ''}`}>
              <td className='font-mono'>{row.ref}</td>
              {anyTicket && <td className='font-mono'>{dash(row.ticketId)}</td>}
              {anyNote && (
                <td>
                  <Typography variant='body2' color='text.secondary'>
                    {dash(row.note)}
                  </Typography>
                </td>
              )}
              {anyAttempt && <td className='tabular-nums'>{row.attempt ?? 1}</td>}
            </tr>
          ))}
        </DetailTable>

        {showFailed && (
          <DetailTable
            title='Failed'
            count={detail.failedRows.length}
            empty='Nothing failed.'
            head={
              <>
                <th>{detail.refLabel}</th>
                <th>Reason</th>
                {anyAttempt && <th>Attempt</th>}
              </>
            }
          >
            {detail.failedRows.map(row => (
              <tr key={`${row.ref}-${row.reason}`}>
                <td className='font-mono'>{row.ref}</td>
                {/* The marketplace's own words, WRAPPED rather than truncated:
                    a refusal reason is the whole reason the operator opened
                    this job, and Monitor's table is `white-space: nowrap`. */}
                <td style={{ whiteSpace: 'normal' }}>
                  {row.result && row.result !== 'Refused' && (
                    <Typography component='span' variant='body2' className='font-medium mie-1'>
                      {row.result}:
                    </Typography>
                  )}
                  <Typography component='span' variant='body2' color='text.secondary'>
                    {row.reason}
                  </Typography>
                </td>
                {anyAttempt && <td className='tabular-nums'>{row.attempt ?? 1}</td>}
              </tr>
            ))}
          </DetailTable>
        )}
      </div>
    </Box>
  )
}

const columnHelper = createColumnHelper<JobRow>()

export const JobsPage = () => {
  const toast = useToast()
  const [jobs, setJobs] = useState<JobRow[] | null>(null)
  const [filter, setFilter] = useState<JobKind | 'all'>('all')
  /**
   * Which scheduled task, when the Scheduled filter is on.
   *
   * A SECOND ROW rather than four more top-level chips: they are one kind of
   * job — the schedule's — and promoting each to the main row would put four
   * automations beside the bulk tools as though they were unrelated things.
   * Nested, the question reads as it is asked: "the scheduled runs… of which?"
   *
   * Matched on the LABEL, which is what the archive stores for a scheduled run
   * ("Session update", "AJIO report sync"). The registry supplies the list, so
   * a fifth automation arrives with its chip already on.
   */
  const [scheduledTask, setScheduledTask] = useState<string>('all')
  const [open, setOpen] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmClear, setConfirmClear] = useState(false)
  const [clearing, setClearing] = useState(false)

  const load = useCallback(async (): Promise<void> => {
    const response = await listJobs()

    if (response.success) setJobs(response.data)
    else toast.error(response.error.message)
  }, [toast])

  useEffect(() => {
    let cancelled = false

    void (async () => {
      const response = await listJobs()

      if (cancelled) return
      if (response.success) setJobs(response.data)
      else toast.error(response.error.message)
    })()

    return () => {
      cancelled = true
    }
    // `load` is the same call with the toast attached; this one is inline so an
    // in-flight read cannot land after the page has gone.
  }, [toast])

  // The app's Refresh control, so this page answers it like every other.
  useEffect(() => registerPageRefresh(load), [load])

  // A run in flight writes its record when it ENDS, so the list would sit stale
  // for however long the run takes. The tick is the cheapest signal that
  // something changed; only the terminal one is worth a re-read.
  useEffect(
    () =>
      onReClaimProgress(progress => {
        if (!progress.running) void load()
      }),
    [load]
  )

  const shown = useMemo(
    () =>
      (jobs ?? []).filter(job => {
        if (filter !== 'all' && job.kind !== filter) return false
        if (filter !== 'scheduled-run' || scheduledTask === 'all') return true

        return job.label === scheduledTask
      }),
    [jobs, filter, scheduledTask]
  )

  const counts = useMemo(() => {
    const byKind = new Map<string, number>()

    for (const job of jobs ?? []) byKind.set(job.kind, (byKind.get(job.kind) ?? 0) + 1)

    return byKind
  }, [jobs])

  const columns = useMemo<ColumnDef<JobRow, string>[]>(
    () =>
      [
        columnHelper.display({
          id: 'expander',
          header: () => null,
          cell: ({ row }) => (
            <i
              aria-hidden='true'
              className={classnames(
                'tabler-chevron-right block text-lg text-textSecondary transition-transform',
                open === row.original.jobId && 'rotate-90'
              )}
            />
          )
        }),
        /*
         * ONE LINE PER ROW, like Manage Claims.
         *
         * The job used to be two lines — the run, and under it the account,
         * the file and the id — which made every row 53px against Claims' 40.
         * The second line is its own column now: still one glance to the
         * right, still clamped to one line with the whole of it on hover, and
         * the rest of it is what expanding the row is for.
         */
        columnHelper.accessor(row => `${row.platform} · ${row.label}`, {
          id: 'job',
          header: 'Job',
          cell: ({ row }) => (
            <span className='font-medium text-textPrimary'>
              {row.original.platform} · {row.original.label}
            </span>
          )
        }),
        columnHelper.accessor(row => row.detail ?? '', {
          id: 'details',
          header: 'Details',
          cell: ({ row }) => {
            const line = `${dash(row.original.detail)} · ${row.original.jobId.slice(0, 8)}`

            /*
             * CAPPED. `detail` is a sentence, not a value — and a column sized
             * to the longest one pushed Started, Took, Status and the counts
             * off to the right. `max-w-xs`, a named step: numeric logical
             * widths are not generated in this build, so a `max-is-80` was
             * never emitted.
             */
            return (
              <span className='block max-w-xs truncate' title={line}>
                {line}
              </span>
            )
          }
        }),
        columnHelper.accessor(row => stamp(row.startedAt), {
          id: 'started',
          header: 'Started',
          cell: info => <span className='tabular-nums'>{info.getValue()}</span>
        }),
        columnHelper.accessor(row => took(row), {
          id: 'took',
          header: 'Took',
          cell: info => <span className='tabular-nums'>{info.getValue()}</span>
        }),
        columnHelper.accessor(row => row.status, {
          id: 'status',
          header: 'Status',
          cell: ({ row }) => (
            <CustomChip
              round='true'
              size='small'
              variant='tonal'
              label={STATUS_LABEL[row.original.status]}
              color={STATUS_COLOR[row.original.status]}
            />
          )
        }),
        columnHelper.accessor(row => String(row.succeeded), {
          id: 'succeeded',
          header: () => <div className='text-right'>Successful</div>,
          cell: info => <div className='text-right tabular-nums'>{info.getValue()}</div>
        }),
        columnHelper.accessor(row => String(row.failed), {
          id: 'failed',
          header: () => <div className='text-right'>Failed</div>,
          cell: ({ row }) => (
            <div
              className={classnames(
                'text-right tabular-nums',
                row.original.failed > 0 ? 'font-medium text-error' : 'text-textDisabled'
              )}
            >
              {row.original.failed}
            </div>
          )
        }),
        columnHelper.accessor(row => String(row.total), {
          id: 'total',
          header: () => <div className='text-right'>Total</div>,
          cell: info => <div className='text-right tabular-nums'>{info.getValue()}</div>
        })
      ] as ColumnDef<JobRow, string>[],
    [open]
  )

  const table = useReactTable({
    data: shown,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getRowId: row => row.jobId
  })

  const refresh = (): void => {
    setBusy(true)
    void load().finally(() => setBusy(false))
  }

  /** What the button and the confirmation call the thing being removed. */
  const clearLabel =
    FILTERS.find(entry => entry.value === filter)?.label.toLowerCase() ?? 'this history'

  /**
   * Clears the kind the page is filtered to, then re-reads.
   *
   * THE RE-READ IS NOT COSMETIC. A bulk run this company did on another machine
   * comes from TrackVid, not from this archive, so it is still there afterwards
   * — the list has to come back from the source rather than be emptied locally,
   * or the page would claim a deletion it did not make.
   */
  const clearHistory = (): void => {
    setClearing(true)
    void clearJobs(filter)
      .then(result => {
        if (!result.success) {
          toast.error(result.error.message)

          return
        }

        toast.success(
          result.data.cleared === 0
            ? 'There was nothing to clear'
            : `Cleared ${result.data.cleared} record${result.data.cleared === 1 ? '' : 's'}`
        )

        return load()
      })
      .finally(() => {
        setClearing(false)
        setConfirmClear(false)
      })
  }

  return (
    /* The same frame as Manage Claims: one filter card, then the table card,
       with the same 16px rhythm between them. `trackvid-table-fill` makes this
       column exactly as tall as the content area and gives every pixel the
       controls above do not use to the table — see styles/behaviour.css. */
    <div className='ts-layout-content-height-fixed trackvid-table-fill flex flex-col gap-4'>
      {/* shrink-0: the column is exactly the window's height, and a flex item
          shrinks by default — so expanding a row squeezed this card and cut
          its tab row in half. It keeps its size; the table takes the rest. */}
      <ConfirmDialog
        open={confirmClear}
        destructive
        busy={clearing}
        title={filter === 'all' ? 'Clear every job history?' : `Clear the ${clearLabel} history?`}
        message={
          filter === 'all'
            ? 'Every run this machine has recorded is removed — bulk claims, refills, backups and ' +
              'scheduled runs. Runs recorded by TrackVid for other machines are not affected. This cannot be undone.'
            : `The ${shown.length} ${clearLabel} run${shown.length === 1 ? '' : 's'} recorded on this ` +
              'machine are removed. Every other kind is left alone. This cannot be undone.'
        }
        confirmLabel='Clear'
        onConfirm={clearHistory}
        onCancel={() => setConfirmClear(false)}
      />

      <Card className='flex shrink-0 flex-col gap-3 p-3'>
        <div className='flex flex-wrap items-center justify-between gap-2'>
          <Typography variant='body2' color='text.secondary'>
            Every bulk run this machine has done, newest first.
          </Typography>
          <div className='flex items-center gap-2'>
            {/* CLEARS WHAT IS ON SCREEN, which is what the filter above says.
                A single "clear everything" would make an operator destroy the
                record of runs they still need in order to be rid of the noise
                from one — so the button names the kind it is about to remove,
                and only offers "all" when All is the filter. */}
            <Button
              size='sm'
              variant='secondary'
              icon={<i className='tabler-trash' />}
              disabled={busy || clearing || shown.length === 0}
              onClick={() => setConfirmClear(true)}
            >
              {filter === 'all' ? 'Clear history' : `Clear ${clearLabel}`}
            </Button>
            <Button
              size='sm'
              variant='secondary'
              icon={<i className='tabler-refresh' />}
              loading={busy}
              onClick={refresh}
            >
              Refresh
            </Button>
          </div>
        </div>

        <Divider />

        <div className='flex flex-wrap items-center gap-1.5'>
          {FILTERS.map(({ value, label }) => (
            <FilterTab
              key={value}
              label={label}
              count={value === 'all' ? (jobs?.length ?? 0) : (counts.get(value) ?? 0)}
              active={filter === value}
              onClick={() => setFilter(value)}
            />
          ))}
        </div>

        {/* Only under its own filter: a row of task chips over the bulk jobs
            would be filtering by something none of them have. */}
        {filter === 'scheduled-run' && (
          <>
            <Divider />
            <div className='flex flex-wrap items-center gap-1.5'>
              {SCHEDULED_FILTERS.map(({ value, label }) => (
                <FilterTab
                  key={value}
                  label={label}
                  count={
                    value === 'all'
                      ? (counts.get('scheduled-run') ?? 0)
                      : (jobs ?? []).filter(job => job.kind === 'scheduled-run' && job.label === value)
                          .length
                  }
                  active={scheduledTask === value}
                  onClick={() => setScheduledTask(value)}
                />
              ))}
            </div>
          </>
        )}
      </Card>

      <Card className='trackvid-table-scroll'>
        <div>
          <table className={tableStyles.table}>
            <thead>
              {table.getHeaderGroups().map(headerGroup => (
                <tr key={headerGroup.id}>
                  {headerGroup.headers.map(header => (
                    <th key={header.id} className={header.column.id === 'expander' ? 'w-12' : undefined}>
                      {header.isPlaceholder
                        ? null
                        : flexRender(header.column.columnDef.header, header.getContext())}
                    </th>
                  ))}
                </tr>
              ))}
            </thead>
            <tbody>
              {table.getRowModel().rows.map(row => {
                const expanded = open === row.original.jobId

                return (
                  <Fragment key={row.id}>
                    <tr
                      tabIndex={0}
                      aria-expanded={expanded}
                      className={classnames(
                        'cursor-pointer',
                        expanded ? 'bg-actionSelected' : 'hover:bg-actionHover'
                      )}
                      onClick={() => setOpen(expanded ? null : row.original.jobId)}
                      onKeyDown={event => {
                        // The row already expands on click; this only gives the
                        // same action a keyboard reach.
                        if (event.key !== 'Enter' && event.key !== ' ') return
                        event.preventDefault()
                        setOpen(expanded ? null : row.original.jobId)
                      }}
                    >
                      {row.getVisibleCells().map(cell => (
                        <td key={cell.id}>
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </td>
                      ))}
                    </tr>

                    {expanded && (
                      <tr>
                        <td colSpan={row.getVisibleCells().length} className='p-0'>
                          <Divider />
                          <Box sx={{ backgroundColor: 'action.hover' }}>
                            <JobRowDetail job={row.original} />
                          </Box>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>

        {jobs !== null && shown.length === 0 && (
          <EmptyState
            icon={<i className='tabler-history text-3xl' />}
            title={jobs.length === 0 ? 'Nothing has run here yet' : 'No job of that kind'}
            message={
              jobs.length === 0
                ? 'Every bulk run started on this machine is kept here — the claims, the master imports, the backups. Start one and it will appear.'
                : 'This machine has run jobs, just none matching that filter. Clear it to see the rest.'
            }
          />
        )}

        {jobs === null && <LoadingState label='Reading this machine’s runs…' />}
      </Card>
    </div>
  )
}
