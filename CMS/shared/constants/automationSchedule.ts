import type { ScheduledTaskId } from '@shared/types/automationSchedule'
import type { CronSchedule } from '@shared/utils/cronSchedule'

/**
 * What each scheduled automation IS — its name, its place in the night, and
 * what it costs to get wrong.
 *
 * Deliberately separate from the code that runs it. This half is shared, so the
 * settings card can describe a task without asking the main process; the other
 * half is one adapter per task in `automationTasks.ts`, which is the only place
 * that knows a service's signature. Adding a fifth automation is an entry here
 * and an adapter there — no change to the scheduler, the store, the Jobs page or
 * the card, none of which know what tasks exist.
 */

export interface ScheduledTaskInfo {
  id: ScheduledTaskId
  label: string
  description: string
  /** The marketplace it belongs to, or "All" where it spans them. For the Jobs row. */
  platform: string
  /**
   * The order tasks run in when more than one is due at once. Lower first.
   *
   * NOT a preference — it is the dependency order, and running it backwards
   * wastes the night:
   *
   *   0. Sessions, because everything below signs in — the eligible claims
   *      included, so they file on logins that were just checked rather than
   *      passing over every claim whose session lapsed since the last pass.
   *   1. Proceed eligible claims, on the rows that are ALREADY fileable —
   *      account, POB ID and sub-order number all present. They need nothing
   *      the steps below provide, so they file straight after the logins,
   *      instead of waiting behind a night of syncs and refills.
   *   2. The AJIO backup, because Refill Data answers from it.
   *   3. Refill Data, because it fills the blanks that BLOCK filing — a claim
   *      with no POB ID or no sub-order number is refused by
   *      `selectionBlockReason`, and refilling it after the claim run means
   *      waiting a day to file a row that was ready at 03:00.
   *   4. The claims, on rows the steps above just made fileable.
   *   5. Status change, last: it asks where filed tickets stand, so it runs
   *      after the claims run has filed this pass's.
   */
  order: number
  /**
   * WHAT THIS MACHINE DOES OUT OF THE BOX — armed on first run, not merely
   * offered when somebody switches the task on.
   *
   * An installation whose schedule is entirely off does nothing all night and
   * looks, to the operator, exactly like one that is working: the card says
   * "Has not run on this machine yet" either way. So the shipped answer is the
   * one an operator would have chosen, and switching a task OFF is the
   * deliberate act rather than switching it on.
   *
   * The two shapes carry different reasoning. An INTERVAL is for work that
   * wants to be current rather than punctual — sessions expire whenever they
   * expire, and claims arrive all day. A TIME is for work that belongs at an
   * hour: the AJIO report sync in the morning once the previous day has
   * settled, the refill sweep late so the claims run meets filled rows.
   *
   * Nothing here lands two browser jobs on the same minute. They are serialised
   * by the automation lock, so a collision is not two runs at once — it is one
   * run and one queued behind it, having waited for nothing.
   */
  defaultCron: CronSchedule
}

export const SCHEDULED_TASK_INFO: Record<ScheduledTaskId, ScheduledTaskInfo> = {
  'eligible-claims': {
    id: 'eligible-claims',
    label: 'Proceed eligible claims',
    description:
      'Files every Pending claim that already holds what the marketplace needs — the account, ' +
      'the POB ID, the sub-order number — straight after Login update, before the report syncs ' +
      'and Refill Data. A claim whose login is still expired is passed over, not charged an attempt.',
    platform: 'All',
    // Straight after Login update: these rows need nothing the tasks below
    // provide, so making them wait behind the report syncs and Refill Data
    // only delays them — but they do sign in, so the logins go first.
    order: 1,
    // Hourly: cheap when nothing is ready, and a claim that arrives complete
    // should not sit for the two hours Auto claim waits between passes.
    defaultCron: { kind: 'interval', everyMinutes: 60 }
  },
  'session-refresh': {
    id: 'session-refresh',
    label: 'Login update',
    description:
      'Re-captures marketplace logins that have expired or are about to. Runs first, because ' +
      'everything below it signs in.',
    platform: 'All',
    order: 0,
    // Hourly, because an expired session blocks everything below it and the
    // check itself is cheap when there is nothing to re-capture.
    defaultCron: { kind: 'interval', everyMinutes: 60 }
  },
  'ajio-master-data': {
    id: 'ajio-master-data',
    label: 'AJIO report sync',
    description:
      "Re-reads the last few days of AJIO's forward and return reports into the local backup, " +
      'so a claim can still be argued once the report window has moved on.',
    platform: 'Ajio',
    order: 2,
    // Morning: AJIO's previous day has settled by then, and Refill Data reads
    // this backup rather than the marketplace.
    defaultCron: { kind: 'times', times: ['10:00'] }
  },
  'snapdeal-master-data': {
    id: 'snapdeal-master-data',
    label: 'Snapdeal report sync',
    description:
      "Collects the Snapdeal return reports that have finished building, then asks for the last " +
      'few days again. Snapdeal builds a report over minutes rather than answering with it, so a ' +
      'pass banks what is ready before queueing more.',
    platform: 'Snapdeal',
    order: 3,
    // An hour after AJIO's. The reports this asks for are collected by the
    // NEXT pass as often as by this one, so the time matters less than the
    // gap — and sharing a minute with the AJIO sync would put two browser
    // automations behind one lock for no reason.
    defaultCron: { kind: 'times', times: ['11:00'] }
  },
  'flipkart-master-data': {
    id: 'flipkart-master-data',
    label: 'Flipkart report sync',
    description:
      "Collects the Flipkart Orders and Returns reports that have finished building, then asks " +
      'for the days since each was last stored. Keeps only the order item, SKU and the two AWBs, ' +
      'which is what Create Claim fills from.',
    platform: 'Flipkart',
    order: 4,
    // After Snapdeal's. HTTP only — it never signs in — so it holds no browser.
    defaultCron: { kind: 'times', times: ['12:00'] }
  },
  'refill-data': {
    id: 'refill-data',
    label: 'Refill Data',
    description:
      'Asks each marketplace for the blanks on claims that are waiting to be filed — the ' +
      'account, the POB ID, the sub-order number, the forward AWB. The claim status is its ' +
      'own task, below.',
    platform: 'All',
    order: 5,
    // Late, so the rows it fills are waiting for the next claim run rather
    // than a day behind it.
    defaultCron: { kind: 'times', times: ['23:00'] }
  },
  'status-change': {
    id: 'status-change',
    label: 'Status change',
    description:
      'Asks where each already-filed ticket now stands, and what was paid. Skips Pending, ' +
      'Failed to Proceed, Approved and Rejected — those have nothing filed yet, or cannot move.',
    platform: 'All',
    // Last: after the claims run, so a ticket filed this pass is already in
    // the list whose status it asks for.
    order: 7,
    // Midday: a ticket's state moves during the marketplace's working day, and
    // this keeps it clear of the late-night refill sweep.
    defaultCron: { kind: 'times', times: ['13:00'] }
  },
  'auto-claim': {
    id: 'auto-claim',
    label: 'Auto claim',
    description:
      'Files the Pending claims that are ready to file, on every platform. Failed to Proceed is left for you to fix and file from the Claims page. ' +
      'Skips any row the Claims page would refuse to tick — including one at the retry limit — ' +
      'so it can never raise a second ticket for a return.',
    platform: 'All',
    // Straight after Refill Data, on the rows it just made fileable.
    order: 6,
    // Through the day: claims arrive from TrackVid at any hour, and two hours
    // is often enough that nothing waits overnight without filing the same
    // rows repeatedly.
    defaultCron: { kind: 'interval', everyMinutes: 120 }
  }
}

/** Every task, in the order they run. */
export const SCHEDULED_TASK_IDS: readonly ScheduledTaskId[] = (
  Object.keys(SCHEDULED_TASK_INFO) as ScheduledTaskId[]
).sort((a, b) => SCHEDULED_TASK_INFO[a].order - SCHEDULED_TASK_INFO[b].order)

export const scheduledTaskInfo = (id: ScheduledTaskId): ScheduledTaskInfo =>
  SCHEDULED_TASK_INFO[id]

/** Whether a string names a task this build knows. Guards a stored id after a rename. */
export const isScheduledTaskId = (value: unknown): value is ScheduledTaskId =>
  typeof value === 'string' && value in SCHEDULED_TASK_INFO
