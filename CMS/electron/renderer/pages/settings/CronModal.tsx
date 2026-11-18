import { useState } from 'react'
import { Plus, RotateCw, Timer, Trash2 } from 'lucide-react'
import type { CronSchedule } from '@shared/utils/cronSchedule'
import {
  MIN_INTERVAL_MINUTES,
  clockFromMinutes,
  cronProblem,
  minutesFromClock,
  normaliseCron
} from '@shared/utils/cronSchedule'
import { Button } from '@renderer/components/ui/Button'
import { Modal } from '@renderer/components/ui/Modal'
import { Input } from '@renderer/components/ui/Input'
import { classNames } from '@renderer/utils/format'

/**
 * Setting how often one task runs — the two ways, asked as one question.
 *
 * WHY A DIALOG AND NOT A FIELD. The card used to carry a bare time input per
 * task, which could only ever express "once a day, at this time". Half the work
 * here does not want that: a session check wants to be CURRENT, not punctual,
 * and a report sync may want a morning and an evening pass. Neither fits a
 * single box, and adding a second box to the row would ask every operator to
 * think about intervals whether or not they wanted one.
 *
 * So the row keeps one button showing what is set, and the choice happens here,
 * in the order it is actually made: which kind first, then the detail for that
 * kind, and nothing about the other.
 *
 * THE FORM VALIDATES WITH THE SAME FUNCTION THE MAIN PROCESS USES. `cronProblem`
 * is shared, so what this refuses and what the scheduler refuses cannot drift —
 * and the operator is told before saving rather than by a toast afterwards.
 */

interface Props {
  open: boolean
  taskLabel: string
  /** What is already set, or null for a task that has never been scheduled. */
  cron: CronSchedule | null
  onCancel: () => void
  onSave: (cron: CronSchedule) => void
}

/** A sensible first row, so the dialog opens on something valid. */
const DEFAULT_TIME = '02:00'
const DEFAULT_INTERVAL = '00:15'

export const CronModal = ({ open, taskLabel, cron, onCancel, onSave }: Props) => {
  /**
   * Seeded from what is stored, once, when the dialog is mounted.
   *
   * The parent mounts this only while `open`, with a key per task, so there is
   * no effect syncing props into state and no stale draft from the last task
   * the operator opened.
   */
  const [kind, setKind] = useState<CronSchedule['kind']>(cron?.kind ?? 'times')
  const [interval, setInterval] = useState(
    cron?.kind === 'interval' ? clockFromMinutes(cron.everyMinutes) : DEFAULT_INTERVAL
  )
  const [times, setTimes] = useState<string[]>(
    cron?.kind === 'times' && cron.times.length > 0 ? [...cron.times] : [DEFAULT_TIME]
  )

  if (!open) return null

  const draft: CronSchedule =
    kind === 'interval'
      ? { kind: 'interval', everyMinutes: minutesFromClock(interval) ?? 0 }
      : { kind: 'times', times }

  const problem = cronProblem(draft)

  const setTimeAt = (index: number, value: string): void =>
    setTimes(current => current.map((time, at) => (at === index ? value : time)))

  return (
    <Modal
      open
      title={`Set cron — ${taskLabel}`}
      description="Times are IST. The app has to be open for a run to happen, and a window it missed is picked up the next time it opens."
      onClose={onCancel}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button disabled={problem !== null} onClick={() => onSave(normaliseCron(draft))}>
            Save cron
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        {/* THE QUESTION, first and on its own. Everything below depends on it. */}
        <fieldset className="flex flex-col gap-2">
          <legend className="text-xs font-medium text-body">How should this run?</legend>

          <div className="grid grid-cols-2 gap-2">
            {(
              [
                {
                  value: 'interval' as const,
                  icon: RotateCw,
                  title: 'Rotate',
                  blurb: 'Every so often, round the clock'
                },
                {
                  value: 'times' as const,
                  icon: Timer,
                  title: 'Fixed time',
                  blurb: 'At the times you choose'
                }
              ]
            ).map(option => (
              <button
                key={option.value}
                type="button"
                onClick={() => setKind(option.value)}
                className={classNames(
                  'flex flex-col gap-1 rounded-md border p-3 text-left transition',
                  kind === option.value
                    ? 'border-accent bg-accent-soft ring-1 ring-accent'
                    : 'border-subtle hover:border-strong'
                )}
              >
                <span className="flex items-center gap-2 text-xs font-semibold text-textPrimary">
                  <option.icon size={14} aria-hidden="true" />
                  {option.title}
                </span>
                <span className="text-2xs text-muted">{option.blurb}</span>
              </button>
            ))}
          </div>
        </fieldset>

        {kind === 'interval' ? (
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-body" htmlFor="cron-interval">
              Run every
            </label>
            <Input
              id="cron-interval"
              type="time"
              className="h-8 w-32 text-xs"
              value={interval}
              onChange={event => setInterval(event.target.value)}
            />
            <p className="text-2xs text-muted">
              Hours and minutes — 00:15 is every fifteen minutes. Counted from the end of the last
              run, so a long run does not immediately owe another. Minimum{' '}
              {MIN_INTERVAL_MINUTES} minutes.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <span className="text-xs font-medium text-body">Run at</span>

            {times.map((time, index) => (
              // Index as key is right here and nowhere else: these rows have no
              // identity of their own, and the list is only ever appended to or
              // shortened by the buttons beside it.
              <div key={index} className="flex items-center gap-2">
                <span className="w-4 text-right text-2xs tabular-nums text-faint">
                  {index + 1}
                </span>
                <Input
                  type="time"
                  aria-label={`Time ${index + 1}`}
                  className="h-8 w-32 text-xs"
                  value={time}
                  onChange={event => setTimeAt(index, event.target.value)}
                />
                {/* The last one cannot be removed: a fixed-time schedule with no
                    times is not a schedule, and the switch would have nothing
                    to turn on. */}
                {times.length > 1 && (
                  <button
                    type="button"
                    aria-label={`Remove time ${index + 1}`}
                    className="rounded p-1 text-faint hover:text-danger-fg"
                    onClick={() => setTimes(current => current.filter((_, at) => at !== index))}
                  >
                    <Trash2 size={14} aria-hidden="true" />
                  </button>
                )}
              </div>
            ))}

            <Button
              variant="secondary"
              size="sm"
              icon={<Plus size={14} />}
              className="h-7 w-fit px-2 text-2xs"
              onClick={() => setTimes(current => [...current, DEFAULT_TIME])}
            >
              Add another time
            </Button>
          </div>
        )}

        {/* Said before saving, not after: the same function the main process
            checks with, so this cannot promise something the scheduler refuses. */}
        {problem && (
          <p className="rounded-md bg-warning-surface px-3 py-2 text-xs text-warning-fg ring-1 ring-inset ring-warning-border">
            {problem}
          </p>
        )}

      </div>
    </Modal>
  )
}
