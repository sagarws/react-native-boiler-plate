import { useEffect, useMemo, useRef, useState } from 'react'
import ButtonBase from '@mui/material/ButtonBase'
import Divider from '@mui/material/Divider'
import IconButton from '@mui/material/IconButton'
import LinearProgress from '@mui/material/LinearProgress'
import Paper from '@mui/material/Paper'
import Typography from '@mui/material/Typography'
import classnames from 'classnames'
import type { QueuedClaim } from '@shared/types/claimQueue'
import type { BulkSpfRun } from '@shared/types/bulkSpf'
import {
  listClaims,
  onClaimBatchProgress,
  onClaimStatusChanged
} from '@renderer/services/claimQueue.service'
import { bulkRunStatus, onBulkProgress } from '@renderer/services/bulkSpf.service'
import { onSkuSweepProgress, skuSweepStatus } from '@renderer/services/skuLookup.service'
import { onReClaimProgress, reClaimProgress } from '@renderer/services/reClaim.service'
import type { ReClaimProgress } from '@shared/types/reClaim'
import type { SkuSweepProgress } from '@shared/types/skuLookup'
import type { ClaimBatchProgress } from '@shared/types/claimQueue'
import { canRestore, requestRestore } from '@renderer/services/restoreRegistry'
import { useToast } from '@renderer/hooks/useToast'
import { Tooltip } from '@renderer/components/ui/Tooltip'
import { platformLabel } from '@shared/utils/platformKey'

/**
 * What this machine is doing right now, wherever the operator happens to be.
 *
 * Every automation here runs detached: Create Ticket returns immediately, a
 * dispatched claim starts on its own, and a bulk run lasts hours. The only
 * evidence any of it was happening lived in a table column the operator had to
 * be looking at, on a page they had to stay on — so "is it still going?" had no
 * answer, and the honest reaction was to press the button again.
 *
 * Three sizes, the same as the admin panel's progress modal:
 *
 *   collapsed  — the header bar alone, for when it is in the way
 *   normal     — one line per job with its progress
 *   maximised  — the tally the run is actually judged on: how many succeeded,
 *                how many failed, and which AWBs those were
 *
 * A FINISHED batch stays until it is dismissed. It used to disappear the moment
 * the last claim landed, which meant the one number anybody wanted — how many
 * of the twenty went through — existed for no time at all.
 *
 * Renders NOTHING when nothing is running and nothing is waiting to be read.
 * A permanent empty panel is furniture.
 */

const isActive = (claim: QueuedClaim): boolean =>
  claim.status === 'running' || claim.status === 'queued' || claim.status === 'received'

interface WorkItem {
  key: string
  title: string
  detail: string
  progress?: { done: number; total: number }
  /** Success / failure so far. Absent for a single dispatched claim, which has neither. */
  tally?: { succeeded: number; failed: number }
  /** The AWBs that failed, with their reason — shown only when maximised. */
  failures?: { awbNumber: string; error: string }[]
  running: boolean
  /** Finished and kept on screen for its totals. Only these can be dismissed. */
  dismiss?: () => void
}

export const BackgroundWork = () => {
  const [claims, setClaims] = useState<QueuedClaim[]>([])
  const [run, setRun] = useState<BulkSpfRun | null>(null)
  const [batch, setBatch] = useState<ClaimBatchProgress | null>(null)
  const [skuRun, setSkuRun] = useState<SkuSweepProgress | null>(null)
  /**
   * The Myntra re-claim run.
   *
   * It belongs here for the reason this panel exists: the run is the main
   * process's, it takes hours, and the window that started it is usually
   * closed. Without this there was nothing on screen saying a run was going.
   */
  const [reClaim, setReClaim] = useState<ReClaimProgress | null>(null)
  const [collapsed, setCollapsed] = useState(false)
  const [maximised, setMaximised] = useState(false)

  useEffect(() => {
    void listClaims().then(response => {
      if (response.success) setClaims(response.data.filter(isActive))
    })
    void bulkRunStatus().then(response => {
      if (response.success) setRun(response.data)
    })
    void skuSweepStatus().then(response => {
      if (response.success) setSkuRun(response.data.progress)
    })
    // Same reason as the others: a run started before this window existed —
    // or before this panel mounted — has to show up without waiting for the
    // next tick, which on a paced run is five seconds away at best.
    void reClaimProgress().then(response => {
      if (response.success) setReClaim(response.data)
    })
  }, [])

  // A slow re-read, purely as a safety net.
  //
  // The pushes below are the real mechanism and are enough when every one of
  // them arrives. This is for when one does not — sent while no window existed,
  // or a listener attached a moment late. Without it a single lost event
  // strands a finished claim on screen until the app is restarted, which is
  // exactly what this panel was doing.
  useEffect(() => {
    const timer = setInterval(() => {
      void listClaims().then(response => {
        if (response.success) setClaims(response.data.filter(isActive))
      })
    }, 15_000)

    return () => clearInterval(timer)
  }, [])

  /**
   * A status change carries the claim it changed, so it is applied directly.
   *
   * This used to answer by re-READING the queue, which raced the write it was
   * reacting to: the broadcast fired from inside the store mutation, before the
   * records were persisted, so the re-read could return the state from BEFORE
   * the change. Nothing fired again, and a finished claim sat on screen as
   * "running" for the rest of the session.
   *
   * The push already carries the answer. Using it removes the race rather than
   * narrowing it.
   */
  useEffect(
    () =>
      onClaimStatusChanged(claim => {
        setClaims(current => {
          const others = current.filter(entry => entry.cmsId !== claim.cmsId)

          return isActive(claim) ? [...others, claim] : others
        })
      }),
    []
  )
  useEffect(() => onBulkProgress(setRun), [])

  // "Your bulk claim finished", wherever the operator is. Here rather than in the
  // bulk window because the window may be minimised, closed, or on a page that
  // has been navigated away from — this panel is the one thing always mounted.
  // A toast also lands in the notification centre, where it stays.
  //
  // Only a run SEEN running announces its end: the first run this panel hears
  // of may be one that finished yesterday, read back from disk on startup.
  const toast = useToast()
  const lastBulk = useRef<{ id: string; status: BulkSpfRun['status'] } | null>(null)

  useEffect(() => {
    if (!run) return

    const previous = lastBulk.current

    lastBulk.current = { id: run.id, status: run.status }

    if (!previous || previous.id !== run.id || previous.status === run.status) return
    if (previous.status !== 'running' && previous.status !== 'preparing') return

    const s = run.summary
    const job = `Job ${run.id.slice(0, 8)}`

    if (run.status === 'failed') {
      toast.error(`NDR/DDR bulk claim stopped — ${job}: ${run.error ?? 'see the report'}`)
    } else if (run.status === 'done') {
      const failed = s.failed + s.notClaimable
      // After a retry the counts are every attempt's combined, not the retry's own.
      const attempts = (run.attempts ?? 1) > 1 ? ` (combined, ${run.attempts} attempts)` : ''
      const line = `NDR/DDR bulk claim finished — ${job}${attempts}: ${s.success} successful, ${failed} failed, ${s.skipped} skipped`

      if (failed > 0) toast.error(line)
      else toast.success(line)
    }
  }, [run, toast])
  // Kept on the final tick like the batch above, and for the same reason: that
  // tick carries how many claims were actually placed, and a run that vanished
  // at 100% would take the only answer with it.
  useEffect(() => onSkuSweepProgress(setSkuRun), [])
  useEffect(() => onReClaimProgress(setReClaim), [])
  useEffect(
    () =>
      onClaimBatchProgress(progress => {
        // KEPT on the final tick, not dropped. That tick carries the totals, and
        // a new batch replaces it the moment one starts.
        //
        // The platform is carried over when a tick arrives without one — the
        // final tick does, and a finished card then lost its "· Myntra".
        setBatch(previous =>
          progress.platform || !previous || previous.running === false
            ? progress
            : { ...progress, platform: previous.platform }
        )
      }),
    []
  )

  const items = useMemo(() => {
    const work: WorkItem[] = []

    if (run && (run.status === 'running' || run.status === 'preparing')) {
      work.push({
        // Static, not per run: it is the key the Claims page registers the bulk
        // window's restorer under, which is what gives this row its maximise button.
        key: 'bulk-spf',
        title: 'NDR/DDR bulk claim · Ajio',
        detail: run.accounts.join(', ') || 'Ajio',
        progress: { done: run.done, total: run.claimable },
        tally: { succeeded: run.summary.success, failed: run.summary.failed },
        running: true
      })
    }


    if (skuRun) {
      work.push({
        key: 'sku-sweep',
        title: `SKU lookup · ${platformLabel(skuRun.platform)}`,
        detail: skuRun.running
          ? skuRun.awbNumber || 'Reading returns…'
          : `Found ${skuRun.resolved} of ${skuRun.total} SKUs — not saved yet`,
        progress: { done: skuRun.done, total: skuRun.total },
        tally: { succeeded: skuRun.resolved, failed: skuRun.failed },
        failures: skuRun.misses.map(miss => ({ awbNumber: miss.awbNumber, error: miss.message })),
        running: skuRun.running,
        ...(skuRun.running ? {} : { dismiss: () => setSkuRun(null) })
      })
    }

    if (reClaim) {
      work.push({
        key: 're-claim',
        title: 'Re-claim · Myntra',
        detail: reClaim.running
          ? reClaim.waitingMs > 0
            ? `Next in ${Math.ceil(reClaim.waitingMs / 1000)}s`
            : reClaim.ticketId || 'Disputing…'
          : `${reClaim.raised} of ${reClaim.total} raised`,
        progress: { done: reClaim.done, total: reClaim.total },
        tally: { succeeded: reClaim.raised, failed: reClaim.refused },
        // Myntra's own words for each refusal. The ticket id stands in for the
        // AWB this panel usually shows — it is what identifies a dispute.
        failures: reClaim.refusals.map(refusal => ({
          awbNumber: refusal.ticketId,
          error: refusal.message
        })),
        running: reClaim.running,
        ...(reClaim.running ? {} : { dismiss: () => setReClaim(null) })
      })
    }

    if (batch) {
      work.push({
        key: 'create-ticket',
        // A noun, not the button's verb: "Create Ticket" read as an
        // instruction sitting on a job that was already doing it.
        title: `Ticket creation${batch.platform ? ` · ${platformLabel(batch.platform)}` : ''}`,
        detail: batch.running
          ? // The claim in flight when there is one; otherwise what the batch is
            // doing instead — checking sessions, or queued behind another
            // automation. Both are minutes of real work before the first claim,
            // and a blank line there reads as nothing having started.
            batch.awbNumber || batch.cmsId || batch.phase || 'Starting…'
          : // A batch that ENDED carrying a phase was refused before it filed
            // anything — the reason is the only useful thing to say, and the
            // tally below would report "All 0 succeeded".
            batch.phase
            ? batch.phase
            : batch.failed === 0
              ? `All ${batch.succeeded} ticket${batch.succeeded === 1 ? '' : 's'} created`
              : `${batch.succeeded} created, ${batch.failed} failed`,
        progress: { done: batch.done, total: batch.total },
        tally: { succeeded: batch.succeeded, failed: batch.failed },
        failures: batch.failures,
        running: batch.running,
        ...(batch.running ? {} : { dismiss: () => setBatch(null) })
      })
    }

    // A batch already names the claim it is on. Listing that claim again from
    // the queue would describe one piece of work twice, which reads as two.
    for (const claim of claims) {
      if (batch?.cmsId === claim.cmsId) continue

      work.push({
        key: `claim:${claim.cmsId}`,
        title: `Claim · ${platformLabel(claim.platform)}`,
        detail: claim.awbNumber ?? 'No AWB',
        running: claim.status === 'running'
      })
    }

    return work
  }, [batch, claims, reClaim, run, skuRun])

  if (items.length === 0) return null

  const runningCount = items.filter(item => item.running).length

  /*
   * One figure for the whole panel: how far through the RUNNING jobs with a
   * known size it is. Shown in the header so a collapsed panel still answers "how
   * far along", which is the question it gets collapsed while waiting on.
   */
  // RUNNING jobs only: a finished run is 100% and would drag the figure up —
  // one live job at 1 of 5 beside a completed sweep read as "76%".
  const measured = items.filter(item => item.running && item.progress && item.progress.total > 0)
  const overallDone = measured.reduce((sum, item) => sum + (item.progress?.done ?? 0), 0)
  const overallTotal = measured.reduce((sum, item) => sum + (item.progress?.total ?? 0), 0)
  const overall = overallTotal > 0 ? Math.round((overallDone / overallTotal) * 100) : null

  /*
   * What the header's count IS. "1 job · 67%" did not say whether the job was
   * running or done, nor what the 67% measured. Running jobs lead; otherwise
   * what is waiting, otherwise what is finished and waiting to be read.
   */
  const queuedCount = items.filter(item => !item.running && !item.dismiss).length
  const summary =
    runningCount > 0
      ? `${runningCount} running${overall !== null ? ` · ${overall}% done` : ''}`
      : queuedCount > 0
        ? `${queuedCount} queued`
        : `${items.length} finished`

  return (
    <Paper
      component='aside'
      aria-label='Background work'
      elevation={0}
      /*
       * A COLUMN THAT CANNOT OUTGROW THE WINDOW.
       *
       * The list had the only height cap, so the panel was however tall its
       * header plus that cap came to — and a maximised run with a dozen failed
       * AWBs came to more than a short window has. `max-h` against the
       * viewport, minus the same 1rem inset it sits on top and bottom, and the
       * list below flexes inside what is left.
       *
       * It FLOATS, so it is one of the three things in this app that casts a
       * shadow (see OVERLAY_SHADOW in the theme) — with the hairline every
       * surface has.
       */
      className={classnames(
        'fixed bottom-4 right-4 z-40 flex max-h-[var(--size-floating-panel)] flex-col overflow-hidden',
        maximised ? 'w-120' : 'w-96'
      )}
      sx={{
        borderRadius: 3,
        border: '1px solid var(--mui-palette-divider)',
        boxShadow: 'var(--trackvid-overlay-shadow)'
      }}
    >
      {/* THE HEADER. The title area collapses the panel, so the whole bar
          stays a click target without swallowing the two buttons beside it. */}
      <div className='flex h-12 shrink-0 items-center gap-1 pl-2 pr-1.5'>
        <ButtonBase
          onClick={() => setCollapsed(current => !current)}
          aria-expanded={!collapsed}
          className='flex h-9 min-w-0 flex-1 items-center justify-start gap-2 rounded-md px-2 text-start hover:bg-actionHover'
        >
          {runningCount > 0 ? (
            /* A spinning icon, not MUI's indeterminate ring: that ring shrinks
               to a dot at points in its cycle, and caught there it reads as a
               stray mark rather than as "working". */
            <i className='tabler-loader-2 shrink-0 animate-spin text-lg text-textSecondary' />
          ) : (
            <i className='tabler-circle-check shrink-0 text-lg text-success-fg' />
          )}
          {/* color set, not inherited: this theme's body2 and caption default
              to the secondary and disabled greys, which left every title in
              the panel grey. */}
          {/* The title never gives way; the summary beside it does. */}
          <Typography variant='body2' color='text.primary' className='shrink-0 whitespace-nowrap font-semibold'>
            Background work
          </Typography>
          <Typography variant='caption' color='text.secondary' className='min-w-0 truncate tabular-nums'>
            {summary}
          </Typography>
        </ButtonBase>

        <Tooltip label={maximised ? 'Show less' : 'Show the tally and failed AWBs'}>
          <IconButton
            size='small'
            aria-label={maximised ? 'Show less' : 'Show more'}
            onClick={() => {
              setMaximised(current => !current)
              // Maximising something that is collapsed would show nothing.
              setCollapsed(false)
            }}
          >
            <i className={classnames(maximised ? 'tabler-arrows-diagonal-minimize-2' : 'tabler-arrows-diagonal', 'text-lg')} />
          </IconButton>
        </Tooltip>

        <Tooltip label={collapsed ? 'Show jobs' : 'Hide jobs'}>
          <IconButton size='small' aria-label={collapsed ? 'Show jobs' : 'Hide jobs'} onClick={() => setCollapsed(current => !current)}>
            <i className={classnames('tabler-chevron-down text-lg transition-transform', collapsed && 'rotate-180')} />
          </IconButton>
        </Tooltip>
      </div>

      {!collapsed && (
        <>
          <Divider />
          <ul
            /*
             * `min-h-0` is the load-bearing half. A flex item's default
             * `min-height: auto` refuses to shrink below its content, so the
             * list would push the panel past `max-h` and be clipped rather than
             * scrolled. The `max-h` stays as the cap for a TALL window, where
             * the panel should not take the whole side of the screen.
             */
            className={classnames(
              'm-0 min-h-0 flex-1 list-none overflow-y-auto p-0',
              maximised ? 'max-h-104' : 'max-h-72'
            )}
          >
            {items.map((item, index) => {
              const percent =
                item.progress && item.progress.total > 0
                  ? Math.round((item.progress.done / item.progress.total) * 100)
                  : null

              return (
                <li key={item.key}>
                  {index > 0 && <Divider />}
                  <div className='flex flex-col gap-2 px-4 py-3'>
                    <div className='flex items-start justify-between gap-2'>
                      <div className='flex min-w-0 flex-col'>
                        <Typography variant='body2' color='text.primary' className='truncate font-medium'>
                          {item.title}
                        </Typography>
                        <Typography variant='caption' color='text.secondary' className='truncate' title={item.detail}>
                          {item.detail}
                        </Typography>
                      </div>

                      <div className='flex shrink-0 items-center gap-0.5'>
                        <Typography variant='caption' color='text.secondary' className='mr-1 tabular-nums'>
                          {item.progress
                            ? `${item.progress.done} of ${item.progress.total}`
                            : item.running
                              ? 'Running'
                              : 'Queued'}
                        </Typography>

                        {/* Back to the job's own window, for the jobs that have
                            one. A minimised bulk SKU sweep ends holding a review
                            nobody has saved, and without this, minimising it
                            was a one-way door. Absent for a queued claim, which
                            has no window to return to. */}
                        {canRestore(item.key) && (
                          <Tooltip label="Reopen this job's window">
                            <IconButton size='small' aria-label='Reopen' onClick={() => requestRestore(item.key)}>
                              <i className='tabler-external-link text-base' />
                            </IconButton>
                          </Tooltip>
                        )}

                        {/* Only a finished batch can be cleared — dismissing a
                            live one would hide work that is still going. */}
                        {item.dismiss && (
                          <Tooltip label='Dismiss'>
                            <IconButton size='small' aria-label='Dismiss' onClick={item.dismiss}>
                              <i className='tabler-x text-base' />
                            </IconButton>
                          </Tooltip>
                        )}
                      </div>
                    </div>

                    {percent !== null && (
                      <LinearProgress
                        variant='determinate'
                        value={percent}
                        color={item.running ? 'primary' : 'success'}
                        aria-label={`${item.title} progress`}
                        // The track is a faint wash, not the ported mid-grey:
                        // the fill is the information, the track only its scale.
                        sx={{ bgcolor: 'action.hover', '&::before': { display: 'none' } }}
                      />
                    )}

                    {/* THE TALLY, as one quiet line rather than three pills:
                        they are counts to read, not buttons to press, and the
                        pills looked like the latter. Coloured icons carry the
                        meaning; the words stay in text colour. */}
                    {item.tally && (
                      <div className='flex flex-wrap items-center gap-x-3 gap-y-1'>
                        <Typography variant='caption' color='text.secondary' className='inline-flex items-center gap-1 tabular-nums'>
                          <i className={classnames('tabler-circle-check text-sm', item.tally.succeeded > 0 ? 'text-success-fg' : 'text-textDisabled')} />
                          {item.tally.succeeded} successful
                        </Typography>
                        <Typography variant='caption' color='text.secondary' className='inline-flex items-center gap-1 tabular-nums'>
                          <i className={classnames('tabler-circle-x text-sm', item.tally.failed > 0 ? 'text-error' : 'text-textDisabled')} />
                          {item.tally.failed} failed
                        </Typography>
                        {item.progress && item.running && (
                          <Typography variant='caption' color='text.secondary' className='inline-flex items-center gap-1 tabular-nums'>
                            <i className='tabler-clock text-sm text-textDisabled' />
                            {Math.max(0, item.progress.total - item.progress.done)} remaining
                          </Typography>
                        )}
                      </div>
                    )}

                    {/* Which ones failed and why — the only part of a finished
                        run that is actionable, so it is what "Show more" is for. */}
                    {maximised && item.failures && item.failures.length > 0 && (
                      <div className='flex flex-col gap-1 rounded-md bg-actionHover p-2'>
                        <Typography variant='caption' color='text.primary' className='font-medium'>
                          Failed AWBs{' '}
                          {/* The count, because the list scrolls: three visible
                              out of twenty reads as three without it. */}
                          <span className='font-normal text-textSecondary tabular-nums'>{item.failures.length}</span>
                        </Typography>

                        {/* Bounded and scrollable in its own right: unbounded,
                            twenty failures pushed every other job out of reach. */}
                        <ul className='m-0 flex max-h-40 list-none flex-col gap-1 overflow-y-auto p-0'>
                          {item.failures.map(failure => (
                            <li key={failure.awbNumber} className='flex flex-col'>
                              {/* Selectable: the point of showing an AWB is to copy it. */}
                              <Typography variant='caption' color='text.primary' className='select-text font-mono'>
                                {failure.awbNumber}
                              </Typography>
                              {/* `break-words`: a marketplace error is one unbroken
                                  string as often as not, and without it the row
                                  pushes the panel sideways. */}
                              <Typography variant='caption' color='text.secondary' className='min-w-0 break-words'>
                                {failure.error}
                              </Typography>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        </>
      )}
    </Paper>
  )
}
