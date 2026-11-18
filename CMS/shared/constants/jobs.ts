import type { JobKind } from '@shared/types/jobs'

/**
 * Which jobs are written to this machine's local database when they finish.
 *
 * ONE SWITCH PER JOB KIND, all on. A job's archive is what the Jobs page reads
 * afterwards: turn one off and that kind still runs and still reports itself in
 * its own window, but leaves no record once the window is closed.
 *
 * Why it exists: the archives are the only trace some of these runs leave. A
 * re-claim and a mapping sweep tell TrackVid nothing about the run itself — the
 * answers land on the claims, not in `scriptjobs` — so this is the difference
 * between "what did that sweep change" being answerable tomorrow and not. It is
 * a switch rather than an assumption so a machine that must not keep operator
 * history can stop keeping it, per kind, without touching the runs.
 *
 * Checked at the END of a run, never at the start: a run that finishes must
 * not be able to fail over its own bookkeeping, and a flag flipped mid-run
 * takes effect on the next one.
 */
export const JOB_RECORDING: Record<JobKind, boolean> = {
  'ajio-bulk-claim': true,
  'myntra-re-claim': true,
  'account-map': true,
  'refill-data': true,
  'ajio-master-backup': true,
  'snapdeal-master-backup': true,
  'scheduled-run': true
}

/** Should this kind of job be written to the local database when it ends? */
export const recordsJob = (kind: JobKind): boolean => JOB_RECORDING[kind] === true

/**
 * Which kinds of job have a spreadsheet worth saving.
 *
 * A registry rather than a check on the kind where the button is drawn: the
 * Jobs page is meant not to know what kinds exist, and "this one has no report"
 * is a fact about the job, not about the page. A backup's rows went into the
 * backup — offering to export them here would export nothing.
 */
export const JOB_HAS_REPORT: Record<JobKind, boolean> = {
  'ajio-bulk-claim': true,
  'myntra-re-claim': true,
  'account-map': true,
  'refill-data': true,
  // The work's own job has the rows and the report. This row is the window
  // opening — exporting it would export a summary of a summary.
  'ajio-master-backup': false,
  // Same reasoning: the rows went into the backup, and the request table
  // holds the per-window story this row would otherwise duplicate.
  'snapdeal-master-backup': false,
  'scheduled-run': false
}

/** Can this kind of job be downloaded as a spreadsheet? */
export const hasJobReport = (kind: JobKind): boolean => JOB_HAS_REPORT[kind] === true

/**
 * What to call each kind on the Jobs page's filter chips.
 *
 * A `Record<JobKind, …>` rather than the array this replaced, which had gone
 * stale without anyone noticing: `ajio-master-backup` was missing from it, so
 * backup jobs were in the list but had no chip, and nothing caught it because an
 * array cannot be exhaustive. This shape makes a new kind a compile error until
 * it is named.
 */
export const JOB_LABEL: Record<JobKind, string> = {
  'ajio-bulk-claim': 'Ajio bulk claim',
  'myntra-re-claim': 'Myntra re-claim',
  'account-map': 'Map Username',
  'refill-data': 'Refill Data',
  'ajio-master-backup': 'Master data backup',
  'snapdeal-master-backup': 'Snapdeal report sync',
  'scheduled-run': 'Scheduled'
}

/**
 * What the last column of an opened job's succeeded table is ABOUT, per kind.
 *
 * Here for the same reason as the two registries above: this was a ladder of
 * `detail.kind === …` checks inside the Jobs page, which meant every new job
 * type silently inherited the fallback heading "SKU" over a column that held
 * nothing of the sort.
 */
export const JOB_NOTE_LABEL: Record<JobKind, string> = {
  'ajio-bulk-claim': 'SKU',
  'myntra-re-claim': 'Myntra status',
  'account-map': 'Account · sub-order number',
  'refill-data': 'What was filled',
  'ajio-master-backup': 'What was saved',
  'snapdeal-master-backup': 'What was saved',
  'scheduled-run': 'What happened'
}
