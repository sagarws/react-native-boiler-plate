import { useState, type ReactNode } from 'react'
import { Maximize2, Minimize2 } from 'lucide-react'
import type {
  AutomationScheduleState,
  ScheduledTaskId,
  ScheduledTaskState
} from '@shared/types/automationSchedule'
import { describeCron } from '@shared/utils/cronSchedule'
import { Badge } from '@renderer/components/ui/Badge'
import { Button } from '@renderer/components/ui/Button'
import { skipRunningTask } from '@renderer/services/automationSchedule.service'
import { useToast } from '@renderer/hooks/useToast'
import { Modal } from '@renderer/components/ui/Modal'
import { formatDateTime } from '@renderer/utils/format'
import { CronLogPanel } from './CronLogPanel'
import { CronHistoryPanel } from './CronHistoryPanel'
import { CronPlatformsPanel } from './CronPlatformsPanel'

/**
 * Everything the schedule is doing, in one list.
 *
 * ORDERED BY WHAT THE OPERATOR IS LOOKING FOR, not by task id: what is running
 * now, what is waiting behind it, what is coming later, and what is switched
 * off. Someone opening this at 02:15 wants the first group; someone opening it
 * at nine in the morning wants the third, to see whether last night happened.
 *
 * It reads the state the rail already has rather than fetching its own, so
 * opening it cannot disagree with the switch that opened it.
 */

type Group = 'running' | 'queued' | 'scheduled' | 'off'

const groupOf = (task: ScheduledTaskState): Group => {
  if (task.running) return 'running'
  if (task.queued) return 'queued'

  return task.enabled ? 'scheduled' : 'off'
}

const GROUPS: { id: Group; title: string; empty: string }[] = [
  { id: 'running', title: 'Running now', empty: 'Nothing is running.' },
  { id: 'queued', title: 'Queued', empty: 'Nothing is waiting to start.' },
  { id: 'scheduled', title: 'Scheduled', empty: 'No task is switched on.' },
  { id: 'off', title: 'Switched off', empty: 'Every task is switched on.' }
]

/** "in 4 hours", "in 12 minutes", "now" — a next-run time nobody has to subtract. */
const untilNow = (epochMs: number): string => {
  const ms = epochMs - Date.now()

  if (ms <= 0) return 'now'

  const minutes = Math.round(ms / 60_000)

  if (minutes < 60) return `in ${minutes} minute${minutes === 1 ? '' : 's'}`

  const hours = Math.round(minutes / 60)

  if (hours < 24) return `in ${hours} hour${hours === 1 ? '' : 's'}`

  const days = Math.round(hours / 24)

  return `in ${days} day${days === 1 ? '' : 's'}`
}

const TaskRow = ({
  task,
  group,
  skipping,
  onSkip
}: {
  task: ScheduledTaskState
  group: Group
  skipping: boolean
  onSkip: () => void
}) => {
  const when: ReactNode =
    group === 'running'
      ? 'Started — see Jobs for progress'
      : group === 'queued'
        ? 'Waiting for the task ahead of it'
        : group === 'scheduled' && task.nextRunAt !== null
          ? `${describeCron(task.cron)} · next ${untilNow(task.nextRunAt)}`
          : describeCron(task.cron)

  return (
    <li className='flex items-start justify-between gap-3 border-b border-subtle py-2 last:border-b-0'>
      <div className='min-w-0'>
        <p className='truncate text-sm font-medium text-body'>{task.label}</p>
        <p className='truncate text-xs text-muted'>{when}</p>
        {/* The last outcome, so "did last night run?" is answered here rather
            than by opening Jobs and matching timestamps. */}
        {task.lastError ? (
          <p className='mt-0.5 truncate text-xs text-danger-fg'>Last run failed — {task.lastError}</p>
        ) : task.lastDetail ? (
          <p className='mt-0.5 truncate text-xs text-muted'>Last run — {task.lastDetail}</p>
        ) : (
          <p className='mt-0.5 text-xs text-muted'>Has not run on this machine yet</p>
        )}
      </div>
      <div className='shrink-0 text-right'>
        {group === 'running' && (
          <div className='flex items-center justify-end gap-2'>
            {/* SKIP THIS ONE, not the schedule. A task grinding through a
                marketplace that is refusing everything holds up the three
                behind it, and the only ways out were to wait or to switch
                everything off — which stops the tasks that were fine. */}
            <Button size='sm' variant='secondary' loading={skipping} onClick={onSkip}>
              Skip
            </Button>
            <Badge tone='success'>Running</Badge>
          </div>
        )}
        {group === 'queued' && <Badge tone='warning'>Queued</Badge>}
        {group === 'off' && <Badge tone='neutral'>Off</Badge>}
        {task.lastRunAt && (
          <p className='mt-1 text-xs text-muted'>{formatDateTime(task.lastRunAt)}</p>
        )}
      </div>
    </li>
  )
}

export const CronJobsModal = ({
  open,
  onClose,
  state
}: {
  open: boolean
  onClose: () => void
  state: AutomationScheduleState
}) => {
  const [tab, setTab] = useState<'now' | 'platforms' | 'log' | 'history'>('now')
  const [expanded, setExpanded] = useState(false)
  /** The task whose Skip is in flight, so only that button spins. */
  const [skipping, setSkipping] = useState<ScheduledTaskId | null>(null)
  const toast = useToast()

  /*
   * The state this modal shows comes from the rail above it, which is listening
   * for the schedule's own change event — so nothing is re-fetched here. The
   * row stops saying "Running" when the task actually stops, not when the
   * button was pressed, which is the honest moment: a skip is a request that
   * takes effect at the next safe boundary.
   */
  const skip = (taskId: ScheduledTaskId): void => {
    setSkipping(taskId)
    void skipRunningTask(taskId)
      .then(result => {
        if (result.success) toast.success('Skipping — it will stop after the step it is on')
        else toast.error(result.error.message)
      })
      .finally(() => setSkipping(null))
  }

  const grouped = GROUPS.map(group => ({
    ...group,
    tasks: state.tasks.filter(task => groupOf(task) === group.id)
  }))

  return (
    <Modal
      open={open}
      onClose={onClose}
      title='Scheduled automations'
      description={
        state.paused
          ? state.stopping
            ? 'Switched off. The task still running will stop after the step it is on.'
            : 'Switched off. Nothing will run until you switch it back on.'
          : 'Switched on. Tasks run one at a time, in the order below.'
      }
      size={expanded ? 'full' : 'md'}
      headerActions={
        /* EXPAND, because the run history is a table and a table needs width.
           At the dialog's usual size the reason column — the one somebody
           opened this to read — is off the right-hand edge, and the rows it
           wraps stand as empty space in every other column. Kept as a choice
           rather than made the default: a dialog that fills the screen by
           itself is a page that forgot to be one. */
        <button
          type='button'
          aria-label={expanded ? 'Shrink this dialog' : 'Expand this dialog'}
          aria-pressed={expanded}
          title={expanded ? 'Back to the usual size' : 'Expand to fill the window'}
          onClick={() => setExpanded(current => !current)}
          className='rounded-md p-1.5 text-faint ring-1 ring-subtle hover:bg-surface-active hover:text-textSecondary'
        >
          {expanded ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
        </button>
      }
    >
      {/* The wrapper carries the expanded state down as a CSS variable, so the
          panels inside grow with the dialog without being told about it. */}
      <div className={expanded ? 'dialog-expanded' : undefined}>
      {/* TWO QUESTIONS, TWO TABS. "What is the state of things" is a list of
          tasks; "why has nothing happened since nine" is a list of decisions,
          and the second cannot be read off the first — the interesting cases
          are all absences. */}
      <div className='mb-3 flex gap-1 border-b border-subtle'>
        {([
          { id: 'now' as const, label: 'Current view' },
          /* The question the other three cannot answer: WHICH marketplace. A
             run's totals are about the run; the work is organised by platform,
             and so is everything an operator does about it. */
          { id: 'platforms' as const, label: 'Platforms' },
          { id: 'log' as const, label: 'Automation log' },
          { id: 'history' as const, label: 'Run history' }
        ]).map(entry => (
          <button
            key={entry.id}
            type='button'
            onClick={() => setTab(entry.id)}
            aria-current={tab === entry.id}
            className={
              tab === entry.id
                ? 'border-b-2 border-accent px-3 py-2 text-xs font-medium text-body'
                : 'border-b-2 border-transparent px-3 py-2 text-xs text-muted hover:text-body'
            }
          >
            {entry.label}
          </button>
        ))}
      </div>

      {tab === 'history' ? (
        <CronHistoryPanel />
      ) : tab === 'platforms' ? (
        <CronPlatformsPanel state={state} />
      ) : tab === 'log' ? (
        <CronLogPanel />
      ) : (
        <>
          {/* What has the browser, when anything does. It explains the one
              surprise this list can produce: a task due at 02:00 that started
              at 02:18 because a bulk claim still had it. */}
          {state.busy && (
            <p className='mb-3 rounded-md bg-surface-active px-3 py-2 text-xs text-muted'>
              {state.busy} has the browser right now. A due task waits rather than
              competing for it.
            </p>
          )}

          {/* Bounded and scrollable for the same reason as the log: four tasks
              plus their last outcomes can outgrow a short window. */}
          <div className='max-h-[var(--dialog-scroll-max)] overflow-y-auto pe-1'>
            {grouped.map(group => (
              <section key={group.id} className='mb-4 last:mb-0'>
                <h3 className='mb-1 text-xs font-semibold uppercase tracking-wide text-muted'>
                  {group.title}
                </h3>
                {group.tasks.length === 0 ? (
                  <p className='text-xs text-muted'>{group.empty}</p>
                ) : (
                  <ul>
                    {group.tasks.map(task => (
                      <TaskRow
                        key={task.id}
                        task={task}
                        group={group.id}
                        skipping={skipping === task.id}
                        onSkip={() => skip(task.id)}
                      />
                    ))}
                  </ul>
                )}
              </section>
            ))}
          </div>
        </>
      )}
      </div>
    </Modal>
  )
}
