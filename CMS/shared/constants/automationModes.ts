/**
 * THE TWO KINDS OF AUTOMATION IN THIS APP — the vocabulary every run is
 * described in, from the monitor's decision to the history row it leaves.
 *
 * Both are started by the automation monitor (`monitor.service.ts`) and by
 * nothing else, both run one task at a time in dependency order, and both stop
 * the moment Automations are switched off. What differs is WHY a task runs.
 *
 *   SCHEDULE   The schedule says it is owed. The monitor wakes at a task's
 *              trigger time — a fixed time of day (IST), or its interval after
 *              the last completion — or at its routine check, and runs what is
 *              due: a slot that has come round, an interval that has elapsed, a
 *              slot missed while the app was closed (caught up at launch and
 *              sign-in), a retry after a failure, or the re-run of a run left
 *              incomplete. The master import's times come from TrackVid; the
 *              report queue's checks are always this kind.
 *
 *   TOGGLE_ON  Automations were switched from OFF to ON. Every enabled task
 *              runs once, straight away, from the top — whatever its schedule
 *              says — and then the master import of every platform routed to
 *              this machine.
 *
 * IN BOTH, A FAILURE IS PASSED OVER. A task that fails (or is left incomplete)
 * holds nothing up: the tasks after it run in the same pass, and the failed one
 * is retried on the monitor's next check.
 *
 * NOT AN AUTOMATION: Run now. A person pressing a button runs that one task
 * through the monitor too, and is recorded as `manual` beside these two so a
 * history row always says which of the three started it.
 */
export const AUTOMATION_MODES = {
  SCHEDULE: 'schedule',
  TOGGLE_ON: 'toggle-on'
} as const

export type AutomationMode = (typeof AUTOMATION_MODES)[keyof typeof AUTOMATION_MODES]

/** What started one run: one of the two automations, or a person. */
export type RunTrigger = AutomationMode | 'manual'

/** What the history table calls each. */
export const RUN_TRIGGER_LABEL: Record<RunTrigger, string> = {
  schedule: 'Schedule',
  'toggle-on': 'Toggle on',
  manual: 'Run now'
}
