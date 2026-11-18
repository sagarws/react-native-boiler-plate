import { describe, expect, it } from 'vitest'
import type { TaskSnapshot } from '@shared/utils/cronQueue'
import { nextMonitorWake, nextToRun, nextTriggerAt, planQueue } from '@shared/utils/cronQueue'
import { classifyOutcome, needsRetry } from '@shared/utils/cronStatus'
import type { TaskOutcome } from '@shared/types/automationSchedule'

/**
 * The scheduler's two rules, which pull in opposite directions and are easy to
 * collapse into each other:
 *
 *   SCHEDULES ARE INDEPENDENT — a task never waits for another task's window.
 *   EXECUTION IS EXCLUSIVE    — and an unresolved failure blocks what follows.
 *
 * The failure mode worth a test is reading the second as the first: gate every
 * task on the one before it and the four independent schedules quietly become a
 * pipeline, in which Auto claim (every two hours) cannot run until the 23:00
 * Refill has, and therefore files claims once a day at best. Nothing throws;
 * the app simply does a quarter of the work it used to.
 */

const MINUTE = 60_000
const HOUR = 60 * MINUTE

/** 10:00 on an arbitrary day, as epoch ms. All cases are relative to this. */
const TEN_AM = Date.UTC(2026, 8, 20, 4, 30)

const task = (over: Partial<TaskSnapshot> & Pick<TaskSnapshot, 'id' | 'order'>): TaskSnapshot => ({
  label: String(over.id),
  enabled: true,
  cron: { kind: 'interval', everyMinutes: 120 },
  lastStatus: 'completed',
  lastSuccessAt: TEN_AM - 30 * MINUTE,
  lastAttemptAt: TEN_AM - 30 * MINUTE,
  consecutiveFailures: 0,
  occurrence: null,
  occurrenceHandled: false,
  ...over
})

const A = 'session-refresh' as const
const B = 'ajio-master-data' as const
const C = 'refill-data' as const
const D = 'auto-claim' as const

describe('schedules stay independent', () => {
  it('a task due now runs even though an earlier task is not due yet', () => {
    /*
     * THE CENTRAL CASE, stated in the requirement itself: A completed at 09:30
     * and runs every two hours, so its next window is 11:30. B is a fixed 10:00.
     * At 10:00 B runs. It must NOT wait for A's 11:30.
     */
    const tasks = [
      task({ id: A, order: 1, lastSuccessAt: TEN_AM - 30 * MINUTE, lastAttemptAt: TEN_AM - 30 * MINUTE }),
      task({
        id: B,
        order: 2,
        cron: { kind: 'times', times: ['10:00'] },
        occurrence: TEN_AM,
        occurrenceHandled: false,
        lastSuccessAt: TEN_AM - 24 * HOUR,
        lastAttemptAt: TEN_AM - 24 * HOUR
      })
    ]

    const plan = planQueue(tasks, TEN_AM)

    expect(plan.find(d => d.id === A)?.due).toBe(false)
    expect(plan.find(d => d.id === B)?.due).toBe(true)
    expect(nextToRun(tasks, TEN_AM)).toBe(B)
  })

  it('runs the earlier task first when BOTH are due', () => {
    // Deterministic priority: registry order, so the same two tasks falling due
    // in one minute always start in the same sequence.
    const tasks = [
      task({ id: B, order: 2, lastSuccessAt: TEN_AM - 5 * HOUR, lastAttemptAt: TEN_AM - 5 * HOUR }),
      task({ id: A, order: 1, lastSuccessAt: TEN_AM - 5 * HOUR, lastAttemptAt: TEN_AM - 5 * HOUR })
    ]

    expect(nextToRun(tasks, TEN_AM)).toBe(A)
  })

  it('never holds a task back because an earlier one is merely not due', () => {
    // The pipeline misreading.
    const tasks = [
      task({ id: A, order: 1, lastSuccessAt: TEN_AM - MINUTE, lastAttemptAt: TEN_AM - MINUTE }),
      task({ id: D, order: 4, lastSuccessAt: TEN_AM - 5 * HOUR, lastAttemptAt: TEN_AM - 5 * HOUR })
    ]

    const plan = planQueue(tasks, TEN_AM)

    expect(plan.find(d => d.id === D)?.eligible).toBe(true)
  })
})

describe('a failure holds nothing up — it is passed over, and retried', () => {
  it('leaves every task after a failure free to run', () => {
    /*
     * THE RULE NOW. A failed C does not stop D: the monitor passes over C and
     * runs D in the same pass. C is due again — it is retried on the next check.
     */
    const tasks = [
      task({ id: A, order: 1, lastSuccessAt: TEN_AM - 5 * HOUR, lastAttemptAt: TEN_AM - 5 * HOUR }),
      task({ id: C, order: 3, lastStatus: 'failed', consecutiveFailures: 1, lastAttemptAt: TEN_AM - 2 * HOUR }),
      task({ id: D, order: 4, lastSuccessAt: TEN_AM - 5 * HOUR, lastAttemptAt: TEN_AM - 5 * HOUR })
    ]

    const plan = planQueue(tasks, TEN_AM)

    expect(plan.find(d => d.id === A)?.eligible).toBe(true)
    expect(plan.find(d => d.id === C)?.eligible).toBe(true)
    expect(plan.find(d => d.id === D)?.eligible).toBe(true)
  })

  it('makes the failed task itself due, whatever its schedule says', () => {
    // It is retried rather than left for its next window.
    const tasks = [
      task({
        id: C,
        order: 3,
        cron: { kind: 'times', times: ['23:00'] },
        lastStatus: 'failed',
        consecutiveFailures: 1,
        lastAttemptAt: TEN_AM - 2 * HOUR,
        occurrence: null
      })
    ]

    expect(nextToRun(tasks, TEN_AM)).toBe(C)
  })

  it('marks a failed task as a retry', () => {
    const [decision] = planQueue(
      [task({ id: A, order: 1, lastStatus: 'failed', consecutiveFailures: 1, lastAttemptAt: TEN_AM - HOUR })],
      TEN_AM
    )

    expect(decision?.needsRecovery).toBe(true)
  })

  it('treats an incomplete run — started, never completed — as owed a re-run, and holds nothing up', () => {
    const tasks = [
      task({ id: B, order: 2, lastStatus: 'running' }),
      task({ id: D, order: 4, lastSuccessAt: TEN_AM - 5 * HOUR, lastAttemptAt: TEN_AM - 5 * HOUR })
    ]
    const plan = planQueue(tasks, TEN_AM)

    expect(plan.find(d => d.id === B)?.eligible).toBe(true)
    expect(plan.find(d => d.id === B)?.needsRecovery).toBe(true)
    expect(plan.find(d => d.id === D)?.eligible).toBe(true)
  })

  it('completed-with-errors is not a retry', () => {
    // Two of forty claims failing is ordinary: the run completed.
    const tasks = [
      task({ id: A, order: 1, lastStatus: 'completed_with_errors' }),
      task({ id: D, order: 4, lastSuccessAt: TEN_AM - 5 * HOUR, lastAttemptAt: TEN_AM - 5 * HOUR })
    ]
    const plan = planQueue(tasks, TEN_AM)

    expect(plan.find(d => d.id === A)?.needsRecovery).toBe(false)
    expect(plan.find(d => d.id === D)?.eligible).toBe(true)
  })

  it('a disabled task is never retried', () => {
    // Switched off is a decision, not a fault.
    const tasks = [task({ id: B, order: 2, enabled: false, lastStatus: 'failed', consecutiveFailures: 3 })]

    expect(planQueue(tasks, TEN_AM)[0]?.eligible).toBe(false)
  })
})

describe('when a task is due', () => {
  it('a task that has never run here is due immediately', () => {
    // No history means nothing has been done on this machine, which is the
    // strongest reason to run — not evidence of being up to date.
    const tasks = [task({ id: A, order: 1, lastStatus: null, lastSuccessAt: null, lastAttemptAt: null })]

    expect(nextToRun(tasks, TEN_AM)).toBe(A)
  })

  it('measures an interval from the last COMPLETION, not from app start', () => {
    // Completed 10:30, every 2h -> due 12:30. At 12:29 it is not due; at 12:30
    // it is. Measuring from start-up instead is what made the interval drift.
    const completed = TEN_AM + 30 * MINUTE
    const tasks = [
      task({
        id: A,
        order: 1,
        cron: { kind: 'interval', everyMinutes: 120 },
        lastSuccessAt: completed,
        lastAttemptAt: completed
      })
    ]

    expect(planQueue(tasks, completed + 2 * HOUR - MINUTE)[0]?.due).toBe(false)
    expect(planQueue(tasks, completed + 2 * HOUR)[0]?.due).toBe(true)
  })

  it('an interval missed while the machine was off is due the moment it is back', () => {
    // Completed 08:00, every 2h, machine off 09:00-11:00. At 11:00 the 10:00
    // run was missed and is owed — not silently lost.
    const completed = TEN_AM - 2 * HOUR
    const tasks = [
      task({
        id: A,
        order: 1,
        cron: { kind: 'interval', everyMinutes: 120 },
        lastSuccessAt: completed,
        lastAttemptAt: completed
      })
    ]

    expect(planQueue(tasks, TEN_AM + HOUR)[0]?.due).toBe(true)
  })

  it('a fixed-time slot runs once and is not repeated', () => {
    const base = {
      id: B,
      order: 2,
      cron: { kind: 'times' as const, times: ['10:00'] },
      occurrence: TEN_AM
    }

    expect(planQueue([task({ ...base, occurrenceHandled: false })], TEN_AM + 5 * MINUTE)[0]?.due).toBe(true)
    // Answered: the same slot must not come round again, even though it is
    // still "the most recent occurrence" for the rest of the day.
    expect(planQueue([task({ ...base, occurrenceHandled: true })], TEN_AM + 5 * MINUTE)[0]?.due).toBe(false)
  })

  it('a disabled task is never due', () => {
    const tasks = [task({ id: A, order: 1, enabled: false, lastStatus: null })]

    expect(planQueue(tasks, TEN_AM)[0]?.due).toBe(false)
    expect(nextToRun(tasks, TEN_AM)).toBeNull()
  })

  it('a task with no schedule is never due', () => {
    const tasks = [task({ id: A, order: 1, cron: null, lastStatus: null })]

    expect(planQueue(tasks, TEN_AM)[0]?.reason).toBe('no-schedule')
  })
})

describe('a failed task retries at once, and for ever', () => {
  it('is eligible again immediately after failing', () => {
    /*
     * THIS REVERSES A BACKOFF THAT WAS HERE, and the reason is the blocking.
     * Spacing retries out 1 → 5 → 15 → 60 minutes is polite to a marketplace
     * that is down — but a failed task holds every task behind it, so the wait
     * was not one task pausing. It was the AJIO sync, Refill Data and the
     * claims all standing still for an hour over one stale login.
     *
     * The tick is once a minute, so "immediately" is already rate-limited to
     * that; a task that takes three minutes to fail retries every three.
     */
    const failedAt = TEN_AM - 1000

    const tasks = [
      task({ id: A, order: 1, lastStatus: 'failed', consecutiveFailures: 1, lastAttemptAt: failedAt })
    ]

    expect(planQueue(tasks, TEN_AM)[0]?.eligible).toBe(true)
    expect(nextToRun(tasks, TEN_AM)).toBe(A)
  })

  it('keeps retrying however many times it has failed', () => {
    // Never gives up: the queue cannot move until this completes, so giving up
    // on the retry means giving up on everything after it.
    const tasks = [
      task({
        id: A,
        order: 1,
        lastStatus: 'failed',
        consecutiveFailures: 99,
        lastAttemptAt: TEN_AM - 1000
      })
    ]

    expect(planQueue(tasks, TEN_AM)[0]?.eligible).toBe(true)
  })

  it('never holds the tasks behind it, however often it keeps failing', () => {
    const tasks = [
      task({ id: A, order: 1, lastStatus: 'failed', consecutiveFailures: 5, lastAttemptAt: TEN_AM }),
      task({ id: D, order: 4, lastSuccessAt: TEN_AM - 5 * HOUR, lastAttemptAt: TEN_AM - 5 * HOUR })
    ]

    expect(planQueue(tasks, TEN_AM).find(d => d.id === D)?.eligible).toBe(true)
  })
})

describe('classifying what a run returned', () => {
  const outcome = (over: Partial<TaskOutcome>): TaskOutcome => ({
    detail: '',
    total: 0,
    succeeded: 0,
    failed: 0,
    summary: [],
    rows: [],
    ...over
  })

  it('calls a run in which nothing worked completed-with-errors, not failed', () => {
    /*
     * A CORRECTION TO WHAT THIS FILE USED TO PIN. It asserted `failed` here, on
     * the reasoning that a run achieving nothing is not a success. True — and
     * it is not called one: `completed_with_errors` is a distinct status and
     * the counts are on the row.
     *
     * But FAILED blocks the queue and retries for ever, and that is the wrong
     * answer to "every account said no". Seen in the field: three Myntra logins
     * answered "auto-login is turned off in Monitor" and one Snapdeal login
     * answered "OTP required". Four answers, none of them a fault in the run —
     * yet the cron blocked the three tasks behind it and re-ran itself every
     * sixty seconds, driving a browser at Snapdeal's login once a minute to be
     * told the same thing.
     *
     * Completing is the run reaching the end of its work. Whether the work
     * succeeded is a separate question, and it belongs to the items.
     */
    expect(classifyOutcome(outcome({ total: 40, succeeded: 0, failed: 40 }))).toBe(
      'completed_with_errors'
    )
  })

  it('does not block the queue when every item failed', () => {
    // The half that matters: the cron completed, so the tasks behind it run.
    expect(needsRetry(classifyOutcome(outcome({ total: 4, succeeded: 0, failed: 4 })))).toBe(false)
  })

  it('calls a partly-successful run completed-with-errors', () => {
    expect(classifyOutcome(outcome({ total: 40, succeeded: 38, failed: 2 }))).toBe(
      'completed_with_errors'
    )
  })

  it('calls a clean run completed', () => {
    expect(classifyOutcome(outcome({ total: 40, succeeded: 40, failed: 0 }))).toBe('completed')
  })

  it('calls a run with nothing to do completed', () => {
    // A quiet night is not an error, and treating it as one would block the
    // queue every time a marketplace had no rows waiting.
    expect(classifyOutcome(outcome({ total: 0 }))).toBe('completed')
  })
})

describe('when a task next triggers, from the clock and its schedule', () => {
  it('an interval: the last completion plus the interval', () => {
    // Completed 30 minutes ago, every two hours → 90 minutes from now.
    expect(nextTriggerAt(task({ id: 'auto-claim', order: 6 }), TEN_AM)).toBe(TEN_AM + 90 * MINUTE)
  })

  it('a fixed time later today: that time, IST', () => {
    const sync = task({
      id: 'snapdeal-master-data',
      order: 3,
      cron: { kind: 'times', times: ['11:00'] }
    })

    expect(nextTriggerAt(sync, TEN_AM)).toBe(TEN_AM + HOUR)
  })

  it('a fixed time already answered today: the same time tomorrow', () => {
    const sync = task({
      id: 'ajio-master-data',
      order: 2,
      cron: { kind: 'times', times: ['09:00'] },
      occurrence: TEN_AM - HOUR,
      occurrenceHandled: true
    })

    expect(nextTriggerAt(sync, TEN_AM)).toBe(TEN_AM + 23 * HOUR)
  })

  it('the soonest of several times', () => {
    const sync = task({
      id: 'ajio-master-data',
      order: 2,
      cron: { kind: 'times', times: ['22:00', '10:45'] },
      occurrence: null
    })

    expect(nextTriggerAt(sync, TEN_AM)).toBe(TEN_AM + 45 * MINUTE)
  })

  it('due now when it has never run, or failed, or a slot went unanswered', () => {
    expect(nextTriggerAt(task({ id: 'refill-data', order: 4, lastStatus: null }), TEN_AM)).toBe(TEN_AM)
    expect(nextTriggerAt(task({ id: 'refill-data', order: 4, lastStatus: 'failed' }), TEN_AM)).toBe(TEN_AM)
    expect(
      nextTriggerAt(
        task({
          id: 'refill-data',
          order: 4,
          cron: { kind: 'times', times: ['09:00'] },
          occurrence: TEN_AM - HOUR,
          occurrenceHandled: false
        }),
        TEN_AM
      )
    ).toBe(TEN_AM)
  })

  it('never, when the task is off', () => {
    expect(nextTriggerAt(task({ id: 'auto-claim', order: 6, enabled: false }), TEN_AM)).toBeNull()
  })
})

describe('when the monitor next wakes', () => {
  const ROUTINE = 30 * MINUTE

  it('at the soonest trigger when it comes before the routine check', () => {
    const wake = nextMonitorWake(
      [
        task({ id: 'session-refresh', order: 1, cron: { kind: 'interval', everyMinutes: 60 }, lastSuccessAt: TEN_AM - 50 * MINUTE }),
        task({ id: 'auto-claim', order: 6 })
      ],
      TEN_AM,
      ROUTINE
    )

    expect(wake).toEqual({ at: TEN_AM + 10 * MINUTE, taskId: 'session-refresh' })
  })

  it('at the routine check when every trigger is further away', () => {
    expect(nextMonitorWake([task({ id: 'auto-claim', order: 6 })], TEN_AM, ROUTINE)).toEqual({
      at: TEN_AM + ROUTINE,
      taskId: null
    })
  })

  it('not at once for a task that is due but could not run — that would be a loop', () => {
    const failed = task({ id: 'session-refresh', order: 1, lastStatus: 'failed' })

    expect(nextMonitorWake([failed], TEN_AM, ROUTINE).at).toBe(TEN_AM + ROUTINE)
  })
})

