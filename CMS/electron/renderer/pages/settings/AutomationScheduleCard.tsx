import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { CalendarClock, History, Play, RotateCcw, SkipForward } from 'lucide-react'
import { Card } from '@renderer/components/ui/Card'
import type { AutomationScheduleState, ScheduledTaskId } from '@shared/types/automationSchedule'
import { describeCron, type CronSchedule } from '@shared/utils/cronSchedule'
import { CronModal } from './CronModal'
import { CronHistoryModal } from './CronHistoryModal'
import { ConfirmDialog } from '@renderer/components/ui/ConfirmDialog'
import { Button } from '@renderer/components/ui/Button'
import { Switch } from '@renderer/components/ui/Switch'
import { useToast } from '@renderer/hooks/useToast'
import { useDevMode } from '@renderer/context/DevModeContext'
import {
  automationScheduleState,
  onScheduleChanged,
  resetSchedule,
  runTaskNow,
  saveTaskSchedule,
  skipBlockedRun
} from '@renderer/services/automationSchedule.service'

/**
 * The nightly schedule — four automations, each with a switch and a time.
 *
 * WHAT THIS CARD IS FOR. Everything it lists already works; what it did not have
 * was a time of day. Sessions were re-captured when somebody noticed the red
 * banner, the claims were filed when somebody opened the page. That is fine at a
 * desk and useless overnight, which is when the marketplaces are quietest.
 *
 * ONE ROW PER TASK, AND THE ROWS ARE DATA. The card renders whatever the main
 * process says the tasks are — it has no list of its own, no `if (task.id ===
 * …)`, and no knowledge of what any of them does. A fifth automation appears
 * here without this file changing.
 *
 * WHY EACH ROW SHOWS ITS LAST RUN. A schedule's failure mode is silence: it
 * stops running and looks exactly like a schedule that ran and found nothing to
 * do. The last line of each row is the answer to "did it actually happen", and
 * the Jobs page has the rest.
 */

const when = (at: number | null): string => {
  if (at === null) return ''

  const minutes = Math.round((at - Date.now()) / 60_000)

  if (minutes < 1) return 'due now'
  if (minutes < 60) return `in ${minutes} min`
  if (minutes < 60 * 24) return `in ${Math.round(minutes / 60)} h`

  return new Date(at).toLocaleString()
}

/**
 * Anything a particular task wants to show under its own row.
 *
 * A SLOT, not a branch. This card renders whatever the main process says the
 * tasks are and deliberately has no `if (task.id === …)` anywhere — so the one
 * task that has more to say (Session update, which lists the accounts it is
 * about to work on) is handed in by the page instead of special-cased here.
 */
interface Props {
  detailFor?: (task: { id: ScheduledTaskId; running: boolean }) => ReactNode
}

export const AutomationScheduleCard = ({ detailFor }: Props = {}) => {
  const toast = useToast()
  const { devMode } = useDevMode()
  const [state, setState] = useState<AutomationScheduleState | null>(null)
  /** The task whose cron dialog is open, or null. */
  const [editing, setEditing] = useState<ScheduledTaskId | null>(null)
  const [historyFor, setHistoryFor] = useState<ScheduledTaskId | null>(null)
  const [confirmSkip, setConfirmSkip] = useState<ScheduledTaskId | null>(null)
  const [skipping, setSkipping] = useState(false)
  const [busy, setBusy] = useState<ScheduledTaskId | null>(null)

  const load = useCallback(async (): Promise<void> => {
    const response = await automationScheduleState()

    if (!response.success) return

    setState(response.data)
  }, [])

  // The promise chain is inline rather than a call to `load` so that every
  // setState here happens after an await, which the rule allows.
  useEffect(() => {
    void automationScheduleState().then(response => {
      if (!response.success) return

      setState(response.data)
    })
  }, [])

  // A scheduled run starts with nobody watching, so the card is told rather
  // than asked — otherwise it shows a task as idle while it is driving a
  // browser.
  useEffect(() => onScheduleChanged(setState), [])

  const save = async (
    id: ScheduledTaskId,
    enabled: boolean,
    cron: CronSchedule | null
  ): Promise<void> => {
    setBusy(id)

    const response = await saveTaskSchedule({ taskId: id, enabled, cron })

    setBusy(null)

    if (!response.success) {
      toast.error(response.error.message)

      return
    }

    setState(response.data)
    setEditing(null)
  }

  /**
   * Passes over a failure so the tasks behind it can run.
   *
   * Behind a confirmation because it is a decision about work that has not
   * happened, and the operator is the only one allowed to make it — the
   * scheduler never steps over a failure on its own.
   */
  const skip = async (id: ScheduledTaskId, label: string): Promise<void> => {
    setSkipping(true)

    const response = await skipBlockedRun(id)

    setSkipping(false)
    setConfirmSkip(null)

    if (!response.success) {
      toast.error(response.error.message)

      return
    }

    setState(response.data)
    toast.success(`${label} skipped — the tasks after it can run now`)
  }

  const runNow = async (id: ScheduledTaskId, label: string): Promise<void> => {
    setBusy(id)
    toast.info(`${label} started`)

    const response = await runTaskNow(id)

    setBusy(null)
    await load()

    if (!response.success) {
      toast.error(`${label} — ${response.error.message}`)

      return
    }

    toast.success(`${label} — ${response.data.detail}`)
  }

  const tasks = state?.tasks ?? []

  /**
   * Reset is CONFIRMED, unlike every other control on this card.
   *
   * The rest change one task and are obvious to undo. This one switches four
   * back on and moves every time at once — including Auto claim, which files
   * real claims — so an operator who meant to press Run now beside it should
   * not discover the difference afterwards.
   */
  const [confirmReset, setConfirmReset] = useState(false)
  const [resetting, setResetting] = useState(false)

  const reset = useCallback(async () => {
    setResetting(true)

    const response = await resetSchedule()

    setResetting(false)
    setConfirmReset(false)

    if (!response.success) {
      toast.error(response.error.message)

      return
    }

    setState(response.data)
    toast.success('Schedule reset — every automation back on, at its default time')
  }, [toast])

  return (
    <Card
      // DEVELOPER MODE ONLY, the heading and its explanation. Operators get the
      // rows and the Reset button; the prose about how the scheduler behaves is
      // for whoever is diagnosing it.
      icon={devMode ? <CalendarClock size={16} /> : undefined}
      title={devMode ? 'Automation schedule' : null}
      description={
        devMode
          ? 'Runs these on this machine at the time you set, without anybody pressing anything. Times are IST, every run is recorded on the Jobs page, and a missed window is picked up the next time the app opens.'
          : undefined
      }
      headerAction={
        <div className="flex items-center gap-2">
          {state?.busy && (
            <span className="rounded-full bg-warning-surface px-2 py-0.5 text-xs font-medium text-warning-fg ring-1 ring-warning-border">
              {state.busy} is using the browser
            </span>
          )}

          <Button
            variant="secondary"
            icon={<RotateCcw size={14} />}
            disabled={state === null || resetting}
            onClick={() => setConfirmReset(true)}
          >
            Reset
          </Button>
        </div>
      }
    >
      <div className="flex flex-col divide-y divide-hairline">
        {tasks.map(task => (
          <div key={task.id} className="flex flex-wrap items-center gap-3 py-3">
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-2 text-xs font-medium text-textPrimary">
                {task.label}
                {task.running && (
                  <span className="rounded-full bg-accent-soft px-2 py-0.5 text-2xs font-medium text-accent-hover">
                    Running
                  </span>
                )}
              </p>
              {/* Developer mode only, like the card's own explanation above. */}
              {devMode && <p className="mt-0.5 max-w-prose text-xs text-muted">{task.description}</p>}

              {/* THE RETRY IS ENDLESS, so this is what says it is not working.
                  A task failing every minute looks busy in the log and makes no
                  progress; the count is the difference, and past a couple it
                  means something needs a person rather than more patience. */}
              {task.consecutiveFailures > 1 && (
                <p className="mt-1 text-xs text-danger-fg">
                  Failed {task.consecutiveFailures} times in a row — it keeps retrying, but
                  something needs fixing or skipping.
                </p>
              )}

              {/* The answer to "did it actually run last night". A task that
                  has never run says so rather than showing an empty line, which
                  reads as a task that ran and found nothing. */}
              <p className="mt-1 text-xs text-faint">
                {task.lastError ? (
                  <span className="text-danger-fg">Last run failed — {task.lastError}</span>
                ) : task.lastCompletedAt ? (
                  <>
                    Last completed {new Date(task.lastCompletedAt).toLocaleString()}
                    {task.lastDetail ? ` · ${task.lastDetail}` : ''}
                  </>
                ) : task.running && task.lastStartedAt ? (
                  /*
                   * RUNNING NOW, not abandoned.
                   *
                   * A run in flight has a start and no completion — exactly the
                   * shape of one the app was killed during. Without this the
                   * card said "Started 18:31:42 and did not finish" beside its
                   * own Running badge, which reads as a fault at the very
                   * moment the task is working.
                   */
                  <span className="text-accent">
                    Running since {new Date(task.lastStartedAt).toLocaleString()}
                  </span>
                ) : task.lastStartedAt ? (
                  // Started and never completed, and nothing is running: the app
                  // was killed mid-run, and this is the row that says so rather
                  // than a blank line.
                  <span className="text-warning-fg">
                    Started {new Date(task.lastStartedAt).toLocaleString()} and did not finish
                  </span>
                ) : (
                  'Has not run on this machine yet'
                )}
                {task.enabled &&
                  task.nextRunAt !== null &&
                  ` · next ${when(task.nextRunAt)}`}
              </p>

              {detailFor?.({ id: task.id, running: task.running })}
            </div>

            {/* ONE BUTTON SHOWING WHAT IS SET, and the choice behind it.
                A bare time field could only ever say "once a day, at this
                time" — and half of this work wants to be current rather than
                punctual, or wants a morning and an evening pass. */}
            <Button
              variant="secondary"
              icon={<CalendarClock size={14} />}
              className="shrink-0"
              title="Choose how often this runs"
              onClick={() => setEditing(task.id)}
            >
              {describeCron(task.cron)}
            </Button>

            {/* A SWITCH, not a tick. This control IS the setting — the task is
                on now, or it is not — where a checkbox says "include this in
                what I am about to submit". It announces as on/off to a screen
                reader for the same reason. */}
            <Switch
              compact
              checked={task.enabled}
              disabled={busy === task.id}
              label={task.enabled ? 'On' : 'Off'}
              onChange={next => {
                // A task cannot be turned on without a schedule, so this opens
                // the dialog rather than failing with a toast.
                if (next && !task.cron) {
                  setEditing(task.id)

                  return
                }

                void save(task.id, next, task.cron)
              }}
            />

            <Button
              variant="secondary"
              icon={<Play size={14} />}
              loading={busy === task.id && task.running}
              disabled={busy !== null || task.running}
              title="Run this now, exactly as the schedule would"
              onClick={() => void runNow(task.id, task.label)}
            >
              Run now
            </Button>

            {/* ONLY BESIDE A FAILURE, which is the whole of its meaning. A
                failed task holds up everything after it, and some failures —
                a login that needs a person — cannot clear themselves. This is
                the way out that is still a decision rather than a silence. */}
            {task.lastStatus === 'failed' && (
              <Button
                variant="secondary"
                icon={<SkipForward size={14} />}
                className="shrink-0"
                disabled={busy !== null || task.running}
                title="Pass over this failed run so the tasks after it can continue"
                onClick={() => setConfirmSkip(task.id)}
              >
                Skip this run
              </Button>
            )}

            {/* Every run of this task, from the local database. The line above
                carries the last one; this answers "has it been failing all
                week", which the card cannot. */}
            <Button
              variant="secondary"
              icon={<History size={14} />}
              className="shrink-0"
              title="Every run of this task on this machine"
              onClick={() => setHistoryFor(task.id)}
            >
              History
            </Button>
          </div>
        ))}
      </div>

      {/* Keyed and mounted only while open, so its fields seed from the stored
          schedule once — no effect syncing props into state, and no draft left
          over from the last task that was opened. */}
      {/* Keyed per task and mounted only while open, so it reads the history
          once on open rather than holding a stale copy. */}
      {historyFor !== null && (
        <CronHistoryModal
          key={`history-${historyFor}`}
          open
          taskId={historyFor}
          taskLabel={tasks.find(task => task.id === historyFor)?.label ?? historyFor}
          onClose={() => setHistoryFor(null)}
        />
      )}

      {editing && (
        <CronModal
          key={editing}
          open
          taskLabel={tasks.find(task => task.id === editing)?.label ?? ''}
          cron={tasks.find(task => task.id === editing)?.cron ?? null}
          onCancel={() => setEditing(null)}
          onSave={cron => {
            const task = tasks.find(entry => entry.id === editing)

            // Saving a schedule from the dialog turns the task ON: choosing
            // when something should run and then having to flick a switch is a
            // second step nobody expects.
            void save(editing, task?.enabled ?? true, cron)
          }}
        />
      )}

      <ConfirmDialog
        open={confirmSkip !== null}
        title="Skip this run?"
        message={
          `${tasks.find(task => task.id === confirmSkip)?.label ?? 'This task'} failed, and ` +
          'nothing after it will run until it succeeds. Skipping records this run as passed ' +
          'over and lets the rest continue. The work this run would have done does not happen, ' +
          'and the task tries again at its next scheduled time.'
        }
        confirmLabel="Skip this run"
        busy={skipping}
        onConfirm={() => {
          const id = confirmSkip

          if (id) void skip(id, tasks.find(task => task.id === id)?.label ?? id)
        }}
        onCancel={() => setConfirmSkip(null)}
      />

      <ConfirmDialog
        open={confirmReset}
        title="Reset the schedule?"
        message={
          'Every automation goes back on, at the time this app ships with — logins hourly, ' +
          'the AJIO report sync at 10:00, Refill Data at 23:00, and Auto claim every 2 hours. ' +
          'Auto claim files real claims, so this starts work as well as changing times. ' +
          'What each task has already done is kept.'
        }
        confirmLabel="Reset"
        busy={resetting}
        onConfirm={() => void reset()}
        onCancel={() => setConfirmReset(false)}
      />
    </Card>
  )
}
