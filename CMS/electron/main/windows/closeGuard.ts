import { dialog, type BrowserWindow } from 'electron'
import { CLOSE_GUARD_EVENTS } from '@shared/constants/channels'
import type { CloseGuardRequest } from '@shared/types/closeGuard'
import { requestScheduleStop } from '../services/schedulerPause.store'
import { logger } from '../services/logger'

/**
 * Asking the operator before the window closes on a running automation.
 *
 * THE APP'S OWN DIALOG FIRST. It is drawn by the page, in the app's look, and
 * names what is running. The operating system's message box is kept only as the
 * fallback for a page that cannot answer — crashed, still loading, or hung — so
 * a close is never left with nobody to ask: the page has `ACK_MS` to say it is
 * showing the dialog, and if it does not, the native box appears instead.
 */

const ACK_MS = 1500

let target: BrowserWindow | null = null
let quitting = false
let ackTimer: NodeJS.Timeout | null = null

/** True once the operator chose to quit — the close handler must let it through. */
export const isQuitting = (): boolean => quitting

/** "Quit anyway": stop the scheduler between steps, then close for real. */
export const quitAnyway = (holder: string): void => {
  if (!target || target.isDestroyed()) return

  /*
   * ASKED TO STOP, not just abandoned. The runners check this between accounts
   * and between marketplaces, so the step in flight finishes and nothing
   * further starts. It cannot make a half-submitted claim safe — nothing can —
   * but it stops the next one from being started on the way out.
   */
  requestScheduleStop()
  logger.warn('Quitting while an automation was running — asked it to stop', { holder })

  quitting = true
  target.close()
}

/** The page says its dialog is on screen: no native fallback is needed. */
export const acknowledgeClosePrompt = (): void => {
  if (ackTimer) clearTimeout(ackTimer)
  ackTimer = null
}

const nativePrompt = (window: BrowserWindow, holder: string): void => {
  void dialog
    .showMessageBox(window, {
      type: 'warning',
      buttons: ['Wait', 'Quit anyway'],
      defaultId: 0,
      cancelId: 0,
      title: 'A background process is running',
      message: `${holder} is still running.`,
      detail:
        'Closing now can stop it part-way through. A claim that was being filed may ' +
        'already exist on the marketplace without this app recording it, and the next ' +
        'run would file it again.\n\nWait for it to finish, or watch it from the ' +
        'Background Process page.'
    })
    .then(({ response }) => {
      if (response === 1) quitAnyway(holder)
    })
    .catch((error: unknown) => logger.error('Could not ask about quitting', error))
}

/** Ask the operator what to do about `holder`, which is still running. */
export const promptClose = (window: BrowserWindow, holder: string): void => {
  target = window

  const contents = window.webContents

  if (contents.isCrashed() || contents.isLoading()) {
    nativePrompt(window, holder)

    return
  }

  if (ackTimer) clearTimeout(ackTimer)

  ackTimer = setTimeout(() => {
    ackTimer = null
    logger.warn('[close] the page did not answer — asking with the system dialog')
    nativePrompt(window, holder)
  }, ACK_MS)

  const request: CloseGuardRequest = { holder }

  contents.send(CLOSE_GUARD_EVENTS.requested, request)
}
