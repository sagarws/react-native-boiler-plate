import type { CronExecution } from '@shared/types/automationSchedule'
import { scheduledTaskInfo } from '@shared/constants/automationSchedule'
import { CRON_STATUS_LABEL, type CronRunStatus } from '@shared/utils/cronStatus'
import { RUN_TRIGGER_LABEL } from '@shared/constants/automationModes'

/**
 * Every run, as a table.
 *
 * ONE COMPONENT FOR BOTH VIEWS — the per-task history opened from the settings
 * card, and the merged view in the schedule dialog. The columns are the same
 * question asked of one task or of four, and two tables would drift apart on
 * exactly the details that make them readable: how a duration is written, what
 * an unfinished run shows, which half of a failure is worth the width.
 *
 * `showTask` is the only difference: a per-task view already knows whose runs
 * these are, and repeating the name down every row wastes the column that the
 * reason needs.
 */

const STATUS_STYLE: Record<CronRunStatus, string> = {
  running: 'text-accent',
  completed: 'text-success-fg',
  completed_with_errors: 'text-warning-fg',
  failed: 'text-danger-fg',
  skipped: 'text-muted'
}

const stamp = (iso: string | null): string =>
  iso === null ? '—' : new Date(iso).toLocaleString()

/** How long it took, or nothing where there is no answer. */
export const runDuration = (execution: CronExecution): string => {
  if (execution.completedAt === null) return '—'

  const ms = Date.parse(execution.completedAt) - Date.parse(execution.startedAt)

  if (!Number.isFinite(ms) || ms < 0) return '—'
  if (ms < 1000) return '<1s'

  const seconds = Math.round(ms / 1000)

  if (seconds < 60) return `${seconds}s`

  const minutes = Math.floor(seconds / 60)

  return `${minutes}m ${seconds % 60}s`
}

/**
 * A row with no completion that is not running any more: Automations were
 * switched off under it, or the app stopped. It is left exactly so — no
 * completion is ever written for it — and the monitor runs the task again.
 */
const isIncomplete = (execution: CronExecution): boolean =>
  execution.completedAt === null && execution.interrupted === true

/** Each platform's share — "ajio 4/5 · meesho 2/2". */
const perPlatform = (execution: CronExecution): string =>
  execution.platforms && execution.platforms.length > 0
    ? execution.platforms
        .map(entry =>
          entry.total === 0 ? entry.platform : `${entry.platform} ${entry.succeeded}/${entry.total}`
        )
        .join(' · ')
    : '—'

/** The per-platform detail lines, for the cell's tooltip. */
const perPlatformDetail = (execution: CronExecution): string =>
  (execution.platforms ?? [])
    .map(
      entry =>
        `${entry.platform}: ${entry.succeeded} done, ${entry.failed} failed of ${entry.total}` +
        (entry.detail ? ` — ${entry.detail}` : '')
    )
    .join('\n')

/** What it got through, when the task counted anything. */
const worked = (execution: CronExecution): string =>
  execution.total === 0 ? '—' : `${execution.succeeded}/${execution.total}`

export const CronHistoryTable = ({
  entries,
  showTask = false
}: {
  entries: CronExecution[]
  showTask?: boolean
}) => (
  /* Scrollable both ways and bounded vertically: the dialog must not grow past
     the window, and the reason column is worth more than a tidy fit. */
  <div className='max-h-[var(--dialog-scroll-max)] overflow-auto'>
    <table className='w-full text-xs'>
      <thead>
        <tr className='border-b border-subtle text-left text-2xs uppercase tracking-wide text-muted'>
          {showTask && <th className='py-2 pe-3 font-medium'>Task</th>}
          <th className='py-2 pe-3 font-medium'>Status</th>
          <th className='py-2 pe-3 font-medium'>Started</th>
          <th className='py-2 pe-3 font-medium'>Completed</th>
          <th className='py-2 pe-3 font-medium'>Took</th>
          <th className='py-2 pe-3 font-medium'>Done</th>
          <th className='py-2 pe-3 font-medium'>Platforms</th>
          <th className='py-2 font-medium'>Detail</th>
        </tr>
      </thead>
      <tbody>
        {entries.map(execution => (
          <tr key={execution.id} className='border-b border-subtle last:border-b-0'>
            {showTask && (
              <td className='py-2 pe-3 whitespace-nowrap font-medium text-body'>
                {scheduledTaskInfo(execution.taskId).label}
              </td>
            )}
            <td
              className={`py-2 pe-3 whitespace-nowrap ${
                isIncomplete(execution) ? 'text-warning-fg' : STATUS_STYLE[execution.status]
              }`}
            >
              {isIncomplete(execution) ? 'Incomplete' : CRON_STATUS_LABEL[execution.status]}
              {/* What started it — the schedule, the toggle going on, or a Run
                  now. Different questions about the same task, and a history
                  that does not say which invites "it worked when I pressed it"
                  against a schedule that never fired. A row from before
                  `trigger` existed falls back to its `manual` flag. */}
              <span className='text-muted'>
                {' · '}
                {RUN_TRIGGER_LABEL[execution.trigger ?? (execution.manual ? 'manual' : 'schedule')]}
              </span>
            </td>
            <td className='py-2 pe-3 whitespace-nowrap tabular-nums text-muted'>
              {stamp(execution.startedAt)}
            </td>
            <td className='py-2 pe-3 whitespace-nowrap tabular-nums text-muted'>
              {/* Blank means it never finished — switched off, or the app was
                  stopped mid-run — or that it is still going. Said as such
                  rather than left empty, which reads as a column nobody filled
                  in. */}
              {execution.completedAt === null ? (
                <span className='text-warning-fg'>
                  {isIncomplete(execution) ? 'did not finish' : 'running'}
                </span>
              ) : (
                stamp(execution.completedAt)
              )}
            </td>
            <td className='py-2 pe-3 whitespace-nowrap tabular-nums text-muted'>
              {runDuration(execution)}
            </td>
            <td className='py-2 pe-3 whitespace-nowrap tabular-nums text-muted'>
              {worked(execution)}
            </td>
            <td className='py-2 pe-3 whitespace-nowrap tabular-nums text-muted'>
              <span title={perPlatformDetail(execution)}>{perPlatform(execution)}</span>
            </td>
            {/* BOUNDED, because a marketplace error runs to several sentences.
                Unbounded it wraps into a dozen lines, stretches the row to the
                height of the paragraph and leaves every other column stranded
                in white space — which is what this table looked like before the
                cap. The full text is on the title, and expanding the dialog
                gives it the width. */}
            <td className='max-is-[var(--cell-detail-max)] py-2 text-muted'>
              <span className='line-clamp-2' title={execution.error ?? execution.detail ?? ''}>
                {/* The error first where there is one: a failed row is being
                    read to find out WHY, and the detail is usually the same
                    sentence with less in it. */}
                {execution.error ?? execution.detail ?? '—'}
              </span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
)
