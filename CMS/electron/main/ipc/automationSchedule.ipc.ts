import { AUTOMATION_SCHEDULE_CHANNELS } from '@shared/constants/channels'
import {
  runTaskNow,
  saveTaskSchedule,
  scheduleState,
  resetSchedule,
  setSchedulePaused,
  skipBlockedRun,
  skipRunningTask,
  skipRunningPlatform,
  taskHistory
} from '../services/automationScheduler.service'
import {
  autoClaimTargets,
  refillTargets,
  resetRefillAttempts,
  statusTargets
} from '../services/pendingClaims.service'
import { clearCronLog, readCronLog } from '../services/cronLog.store'
import { ok } from '@shared/types/result'
import { registerHandler } from './handler'

export const registerAutomationScheduleIpc = (): void => {
  registerHandler(AUTOMATION_SCHEDULE_CHANNELS.state, () => scheduleState())
  registerHandler(AUTOMATION_SCHEDULE_CHANNELS.save, payload => saveTaskSchedule(payload))
  registerHandler(AUTOMATION_SCHEDULE_CHANNELS.runNow, payload => runTaskNow(payload))
  // No payload: it is one question with one answer, and narrowing it by
  // platform would let the card ask about a set the run does not use.
  registerHandler(AUTOMATION_SCHEDULE_CHANNELS.autoClaimTargets, () => autoClaimTargets())
  // The refill's own count, not the claim run's: the two disagree about a row
  // with no account on purpose — see summariseRefillTargets.
  registerHandler(AUTOMATION_SCHEDULE_CHANNELS.refillTargets, () => refillTargets())
  // Every claim with a ticket, per platform: due now or still inside the window.
  registerHandler(AUTOMATION_SCHEDULE_CHANNELS.statusTargets, () => statusTargets())
  // Lets a marketplace's retired rows back into the nightly refill.
  registerHandler(AUTOMATION_SCHEDULE_CHANNELS.resetRefillAttempts, payload =>
    resetRefillAttempts(payload)
  )
  // One press back to the schedule a fresh machine gets — see resetSchedule.
  registerHandler(AUTOMATION_SCHEDULE_CHANNELS.reset, () => resetSchedule())
  // The master switch. Stops every task at once, or starts them catching up.
  registerHandler(AUTOMATION_SCHEDULE_CHANNELS.setPaused, payload => setSchedulePaused(payload))
  // Straight from the local database: the rows outlive the process, and a
  // crash is the case the history exists to explain.
  registerHandler(AUTOMATION_SCHEDULE_CHANNELS.history, payload => taskHistory(payload))
  // A person deciding, once, to pass over a failure that cannot recover on its
  // own. Recorded as `skipped` — never automatic. See skipBlockedRun.
  registerHandler(AUTOMATION_SCHEDULE_CHANNELS.skip, payload => skipBlockedRun(payload))
  // The running one, cut short so the queue moves on. See skipRunningTask.
  registerHandler(AUTOMATION_SCHEDULE_CHANNELS.skipRunning, payload => skipRunningTask(payload))
  // One marketplace on the running task, the rest of it carrying on.
  registerHandler(AUTOMATION_SCHEDULE_CHANNELS.skipPlatform, payload =>
    skipRunningPlatform(payload)
  )
  // The narration: what the scheduler did, and what it decided not to do.
  registerHandler(AUTOMATION_SCHEDULE_CHANNELS.log, async () => ok(await readCronLog()))
  registerHandler(AUTOMATION_SCHEDULE_CHANNELS.clearLog, async () => {
    await clearCronLog()

    return ok(true)
  })
}
