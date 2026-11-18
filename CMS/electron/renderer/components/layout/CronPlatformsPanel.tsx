import type { AutomationScheduleState, ScheduledTaskId } from '@shared/types/automationSchedule'
import { Badge } from '@renderer/components/ui/Badge'
import { AjioReportSyncStatus } from '@renderer/pages/settings/AjioReportSyncStatus'
import { AutoClaimTargets } from '@renderer/pages/settings/AutoClaimTargets'
import { RefillPassProgress } from '@renderer/pages/settings/RefillPassProgress'
import { RefillTargets } from '@renderer/pages/settings/RefillTargets'
import { SnapdealReportSyncStatus } from '@renderer/pages/settings/SnapdealReportSyncStatus'
import { FlipkartReportSyncStatus } from '@renderer/pages/settings/FlipkartReportSyncStatus'
import { StatusTargets } from '@renderer/pages/settings/StatusTargets'
import { SessionPlatformBoard } from './SessionPlatformBoard'

/**
 * What the schedule is doing, marketplace by marketplace.
 *
 * THE OTHER TABS ANSWER ABOUT TASKS. "Login update — last run: 2 updated, 4
 * failed, 2 timed out, 6 refused" is a complete account of a run and still
 * leaves the operator's actual question open: WHICH marketplace, and what do I
 * do about it. Worse, it reads as a contradiction — the task completed, and the
 * Sessions page is still red — when in fact the run did exactly what it said
 * and the refusals are the story.
 *
 * So this is the same four tasks, broken down the way the work is actually
 * organised: by marketplace, live, with the reason attached to anything that
 * did not work. Every panel here is the one already on the Settings page, which
 * is deliberate — two views of one run that disagree are worse than one view,
 * and these cannot disagree because they are the same component reading the
 * same events.
 *
 * It is a TAB rather than a section under each task because the tasks are
 * grouped by what they are doing (running, queued, scheduled) and the
 * marketplaces are not: a board split across three groups is not a board.
 */

const taskOf = (state: AutomationScheduleState, id: ScheduledTaskId) =>
  state.tasks.find(task => task.id === id) ?? null

const Section = ({
  title,
  running,
  note,
  children
}: {
  title: string
  running: boolean
  note?: string
  children: React.ReactNode
}) => (
  <section className='mb-4 last:mb-0'>
    <div className='mb-1.5 flex items-center gap-2'>
      <h3 className='text-xs font-semibold uppercase tracking-wide text-muted'>{title}</h3>
      {/* The app's own chip rather than a hand-rolled span: every colour and
          size here belongs to the theme, and `verify:tokens` is the gate that
          says so. */}
      {running && <Badge tone='success'>Running</Badge>}
    </div>
    {note && <p className='mb-1.5 text-xs text-muted'>{note}</p>}
    {children}
  </section>
)

export const CronPlatformsPanel = ({ state }: { state: AutomationScheduleState }) => {
  const eligible = taskOf(state, 'eligible-claims')
  const sessions = taskOf(state, 'session-refresh')
  const ajio = taskOf(state, 'ajio-master-data')
  const snapdeal = taskOf(state, 'snapdeal-master-data')
  const flipkart = taskOf(state, 'flipkart-master-data')
  const refill = taskOf(state, 'refill-data')
  const claims = taskOf(state, 'auto-claim')
  const status = taskOf(state, 'status-change')

  return (
    <div className='max-h-[var(--dialog-scroll-max)] overflow-y-auto pe-1'>
      {/* Task 0: everything below signs in, so the logins go first. */}
      <Section
        title='Login update'
        running={sessions?.running === true}
        note='Grey is nothing to do, red is a login to fix — with what the last run said about it — amber is a login the run skips and why, and the ringed one is being signed in now.'
      >
        <SessionPlatformBoard />
      </Section>

      {/* Task 1: straight after the Login update, on the logins it just checked. */}
      <Section
        title='Proceed eligible claims'
        running={eligible?.running === true}
        note='Claims that already hold the account, POB ID and sub-order number, filed straight after Login update. Red is outstanding, amber is waiting on a login, green is cleared.'
      >
        <AutoClaimTargets running={eligible?.running === true} taskId='eligible-claims' />
      </Section>

      <Section
        title='AJIO report sync'
        running={ajio?.running === true}
        note='The last window read into the local backup, per report.'
      >
        <AjioReportSyncStatus running={ajio?.running === true} />
      </Section>

      <Section
        title='Snapdeal report sync'
        running={snapdeal?.running === true}
        note='When rows last landed in the local backup, and the reports still being built.'
      >
        <SnapdealReportSyncStatus running={snapdeal?.running === true} />
      </Section>

      <Section
        title='Flipkart report sync'
        running={flipkart?.running === true}
        note='Rows held per report in the local backup, and the reports still being built.'
      >
        <FlipkartReportSyncStatus running={flipkart?.running === true} />
      </Section>

      <Section
        title='Refill Data'
        running={refill?.running === true}
        note='The blanks on a claim that is waiting to be filed.'
      >
        <RefillTargets running={refill?.running === true} />
        <div className='mt-2'>
          <RefillPassProgress running={refill?.running === true} phase='blanks' />
        </div>
      </Section>

      {/* In run order: Auto claim is task 6, Status change task 7. */}
      <Section
        title='Auto claim'
        running={claims?.running === true}
        note='Claims waiting per marketplace. Red is outstanding, amber is waiting on a login, green is cleared.'
      >
        <AutoClaimTargets running={claims?.running === true} />
      </Section>

      <Section
        title='Status change'
        running={status?.running === true}
        note='Every claim with a ticket, whatever its status — each AWB checked again once its sync window has passed.'
      >
        {/* The board between runs, the live chips during one — so every
            marketplace it covers is always on screen. */}
        <StatusTargets running={status?.running === true} />
        <RefillPassProgress running={status?.running === true} phase='status' />
      </Section>
    </div>
  )
}
