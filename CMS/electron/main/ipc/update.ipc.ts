import { UPDATE_CHANNELS } from '@shared/constants/channels'
import { fail, ok } from '@shared/types/result'
import {
  checkForUpdates,
  getUpdateState,
  quitAndInstall,
  getUpdateLog,
  reinstallCurrentVersion
} from '../services/updater.service'
import { registerHandler } from './handler'

/**
 * Three verbs only. Progress is not polled - it arrives on the
 * UPDATE_EVENTS.status push channel, which the preload exposes through
 * subscribe() rather than invoke().
 */
export const registerUpdateIpc = (): void => {
  // Lets a window that mounted after the first events still render the right
  // state, without asking the updater to check again.
  registerHandler(UPDATE_CHANNELS.status, () => Promise.resolve(ok(getUpdateState())))
  // Read on demand rather than pushed: nobody watches this, they open it after
  // something has already gone wrong.
  registerHandler(UPDATE_CHANNELS.log, () => Promise.resolve(ok(getUpdateLog())))

  registerHandler(UPDATE_CHANNELS.check, async () => ok(await checkForUpdates()))

  // Resolves only when it fails: on success the app is already quitting.
  registerHandler(UPDATE_CHANNELS.reinstall, async () => {
    const outcome = await reinstallCurrentVersion()

    return outcome.success ? ok({ version: outcome.version }) : fail('INTERNAL_ERROR', outcome.message)
  })

  registerHandler(UPDATE_CHANNELS.install, () => {
    quitAndInstall()
    return Promise.resolve(ok({ installing: true }))
  })
}
