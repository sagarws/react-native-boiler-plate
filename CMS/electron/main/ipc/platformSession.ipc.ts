import { PLATFORM_SESSION_CHANNELS } from '@shared/constants/channels'
import {
  cancelCapture,
  captureSession,
  listPlatforms,
  sessionHealth,
  verifySessionHealth,
  pendingSessions,
  flushPendingSession,
  setCredentialOtpMode,
  clearPlatformSession,
  clearAllPlatformSessions
} from '../services/platformSession.service'
import { verifyCredential } from '../services/credentialVerify.service'
import { addCredential, removeCredential } from '../services/credentialManage.service'
import { peekLatestOtp } from '../services/otpSource'
import { revealCredentialPassword } from '../services/credentialSecret.service'
import { setAutoLogin } from '../services/automationRouting.service'
import { busyState } from '../services/busyGuard'
import { fail } from '@shared/types/result'
import { registerHandler } from './handler'

export const registerPlatformSessionIpc = (): void => {
  registerHandler(PLATFORM_SESSION_CHANNELS.list, () => Promise.resolve(listPlatforms()))
  // REFUSED WHILE SOMETHING ELSE IS RUNNING. A capture does not take the
  // automation lock — it guards itself per platform — so pressing Re-capture
  // during a claim run, a bulk run or the scheduled Session update replaced the
  // very session that run was using, part-way through it. Checked here, at the
  // operator's door, because the scheduled run calls `captureSession` directly
  // and must not refuse itself.
  registerHandler(PLATFORM_SESSION_CHANNELS.capture, (payload) => {
    const busy = busyState()

    if (busy.busy) {
      return Promise.resolve(
        fail('CONFLICT', `${busy.holder ?? 'Another automation'} is running — update the login when it ends`)
      )
    }

    return captureSession(payload)
  })
  registerHandler(PLATFORM_SESSION_CHANNELS.cancel, (payload) => Promise.resolve(cancelCapture(payload)))
  registerHandler(PLATFORM_SESSION_CHANNELS.health, () => sessionHealth())
  // Correct a refused login and prove it by signing in with it.
  registerHandler(PLATFORM_SESSION_CHANNELS.verifyCredential, payload => verifyCredential(payload))
  registerHandler(PLATFORM_SESSION_CHANNELS.addCredential, payload => addCredential(payload))
  registerHandler(PLATFORM_SESSION_CHANNELS.removeCredential, payload => removeCredential(payload))
  // Costs a request per account, so it is a button rather than part of the
  // read every screen does when it opens.
  registerHandler(PLATFORM_SESSION_CHANNELS.verify, () => verifySessionHealth())
  registerHandler(PLATFORM_SESSION_CHANNELS.pending, () => pendingSessions())
  registerHandler(PLATFORM_SESSION_CHANNELS.flushPending, (payload) => flushPendingSession(payload))
  registerHandler(PLATFORM_SESSION_CHANNELS.otpMode, (payload) => setCredentialOtpMode(payload))
  // Reads the mailbox only — no browser, no lock — so it is not refused while
  // an automation runs: an operator signing in by hand needs it most then.
  registerHandler(PLATFORM_SESSION_CHANNELS.peekOtp, (payload) => peekLatestOtp(payload))
  // Gated in the service on Visible Login info.
  registerHandler(PLATFORM_SESSION_CHANNELS.revealPassword, (payload) =>
    revealCredentialPassword(payload)
  )
  registerHandler(PLATFORM_SESSION_CHANNELS.autoLogin, (payload) => setAutoLogin(payload))
  registerHandler(PLATFORM_SESSION_CHANNELS.clear, (payload) => clearPlatformSession(payload))
  // Takes no payload at all — see the channel's own note on why this is not
  // `clear` with its arguments omitted.
  registerHandler(PLATFORM_SESSION_CHANNELS.clearAll, () => clearAllPlatformSessions())
}
