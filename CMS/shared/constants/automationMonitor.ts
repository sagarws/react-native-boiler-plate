/**
 * The longest the automation monitor ever sleeps between checks.
 *
 * THE MONITOR IS THE ONLY CLOCK THE NIGHTLY AUTOMATIONS HAVE. No task arms a
 * timer of its own: `monitor.service.ts` works out each task's next trigger
 * from the system clock and its schedule — a fixed time of day (IST), or the
 * last completion plus an interval — and wakes at the soonest one. A task
 * starts only because a monitor pass found it due.
 *
 * THIS IS THE ROUTINE CHECK BESIDE THOSE TRIGGERS, never a delay on them. A
 * 10:00 sync still starts at 10:00. What waits for this check is work that was
 * due but could not start — a failure to retry, a machine that was offline, a
 * browser in use, a task blocked behind another — and it is the safety net for
 * a wake-up lost while the machine slept.
 */
export const AUTOMATION_MONITOR_INTERVAL_MINUTES = 30

export const AUTOMATION_MONITOR_INTERVAL_MS = AUTOMATION_MONITOR_INTERVAL_MINUTES * 60 * 1000

/**
 * How long Automations are held OFF at launch before being switched back on.
 *
 * EVERY START IS A SWITCH-ON. The app turns Automations off, waits this long,
 * and turns them on through the same path as the operator's toggle — so a
 * launch runs the TOGGLE_ON automation (every task, one at a time, and the
 * master import), whatever the switch was left at last time.
 */
export const AUTOMATION_LAUNCH_OFF_MS = 2000
