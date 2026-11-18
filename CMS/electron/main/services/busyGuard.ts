import { automationHolder } from './automationLock'
import { isScheduleRunning } from './automationScheduler.service'

/**
 * Is this machine in the middle of something it must not be interrupted for?
 *
 * WHAT COUNTS. Everything that drives a browser takes `withAutomationLock`
 * before it starts and releases it when it stops — a claim being filed, a
 * marketplace being signed in to, a bulk run, a report sync. That lock's holder
 * IS the answer, which is why this asks it rather than keeping a second list
 * that would need a line adding every time an automation is written.
 *
 * `isScheduleRunning` is the second half: a scheduled task between two of its
 * own steps has released the lock for a moment and is still very much running.
 *
 * WHY IT MATTERS AT QUIT. These runs end at a marketplace, not here. Closing
 * the app part-way through filing a claim can leave a ticket raised on the
 * marketplace with nothing recorded against it on this machine — and the next
 * run, seeing a claim it believes was never filed, files it a second time.
 */
export interface BusyState {
  busy: boolean
  /** What to name in the dialog — "Auto claim", "Snapdeal session capture". */
  holder: string | null
}

export const busyState = (): BusyState => {
  const holder = automationHolder()

  if (holder) return { busy: true, holder }

  // Between steps of a scheduled task: the lock is free, the run is not over.
  if (isScheduleRunning()) return { busy: true, holder: 'A scheduled automation' }

  return { busy: false, holder: null }
}
