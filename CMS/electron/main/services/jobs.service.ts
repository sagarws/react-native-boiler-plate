import { app, dialog } from 'electron'
import { join } from 'node:path'
import type { BulkJobArchive, BulkJobSummary } from '@shared/types/bulkSpf'
import type { JobDetail, JobRow, JobStatus, JobKind } from '@shared/types/jobs'
import type { AccountMapJobArchive } from '@shared/types/accountMapping'
import type { ReClaimJobArchive } from '@shared/types/reClaim'
import type { RefillJobArchive } from '@shared/types/refill'
import type { BackupJobArchive } from '@shared/types/masterBackup'
import type { SnapdealJobArchive } from '@shared/types/snapdealBackup'
import type { ScheduledRunArchive } from '@shared/types/automationSchedule'
import { REFILL_LABELS } from '@shared/constants/refill'
import { ok, fail, type Result } from '@shared/types/result'
import { loadCore } from '@main/automations/common/coreLoader'
import { readJobArchives, clearBulkJobArchives } from './bulkSpfArchive.store'
import { listBulkJobs } from './bulkSpfJob.service'
import { readReClaimJobs, clearReClaimJobs } from './reClaimArchive.store'
import { readAccountMapJobs, clearAccountMapJobs } from './accountMapArchive.store'
import { readRefillJobs, clearRefillJobs } from './refillArchive.store'
import { readBackupJobs, clearBackupJobs } from './masterBackupArchive.store'
import {
  readSnapdealBackupJobs,
  clearSnapdealBackupJobs
} from './snapdealBackupArchive.store'
import { readScheduledRun, readScheduledRuns, clearScheduledRuns } from './scheduledRunArchive.store'
import { logger } from './logger'

/**
 * Every batch run this machine has done, in one list.
 *
 * ONE PAGE, TWO STORES. Each job type keeps its own archive, because a bulk
 * claim's rows (AWB, SKU, ticket number) and a re-claim's (ticket id, Myntra's
 * refusal) are not the same rows and forcing them into one record would lose
 * something from both. So the shared shape is produced HERE, at the read, and
 * the stores stay faithful to what their job actually did.
 *
 * Adding a third job type is one mapper and one line in `SOURCES`. The page
 * does not change, which is the point — see shared/types/jobs.ts.
 */

/** Outcomes that mean the bulk claim did not file that article. */
const UNFILED_RESULTS = new Set(['Failed', 'Help Center Failed', 'Not Claimable', 'Skipped'])

const bulkRow = (archive: BulkJobArchive): JobRow => ({
  jobId: archive.jobId,
  kind: 'ajio-bulk-claim',
  platform: 'Ajio',
  label: 'NDR/DDR bulk claim',
  status: archive.status,
  startedAt: archive.startedAt,
  finishedAt: archive.finishedAt,
  // The article rows, not the distinct AWBs: it is what the job worked through,
  // and what `succeeded + failed` has to add up against.
  total: archive.claimRows,
  succeeded: archive.summary.success,
  // Help Center Failed is already inside `failed`; Not Claimable is not.
  failed: archive.summary.failed + archive.summary.notClaimable,
  error: archive.error,
  detail: [archive.accounts.join(', '), ...archive.fileNames].filter(Boolean).join(' · ')
})

const bulkDetail = (archive: BulkJobArchive): JobDetail => ({
  ...bulkRow(archive),
  refLabel: 'Return AWB',
  succeededRows: archive.tickets.map(ticket => ({
    ref: ticket.awb,
    ticketId: ticket.ticketId,
    note: ticket.sku || null,
    attempt: ticket.attempt ?? 1
  })),
  failedRows: archive.unfiled
    .filter(row => UNFILED_RESULTS.has(row.result))
    .map(row => ({
      ref: row.awb,
      reason: row.reason || 'No reason was recorded',
      result: row.result,
      sku: row.sku || null,
      attempt: row.attempt ?? 1
    })),
  // The archive holds the tickets THIS machine raised. A job whose rows were
  // pruned, or one that failed before it filed anything, legitimately has none.
  partial: archive.status === 'failed' && archive.tickets.length === 0
})

const reClaimRow = (archive: ReClaimJobArchive): JobRow => ({
  jobId: archive.jobId,
  kind: 'myntra-re-claim',
  platform: 'Myntra',
  label: 'Re-claim',
  status: archive.status,
  startedAt: archive.startedAt,
  finishedAt: archive.finishedAt,
  total: archive.total,
  succeeded: archive.raised,
  failed: archive.refused,
  error: archive.error,
  detail: [archive.username, archive.fileName ?? 'typed in'].filter(Boolean).join(' · ')
})

const reClaimDetail = (archive: ReClaimJobArchive): JobDetail => ({
  ...reClaimRow(archive),
  refLabel: 'Ticket',
  succeededRows: archive.tickets.map(ticket => ({
    ref: ticket.ticketId,
    // The dispute reopens the ticket it was given; there is no second id.
    ticketId: null,
    // What Myntra called it straight after — AWAITING_AGENT_RESPONSE and the
    // like. Null when the read-back failed, which does not undo the dispute.
    note: ticket.status
  })),
  failedRows: archive.failures.map(failure => ({
    ref: failure.ticketId,
    reason: failure.reason || 'No reason was recorded',
    result: 'Refused'
  })),
  // A stopped run genuinely never reached its remaining tickets, and an
  // interrupted one is marked failed with the disputes it did raise still listed.
  partial: archive.status !== 'done'
})

/**
 * A Map Username run.
 *
 * `succeeded` is the rows it WROTE to. A row it found and had nothing to write
 * for is neither a success nor a failure — it is counted in the detail, and
 * kept out of both totals, because inflating "succeeded" with rows nothing
 * happened to is how a job report stops being worth reading.
 */
const accountMapRow = (archive: AccountMapJobArchive): JobRow => ({
  jobId: archive.jobId,
  kind: 'account-map',
  platform: archive.platform.charAt(0).toUpperCase() + archive.platform.slice(1),
  label: 'Map Username',
  status: archive.status,
  startedAt: archive.startedAt,
  finishedAt: archive.finishedAt,
  total: archive.total,
  succeeded: archive.mapped,
  failed: archive.unmapped + archive.failed,
  error: archive.error,
  detail: [
    `${archive.accounts.length} login${archive.accounts.length === 1 ? '' : 's'}`,
    archive.skipped > 0 ? `${archive.skipped} already correct` : '',
    archive.replaced > 0 ? `${archive.replaced} replaced` : '',
    archive.autoMap ? 'auto-mapping on' : 'auto-mapping off'
  ]
    .filter(Boolean)
    .join(' · ')
})

/**
 * What each claim ended up with.
 *
 * The note carries the SUB-ORDER NUMBER as well as the account, because on
 * Meesho that is half the answer: the claim form is searched by it, and a run
 * that fixed an account while leaving a wrong sub-order number has not made the
 * row fileable.
 */
const accountMapDetail = (archive: AccountMapJobArchive): JobDetail => ({
  ...accountMapRow(archive),
  refLabel: 'Return AWB',
  succeededRows: archive.rows
    .filter(row => row.result === 'mapped' || row.result === 'skipped')
    .map(row => ({
      ref: row.awbNumber,
      ticketId: null,
      note: [
        row.username,
        row.subOrderNumber ? `sub-order ${row.subOrderNumber}` : 'no sub-order number',
        row.result === 'skipped' ? 'already correct' : ''
      ]
        .filter(Boolean)
        .join(' · ')
    })),
  failedRows: archive.rows
    .filter(row => row.result === 'unmapped' || row.result === 'failed' || row.result === 'conflict')
    .map(row => ({
      ref: row.awbNumber,
      reason: row.message || 'No reason was recorded',
      result:
        row.result === 'conflict'
          ? 'Disagrees'
          : row.result === 'failed'
            ? 'Failed'
            : 'No account'
    })),
  // Every row it touched is in the record; nothing is written elsewhere.
  partial: false
})

/**
 * A Refill Data run.
 *
 * `succeeded` is the rows something was WRITTEN to. A row that was asked about
 * and already held what the marketplace says is neither a success nor a
 * failure — it is counted in the detail and kept out of both totals, because a
 * job report that inflates its successes stops being worth reading.
 */
const refillRow = (archive: RefillJobArchive): JobRow => ({
  jobId: archive.jobId,
  kind: 'refill-data',
  platform: archive.platform.charAt(0).toUpperCase() + archive.platform.slice(1),
  label: 'Refill Data',
  status: archive.status,
  startedAt: archive.startedAt,
  finishedAt: archive.finishedAt,
  total: archive.total,
  succeeded: archive.filled,
  failed: archive.failed,
  error: archive.error,
  detail: [
    archive.fields.map(field => REFILL_LABELS[field]?.label ?? field).join(' · '),
    archive.untouched > 0 ? `${archive.untouched} unchanged` : '',
    // Runs archived before this was counted separately have no value here, and
    // an older record saying nothing is better than one inventing a zero.
    (archive.notFound ?? 0) > 0 ? `${archive.notFound} not found` : '',
    // Worth stating: nothing was asked, so nothing was verified.
    archive.shortcut ? 'one login — written without asking' : ''
  ]
    .filter(Boolean)
    .join(' · ')
})

const refillDetail = (archive: RefillJobArchive): JobDetail => ({
  ...refillRow(archive),
  refLabel: 'Return AWB',
  succeededRows: archive.rows
    .filter(row => row.outcome === 'filled' || row.outcome === 'nothing-to-do')
    .map(row => ({
      ref: row.awbNumber,
      ticketId: null,
      // What was written, field by field — the answer to "what did this change".
      note: row.message
    })),
  failedRows: archive.rows
    .filter(row => row.outcome === 'failed' || row.outcome === 'not-found')
    .map(row => ({
      ref: row.awbNumber,
      reason: row.message || 'No reason was recorded',
      result: row.outcome === 'failed' ? 'Failed' : 'Not found'
    })),
  partial: false
})

/**
 * An AJIO master-data backup.
 *
 * `total` is the rows AJIO handed over, and `succeeded` the ones that were new:
 * on a re-sync those are meant to diverge, and a run that saved nothing because
 * everything was already held is a success, not a wasted night. `failed` counts
 * PAGES — the only thing that can fail here — which is why the detail says so
 * in words rather than leaving a bare number to be read as rows.
 */
const REPORT_NAMES: Record<BackupJobArchive['report'], string> = {
  forward: 'Forward Report',
  return: 'Return Report'
}

const BACKUP_KIND_NAMES: Record<BackupJobArchive['kind'], string> = {
  months: 'Backup',
  range: 'Range sync',
  daily: 'Daily re-sync'
}

const backupRow = (archive: BackupJobArchive): JobRow => ({
  jobId: archive.jobId,
  kind: 'ajio-master-backup',
  platform: 'Ajio',
  label: `Master data ${BACKUP_KIND_NAMES[archive.kind].toLowerCase()}`,
  status: archive.status,
  startedAt: archive.startedAt,
  finishedAt: archive.finishedAt,
  total: archive.added + archive.skipped,
  succeeded: archive.added,
  failed: archive.failed,
  error: archive.error,
  detail: [
    REPORT_NAMES[archive.report],
    `${archive.from} → ${archive.to}`,
    archive.skipped > 0 ? `${archive.skipped.toLocaleString()} already held` : '',
    archive.failed > 0 ? `${archive.failed} page(s) failed` : ''
  ]
    .filter(Boolean)
    .join(' · ')
})

/**
 * A backup opened.
 *
 * Stated facts, not two tables: the rows went into the backup, so there is no
 * per-row story to tell here and nothing to export — which is why this job
 * carries `summary` and the page drops the download button for it.
 */
const backupDetail = (archive: BackupJobArchive): JobDetail => ({
  ...backupRow(archive),
  refLabel: 'Month',
  summary: [
    { label: 'Report', value: REPORT_NAMES[archive.report] },
    { label: 'Started by', value: BACKUP_KIND_NAMES[archive.kind] },
    { label: 'Date range', value: `${archive.from} → ${archive.to}` },
    { label: 'Records synced', value: archive.added.toLocaleString() },
    { label: 'Already held', value: archive.skipped.toLocaleString() },
    { label: 'Account', value: archive.username || '—' },
    ...(archive.failed > 0
      ? [{ label: 'Pages failed', value: String(archive.failed) }]
      : [])
  ],
  // The months it worked through, so a gap is visible as a month that brought
  // back nothing rather than as a number that is lower than expected.
  succeededRows: archive.months.map(month => ({
    ref: `${month.year}-${String(month.month).padStart(2, '0')}`,
    ticketId: null,
    note:
      `${month.added.toLocaleString()} saved` +
      (month.skipped > 0 ? `, ${month.skipped.toLocaleString()} already held` : '') +
      (month.failed > 0 ? `, ${month.failed} page(s) failed` : '')
  })),
  failedRows: [],
  partial: false
})

/**
 * A Snapdeal report sync pass.
 *
 * READS DIFFERENTLY FROM THE AJIO ONE ON PURPOSE, because the work is
 * different: AJIO's backup either got the rows or it did not, while a Snapdeal
 * pass can succeed completely and store nothing — every report it asked for
 * may still be building. So `total` is the requests the pass handled and
 * `succeeded` the ones whose file it brought back, and `pending` is said in
 * words rather than being counted as a failure. A pass that sent four requests
 * and collected none is a good night, not a bad one.
 */
const SNAPDEAL_KIND_NAMES: Record<SnapdealJobArchive['kind'], string> = {
  months: 'Months requested',
  range: 'Range requested',
  daily: 'Scheduled pass',
  collect: 'Collect'
}

const snapdealRow = (archive: SnapdealJobArchive): JobRow => ({
  jobId: archive.jobId,
  kind: 'snapdeal-master-backup',
  platform: 'Snapdeal',
  label: `Report ${SNAPDEAL_KIND_NAMES[archive.kind].toLowerCase()}`,
  status: archive.status,
  total: archive.sent + archive.stored + archive.pending,
  succeeded: archive.stored,
  failed: archive.failed,
  startedAt: archive.startedAt,
  finishedAt: archive.finishedAt,
  error: archive.error,
  detail: [
    archive.from && archive.to ? `${archive.from} → ${archive.to}` : '',
    archive.sent > 0 ? `${archive.sent} requested` : '',
    archive.stored > 0 ? `${archive.stored} collected` : '',
    archive.added > 0 ? `${archive.added.toLocaleString()} row(s) saved` : '',
    // Said plainly: a report Snapdeal is still building is the normal state of
    // a pass, and reading it as a failure is what sends somebody re-requesting
    // windows that are already queued.
    archive.pending > 0 ? `${archive.pending} still building` : ''
  ]
    .filter(Boolean)
    .join(' · ')
})

const snapdealDetail = (archive: SnapdealJobArchive): JobDetail => ({
  ...snapdealRow(archive),
  refLabel: 'What happened',
  summary: [
    { label: 'Account', value: archive.username || '—' },
    ...(archive.from && archive.to
      ? [{ label: 'Date range', value: `${archive.from} → ${archive.to}` }]
      : []),
    { label: 'Started by', value: SNAPDEAL_KIND_NAMES[archive.kind] },
    { label: 'Reports requested', value: String(archive.sent) },
    { label: 'Reports collected', value: String(archive.stored) },
    { label: 'Records saved', value: archive.added.toLocaleString() },
    { label: 'Already held', value: archive.skipped.toLocaleString() },
    { label: 'Still building', value: String(archive.pending) },
    ...(archive.failed > 0 ? [{ label: 'Failed', value: String(archive.failed) }] : [])
  ],
  succeededRows: [],
  failedRows: [],
  partial: false
})

/**
 * A scheduled window, opened and closed.
 *
 * The one job kind nobody started. Its `label` is the task's own name, so the
 * list reads "Session update", "Refill Data" — and the detail line is whatever
 * the task said about itself, which is the point of the adapters returning
 * words rather than only numbers.
 *
 * `total` and the rest come straight off the outcome: this mapper deliberately
 * does no arithmetic, because a task knows what its own numbers mean and this
 * file would only be guessing.
 */
const scheduledRow = (archive: ScheduledRunArchive): JobRow => ({
  jobId: archive.jobId,
  kind: 'scheduled-run',
  platform: archive.platform,
  label: archive.label,
  status: archive.status,
  startedAt: archive.startedAt,
  finishedAt: archive.finishedAt,
  total: archive.total,
  succeeded: archive.succeeded,
  failed: archive.failed,
  error: archive.error,
  detail: ['Scheduled', archive.detail].filter(Boolean).join(' · ')
})

const scheduledDetail = (archive: ScheduledRunArchive): JobDetail => ({
  ...scheduledRow(archive),
  refLabel: 'What ran',
  summary: [
    { label: 'Task', value: archive.label },
    { label: 'Started by', value: 'The schedule' },
    ...archive.summary
  ],
  // The breakdown the task produced — per platform, per report, per account. A
  // failed run still carries its reason in `error` above, so there is nothing
  // to invent here when the list is empty.
  succeededRows: archive.rows,
  failedRows: [],
  partial: false
})

/**
 * TrackVid's own status words for a bulk job → this page's.
 *
 * `STALE` is TrackVid saying it stopped hearing from the run: the app was
 * closed or the machine slept. From here that is a run that did not finish,
 * which is what `stopped` means — not a failure, and not still running, which
 * is the one thing it definitely is not.
 */
const REMOTE_STATUS: Record<BulkJobSummary['status'], JobStatus> = {
  RUNNING: 'running',
  COMPLETED: 'done',
  FAILED: 'failed',
  STALE: 'stopped'
}

/**
 * Bulk-claim jobs as TRACKVID holds them — the company's, not this machine's.
 *
 * Kept because the history this page replaces had it: a bulk claim reports
 * itself to `scriptjobs`, so an operator could see a run a colleague did on
 * another machine. Dropping to the local archive alone would have quietly
 * narrowed the page to "jobs I ran", which is not what the list claims to be.
 *
 * The rows it cannot know are the tickets — those were only ever written on the
 * machine that raised them, which is why `jobDetail` still reads the archive
 * and reports `partial` when there is none.
 */
const remoteBulkRow = (job: BulkJobSummary): JobRow => ({
  jobId: job.jobId,
  kind: 'ajio-bulk-claim',
  platform: 'Ajio',
  label: 'NDR/DDR bulk claim',
  status: REMOTE_STATUS[job.status] ?? 'done',
  startedAt: job.startedAt,
  finishedAt: job.finishedAt,
  total: job.totalAwbs,
  succeeded: job.successCount,
  failed: job.failedCount,
  error: job.error,
  detail: [job.accounts.join(', '), ...job.fileNames].filter(Boolean).join(' · ')
})

/**
 * Local archives win where both have the job.
 *
 * The local record was written by the machine that did the work and has the
 * input counts and the ticket rows; TrackVid's has the counts only. Where only
 * TrackVid has it, the row is somebody else's run and is shown as such.
 */
const mergeBulk = (local: JobRow[], remote: JobRow[]): JobRow[] => {
  const byId = new Map(remote.map(row => [row.jobId, row]))

  for (const row of local) byId.set(row.jobId, row)

  return [...byId.values()]
}

/**
 * Where jobs come from. Keyed by kind so `jobDetail` can go straight to the
 * right store instead of reading both and guessing.
 */
const SOURCES = {
  'ajio-bulk-claim': {
    rows: async (): Promise<JobRow[]> => {
      const local = (await readJobArchives()).map(bulkRow)
      // Best effort. Offline, or signed out, the local archive is still a real
      // answer — so a failed call costs the page other machines' runs, not the
      // page.
      const remote = await listBulkJobs({ page: 1 }).catch(() => null)

      if (!remote || !remote.success) {
        if (remote && !remote.success) {
          logger.info(`[jobs] TrackVid's bulk history was unavailable — ${remote.error.message}`)
        }

        return local
      }

      return mergeBulk(local, remote.data.jobs.map(remoteBulkRow))
    },
    detail: async (jobId: string): Promise<JobDetail | null> => {
      const archive = (await readJobArchives()).find(record => record.jobId === jobId)

      return archive ? bulkDetail(archive) : null
    }
  },
  'myntra-re-claim': {
    rows: async (): Promise<JobRow[]> => (await readReClaimJobs()).map(reClaimRow),
    detail: async (jobId: string): Promise<JobDetail | null> => {
      const archive = (await readReClaimJobs()).find(record => record.jobId === jobId)

      return archive ? reClaimDetail(archive) : null
    }
  },
  'account-map': {
    rows: async (): Promise<JobRow[]> => (await readAccountMapJobs()).map(accountMapRow),
    detail: async (jobId: string): Promise<JobDetail | null> => {
      const archive = (await readAccountMapJobs()).find(record => record.jobId === jobId)

      return archive ? accountMapDetail(archive) : null
    }
  },
  'refill-data': {
    rows: async (): Promise<JobRow[]> => (await readRefillJobs()).map(refillRow),
    detail: async (jobId: string): Promise<JobDetail | null> => {
      const archive = (await readRefillJobs()).find(record => record.jobId === jobId)

      return archive ? refillDetail(archive) : null
    }
  },
  'ajio-master-backup': {
    rows: async (): Promise<JobRow[]> => (await readBackupJobs()).map(backupRow),
    detail: async (jobId: string): Promise<JobDetail | null> => {
      const archive = (await readBackupJobs()).find(record => record.jobId === jobId)

      return archive ? backupDetail(archive) : null
    }
  },
  'snapdeal-master-backup': {
    rows: async (): Promise<JobRow[]> => (await readSnapdealBackupJobs()).map(snapdealRow),
    detail: async (jobId: string): Promise<JobDetail | null> => {
      const archive = (await readSnapdealBackupJobs()).find(record => record.jobId === jobId)

      return archive ? snapdealDetail(archive) : null
    }
  },
  'scheduled-run': {
    rows: async (): Promise<JobRow[]> => (await readScheduledRuns()).map(scheduledRow),
    detail: async (jobId: string): Promise<JobDetail | null> => {
      const archive = await readScheduledRun(jobId)

      return archive ? scheduledDetail(archive) : null
    }
  }
} as const

/**
 * How each kind of history is thrown away.
 *
 * BESIDE `SOURCES` RATHER THAN INSIDE IT, because the two are read by different
 * people for different reasons: everything in SOURCES is about showing a run,
 * and this is the one operation that destroys one. A separate map means a kind
 * that must never be clearable is simply absent from it, which is a statement
 * the type checker enforces at the call site rather than a flag to notice.
 *
 * Each returns how many records went, so the page can say so — "cleared" over
 * an empty list reads as a failure.
 */
const CLEARERS: Record<JobKind, () => Promise<number>> = {
  'ajio-bulk-claim': clearBulkJobArchives,
  'myntra-re-claim': clearReClaimJobs,
  'account-map': clearAccountMapJobs,
  'refill-data': clearRefillJobs,
  'ajio-master-backup': clearBackupJobs,
  'snapdeal-master-backup': clearSnapdealBackupJobs,
  'scheduled-run': clearScheduledRuns
}

/**
 * Clear one kind of history, or all of it.
 *
 * ONE KIND IS THE POINT. The page is filtered — "Refill Data 2", "Ajio bulk
 * claim 13" — and an operator clearing the list in front of them means that
 * list. A single "clear everything" button forces them to destroy the record of
 * runs they still need in order to be rid of the noise from one, which is how
 * the evidence for a claim nobody can explain gets lost.
 *
 * `all` is still offered, because starting a machine over is a real thing to
 * want — but it has to be asked for by name rather than being the only option.
 *
 * The local archive only. A bulk run this company did on ANOTHER machine comes
 * from TrackVid and is not this app's to delete; it reappears on the next
 * refresh, which is correct and would be baffling if this claimed otherwise —
 * so the result says how many went from here.
 */
export const clearJobs = async (payload: unknown): Promise<Result<{ cleared: number }>> => {
  const kind = (payload as { kind?: unknown })?.kind

  /*
   * ONLY THE WORD "all" MEANS ALL.
   *
   * This also accepted a MISSING kind as "clear everything", which is the one
   * mistake here that cannot be undone: a stale renderer, a typo in a payload,
   * or a call that lost its argument would have wiped every record this machine
   * holds instead of failing. The widest action has to be the one asked for by
   * name.
   */
  if (kind === 'all') {
    const counts = await Promise.all(Object.values(CLEARERS).map(clear => clear()))

    const cleared = counts.reduce((total, count) => total + count, 0)

    logger.info(`[jobs] cleared ${cleared} record(s) — every kind`)

    return ok({ cleared })
  }

  // Narrowed once, here: everything below is about a NAME, and an `unknown`
  // carried further would have to be re-proved at each use.
  const requested = typeof kind === 'string' ? kind.trim() : ''

  if (!requested) return fail('VALIDATION_ERROR', 'No job history was named')

  // The lookup, not an `in` check: under noUncheckedIndexedAccess that is the
  // one that both narrows and proves there is something to call.
  const clear = CLEARERS[requested as JobKind]

  if (!clear) return fail('VALIDATION_ERROR', `There is no job history called "${requested}"`)

  const cleared = await clear()

  logger.info(`[jobs] cleared ${cleared} ${requested} record(s)`)

  return ok({ cleared })
}

export const listJobs = async (): Promise<Result<JobRow[]>> => {
  const lists = await Promise.all(Object.values(SOURCES).map(source => source.rows()))

  // Newest first across types, which is the only ordering that makes one list
  // out of two — an operator looking for "the run I did this morning" does not
  // know or care which kind it was.
  const rows = lists.flat().sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))

  return ok(rows)
}

export const jobDetail = async (payload: unknown): Promise<Result<JobDetail>> => {
  const request = (payload ?? {}) as { jobId?: unknown; kind?: unknown }
  const jobId = typeof request.jobId === 'string' ? request.jobId.trim() : ''
  const kind = request.kind

  if (!jobId) return fail('VALIDATION_ERROR', 'No job was asked for')

  // The kind comes from the row the operator clicked, so it is known. Both
  // stores are searched when it is not, rather than refusing — a job id is
  // unique across them.
  const sources =
    typeof kind === 'string' && kind in SOURCES
      ? [SOURCES[kind as keyof typeof SOURCES]]
      : Object.values(SOURCES)

  for (const source of sources) {
    const found = await source.detail(jobId)

    if (found) return ok(found)
  }

  return fail(
    'NOT_FOUND',
    'This machine has no record of that job — it may have run on another machine, or been ' +
      'pruned to keep the history a readable size.'
  )
}

/** A sheet, as `writeReportWorkbook` takes it. */
export interface ReportSheet {
  name: string
  columns: string[]
  rows: (string | number)[][]
}

/**
 * A job's two lists as sheets. Pure, and exported for tests.
 *
 * A re-claim's succeeded rows have no second ticket id and a bulk claim's have
 * no marketplace status, so each sheet carries only the columns its job
 * actually fills — the same rule the page's tables follow, for the same reason:
 * a header over three hundred empty cells is a worse report than a narrower one.
 */
export const reportSheets = (job: JobDetail): ReportSheet[] => {
  const hasTicket = job.succeededRows.some(row => row.ticketId)
  const hasNote = job.succeededRows.some(row => row.note)
  const noteLabel = job.kind === 'myntra-re-claim' ? 'Myntra status' : 'SKU'
  // A multi-article return fails per article, so its AWB repeats — the SKU is
  // what tells those rows apart.
  const hasFailedSku = job.failedRows.some(row => row.sku)
  // ON EVERY SHEET, for a job that counts attempts (a bulk claim): which filing
  // produced each row — 1 for the first run, +1 per Retry that re-filed it.
  const hasAttempt =
    job.succeededRows.some(row => typeof row.attempt === 'number') || job.failedRows.some(row => typeof row.attempt === 'number')

  return [
    {
      name: 'Successful',
      columns: [
        job.refLabel,
        ...(hasTicket ? ['Ticket'] : []),
        ...(hasNote ? [noteLabel] : []),
        ...(hasAttempt ? ['Attempt'] : [])
      ],
      rows: job.succeededRows.map(row => [
        row.ref,
        ...(hasTicket ? [row.ticketId ?? ''] : []),
        ...(hasNote ? [row.note ?? ''] : []),
        ...(hasAttempt ? [row.attempt ?? 1] : [])
      ])
    },
    {
      name: 'Failed',
      columns: [job.refLabel, ...(hasFailedSku ? ['SKU'] : []), 'Result', 'Reason', ...(hasAttempt ? ['Attempt'] : [])],
      rows: job.failedRows.map(row => [
        row.ref,
        ...(hasFailedSku ? [row.sku ?? ''] : []),
        row.result ?? '',
        row.reason,
        ...(hasAttempt ? [row.attempt ?? 1] : [])
      ])
    }
  ]
}

/**
 * One job's two lists as an .xlsx, wherever the operator asks for it.
 *
 * The page shows them already, so this is for what a page cannot do: send the
 * refusals to whoever has to act on them, keep a copy beside the month's
 * paperwork, sort three hundred rows by reason. Both sheets are written even
 * when one is empty — "nothing failed" is an answer, and a missing sheet reads
 * like the report was cut short.
 *
 * Built from the same `JobDetail` the page renders, so the file and the screen
 * cannot disagree, and it works for any job type for the same reason the page
 * does.
 */
export const downloadJobReport = async (
  payload: unknown
): Promise<Result<{ path: string; succeeded: number; failed: number }>> => {
  const detail = await jobDetail(payload)

  if (!detail.success) return detail

  const job = detail.data
  const day = job.startedAt.slice(0, 10)
  const shortId = job.jobId.slice(0, 8)
  // The platform and the day, so a folder of these is sortable and a file on
  // its own still says what it is.
  const suggested = `${job.platform.toLowerCase()}-${job.kind.replace(/^[a-z]+-/, '')}-${day}-${shortId}.xlsx`

  const chosen = await dialog.showSaveDialog({
    title: `Save the report for job ${shortId}`,
    defaultPath: join(app.getPath('downloads'), suggested),
    filters: [{ name: 'Spreadsheets', extensions: ['xlsx'] }]
  })

  // The same word the other save dialogs use; the renderer swallows it rather
  // than reporting a cancelled dialog as a failure.
  if (chosen.canceled || !chosen.filePath) return fail('VALIDATION_ERROR', 'Cancelled')

  try {
    const { writeReportWorkbook } = loadCore<{
      writeReportWorkbook: (path: string, sheets: ReportSheet[]) => string
    }>('common/reportWorkbook')

    writeReportWorkbook(chosen.filePath, reportSheets(job))

    return ok({
      path: chosen.filePath,
      succeeded: job.succeededRows.length,
      failed: job.failedRows.length
    })
  } catch (error) {
    return fail('INTERNAL_ERROR', error instanceof Error ? error.message : String(error))
  }
}
