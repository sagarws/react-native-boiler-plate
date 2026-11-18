import { describe, expect, it } from 'vitest'
import {
  SCHEDULED_TASK_IDS,
  SCHEDULED_TASK_INFO,
  isScheduledTaskId,
  scheduledTaskInfo
} from '@shared/constants/automationSchedule'
import { isRunDue, isValidSyncTime, nextRunAt } from '@shared/utils/importSchedule'
import { isValidCron } from '@shared/utils/cronSchedule'
import type { ScheduledTaskId } from '@shared/types/automationSchedule'

/**
 * The nightly schedule, as a set of rules rather than a timer.
 *
 * A schedule's failure mode is SILENCE: it stops running and looks exactly like
 * a schedule that ran and found nothing to do. Nobody notices for a week. So the
 * rules that decide whether a run is owed are pinned here, along with the two
 * facts about the registry that stop a task being unreachable.
 */

const EVERY_TASK: ScheduledTaskId[] = [
  'session-refresh',
  'eligible-claims',
  'ajio-master-data',
  'snapdeal-master-data',
  'flipkart-master-data',
  'refill-data',
  'auto-claim',
  'status-change'
]

describe('the task registry', () => {
  it('describes every task, so none can be scheduled without a name', () => {
    expect(Object.keys(SCHEDULED_TASK_INFO).sort()).toEqual([...EVERY_TASK].sort())
  })

  it('runs sessions first, then eligible claims, the claims after Refill Data, and Status change last', () => {
    // Not a preference — it is the dependency order. Sessions before anything
    // that signs in; Refill Data before the claims, because it repairs the very
    // fields `selectionBlockReason` refuses a claim on. Backwards, a row blocked
    // at 03:00 for a missing POB ID waits a whole day to be filed.
    expect([...SCHEDULED_TASK_IDS]).toEqual([
      'session-refresh',
      'eligible-claims',
      'ajio-master-data',
      'snapdeal-master-data',
      'flipkart-master-data',
      'refill-data',
      'auto-claim',
      'status-change'
    ])
  })

  it('gives every task a distinct order, so the sequence is not left to chance', () => {
    const orders = EVERY_TASK.map(id => scheduledTaskInfo(id).order)

    expect(new Set(orders).size).toBe(orders.length)
  })

  it('ships a schedule for every task, and never two on the same minute', () => {
    // They share one browser and are serialised by the automation lock, so two
    // tasks at 23:00 is not two runs at once — it is one, and one queued behind
    // it having waited for nothing.
    const crons = EVERY_TASK.map(id => scheduledTaskInfo(id).defaultCron)
    const times = crons.flatMap(cron => (cron.kind === 'times' ? cron.times : []))

    for (const cron of crons) expect(isValidCron(cron)).toBe(true)
    for (const time of times) expect(isValidSyncTime(time)).toBe(true)
    expect(new Set(times).size).toBe(times.length)
  })

  it('arms what an operator would have chosen, out of the box', () => {
    // A machine with everything off does nothing all night and looks exactly
    // like one that works — so these are the shipped answers, and switching a
    // task OFF is the deliberate act.
    expect(scheduledTaskInfo('session-refresh').defaultCron).toEqual({
      kind: 'interval',
      everyMinutes: 60
    })
    expect(scheduledTaskInfo('ajio-master-data').defaultCron).toEqual({
      kind: 'times',
      times: ['10:00']
    })
    expect(scheduledTaskInfo('refill-data').defaultCron).toEqual({
      kind: 'times',
      times: ['23:00']
    })
    expect(scheduledTaskInfo('auto-claim').defaultCron).toEqual({
      kind: 'interval',
      everyMinutes: 120
    })
    expect(scheduledTaskInfo('status-change').defaultCron).toEqual({
      kind: 'times',
      times: ['13:00']
    })
  })

  it('refuses an id this build does not know', () => {
    // A stored record surviving a rename must not reach the registry lookup as
    // undefined and take a tick down with it.
    expect(isScheduledTaskId('auto-claim')).toBe(true)
    expect(isScheduledTaskId('claim-everything')).toBe(false)
    expect(isScheduledTaskId(null)).toBe(false)
  })
})

/**
 * When a run is owed.
 *
 * The same arithmetic the master import already uses, exercised here against the
 * cases this schedule actually meets — because "the laptop was shut" is the
 * normal case on an operator's machine, not the exception.
 */
describe('whether a run is owed', () => {
  /** 2026-09-18 02:00 IST, as an instant. */
  const at = (istHour: number, istMinute = 0, day = 18): number =>
    Date.UTC(2026, 8, day, istHour - 5, istMinute - 30)

  it('is not owed the moment a task is switched on', () => {
    // The baseline. Without it, arming a task at 09:00 fires the 02:00 run
    // immediately — a browser taking over the screen of whoever just used the
    // switch.
    const armedAt = at(9)

    expect(isRunDue('02:00', armedAt, at(9, 1))).toBe(false)
  })

  it('is owed once the scheduled moment passes', () => {
    const armedAt = at(9)

    expect(isRunDue('02:00', armedAt, at(2, 1, 19))).toBe(true)
  })

  it('still runs a window the machine slept through', () => {
    // Closed at midnight, opened at 09:00. A long timer would have been lost;
    // the question "is a run owed?" survives the lid being shut, which is the
    // whole reason this is a tick and not a setTimeout.
    const lastRun = at(2, 5, 17)

    expect(isRunDue('02:00', lastRun, at(9, 0, 18))).toBe(true)
  })

  it('does not run the same window twice', () => {
    const lastRun = at(2, 5)

    expect(isRunDue('02:00', lastRun, at(23, 0))).toBe(false)
  })

  it('does not drift later each day', () => {
    // A run that finished at 02:40 is still owed at 02:00 the NEXT day, rather
    // than 24 hours after it finished — which is how a nightly job walks into
    // the working day over a fortnight.
    const finishedLate = at(2, 40)

    expect(isRunDue('02:00', finishedLate, at(2, 1, 19))).toBe(true)
  })

  it('never fires a task with no time', () => {
    expect(isRunDue(null, 0, at(2, 1))).toBe(false)
    expect(isRunDue('25:00', 0, at(2, 1))).toBe(false)
    expect(nextRunAt(null)).toBeNull()
  })
})
