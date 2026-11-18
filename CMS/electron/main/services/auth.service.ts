import type { AuthUser, LoginInput, SessionState } from '@shared/types/auth'
import { SIGNED_OUT } from '@shared/types/auth'
import { fail, ok, type Result } from '@shared/types/result'
import { impersonateInputSchema, loginInputSchema } from '@shared/validation/auth.schema'
import { apiRequest } from './httpClient'
import { readCompany } from './company.store'
import { logger } from './logger'
import { clearSession, getSession, restoreSession, saveSession } from './session.store'
import { reportAppVersion } from './appVersion.service'
import { clearRoutingCache } from './automationRouting.service'
import { resumeSchedule, stopAutomationScheduler } from './automationScheduler.service'
import { requestScheduleStop } from './schedulerPause.store'
import { abandonSignIns } from './platformSession.service'
import { clearLocalData } from './localData.service'
import { clearCompany } from './company.store'
import { clearOfflineCache } from './offlineCache'
import { startMasterImportQueue, stopMasterImportQueue } from './masterImportQueue.service'
import { syncAll } from './syncAll.service'
// The claim socket lives and dies with the session: one that outlived a
// sign-out would keep receiving the company's claims after the operator left.
import { connectClaimSocket, disconnectClaimSocket } from './claimSocket.service'
import { startDraining } from './claimAutoRunner.service'
import { recoverInterruptedRuns } from './claimLiveness.service'
// The scheduler reads company settings, so it only runs while signed in.
import { startImportScheduler, stopImportScheduler } from './importScheduler.service'
import { afterHomePage } from './startupGate.service'

/**
 * Authentication against POST /api/auth/login - the same endpoint the TrackVid
 * web admin uses, so credentials and permissions stay in one place.
 *
 * The access token never crosses the IPC boundary. The renderer receives only a
 * SessionState (who is signed in), while the token stays in the main process and
 * is attached to outgoing API calls there.
 */

/** Wire shape of the `user` object the login endpoint returns. */
interface ApiLoginUser {
  id?: string
  _id?: string
  email?: string
  name?: { firstName?: string; lastName?: string; fullName?: string }
  phone?: { code?: string; number?: string; countryCode?: string }
  companyId?: string
  role?: string
}

interface ApiLoginData {
  accessToken?: string
  user?: ApiLoginUser
}

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

/**
 * Flattens the API's nested user document. Every field falls back to an empty
 * string so the profile page can render partial records instead of crashing on
 * an optional field the backend chose not to send.
 */
const toAuthUser = (user: ApiLoginUser): AuthUser => {
  const firstName = text(user.name?.firstName)
  const lastName = text(user.name?.lastName)
  const fullName = text(user.name?.fullName) || [firstName, lastName].filter(Boolean).join(' ')
  const code = text(user.phone?.code)
  const number = text(user.phone?.number)

  return {
    id: text(user.id) || text(user._id),
    email: text(user.email),
    firstName,
    lastName,
    fullName: fullName || text(user.email),
    phone: [code, number].filter(Boolean).join(' '),
    companyId: text(user.companyId),
    role: text(user.role)
  }
}

/**
 * The session, plus the company's name off the locally-held document.
 *
 * ASYNC ONLY BECAUSE OF THE NAME. The login response carries a company id and
 * no name, and the account menu wants the name — so it is read from the
 * document this machine already keeps rather than asking the backend again.
 * A missing or unreadable document is not a failure: the menu simply shows the
 * account without a company, which is what it did before.
 */
const toSessionState = async (): Promise<SessionState> => {
  const session = getSession()

  if (!session) return SIGNED_OUT

  return {
    authenticated: true,
    user: session.user,
    loggedInAt: session.loggedInAt,
    companyName: await companyName()
  }
}

const companyName = async (): Promise<string | null> => {
  try {
    const held = await readCompany()
    const name = held?.company.name

    return typeof name === 'string' && name.trim() ? name.trim() : null
  } catch {
    // The name is decoration on a menu. Nothing about a sign-in depends on it.
    return null
  }
}

export const login = async (payload: unknown): Promise<Result<SessionState>> => {
  const parsed = loginInputSchema.safeParse(payload)
  if (!parsed.success) {
    const fields: Record<string, string> = {}
    for (const issue of parsed.error.issues) {
      const key = issue.path[0]
      if (typeof key === 'string' && !fields[key]) fields[key] = issue.message
    }
    return fail('VALIDATION_ERROR', 'Please correct the highlighted fields.', fields)
  }

  const credentials: LoginInput = parsed.data
  const response = await apiRequest<ApiLoginData>('/auth/login', {
    method: 'POST',
    body: credentials
  })

  if (!response.success) return response

  const accessToken = text(response.data?.accessToken)
  const apiUser = response.data?.user
  if (!accessToken || !apiUser) {
    logger.error('Login succeeded but the response carried no token or user')
    return fail('INTERNAL_ERROR', 'Sign-in failed. Please try again.')
  }

  const user = toAuthUser(apiUser)
  await saveSession({ token: accessToken, user, loggedInAt: new Date().toISOString() })
  // Whatever the routing read holds belongs to the previous session — or to a
  // failed read made before there was a token. The responsible-use notice is
  // decided by that answer, so a stale one shows a dialog the company has
  // already dealt with. Impersonation switches company too, hence both paths.
  clearRoutingCache()
  // After the home page this sign-in leads to has rendered — see startupGate.
  afterHomePage('claim socket, import schedule and queue', () => {
    connectClaimSocket()
    startImportScheduler()
    startMasterImportQueue()
  })
  logger.info('User signed in', { userId: user.id })

  // Pull the company's data down now, while the network is known to be up:
  // signing in is the one moment we are certain of it. Every screen this
  // operator opens later reads from that cache if they have since gone offline.
  //
  // Deliberately NOT awaited. A sign-in should not wait on four reads, and a
  // slow or partly-broken backend must not be able to hold someone at the login
  // screen — the app is usable the moment the session exists, and each screen
  // fetches for itself anyway.
  void syncAll().then((result) => {
    if (result.success) {
      logger.info(
        `Cached company data after sign-in: ${result.data.refreshed} refreshed, ${result.data.failed} failed`
      )
    }
  })

  // Which build this machine is on. Not awaited and never fatal — see the
  // service; nothing reads this value, so failing to send it costs nothing.
  void reportAppVersion().catch(() => undefined)

  // THE SCHEDULE, which signing out wiped along with everything else this
  // machine remembered. The scheduler is armed once at launch, so without this
  // the next operator got an app whose tick found no task enabled — no
  // sessions, no claims, and an empty history that read as "nothing due".
  resumeSchedule()

  return ok(await toSessionState())
}

export const logout = async (): Promise<Result<SessionState>> => {
  const session = getSession()
  if (session) logger.info('User signed out', { userId: session.user.id })
  disconnectClaimSocket()
  stopImportScheduler()
  stopMasterImportQueue()

  /*
   * AND THE NIGHTLY SCHEDULE, which this did not stop.
   *
   * Signing out cleared the session and left the four automations armed: the
   * tick carried on, and a task that started afterwards ran against a signed-
   * out app — or, worse, against whoever signed in next, on the schedule and
   * the history of the operator who had left.
   *
   * Two calls, because they answer different questions. `requestScheduleStop`
   * asks the task in flight to stop at its next safe boundary — between
   * accounts, between marketplaces — rather than abandoning a claim
   * half-submitted. `stopAutomationScheduler` stops anything NEW from
   * starting, including the pass an evaluation already in flight was about to
   * begin.
   */
  requestScheduleStop()
  stopAutomationScheduler()

  /*
   * AND THE ONE ALREADY IN FLIGHT, which the two calls above do not touch.
   *
   * `requestScheduleStop` is a request to stop at the next SAFE BOUNDARY, which
   * is the right rule for a claim — abandoning one half-submitted is worse than
   * finishing it. A sign-in is not that: nothing is half-written at the
   * marketplace, and its result cannot be saved anyway once the token below is
   * cleared. So it is ended now rather than left to run for another half minute
   * against a company this app has just left.
   */
  const ended = await abandonSignIns('the operator signed out')

  if (ended > 0) logger.info(`[sign-out] ended ${ended} sign-in(s) that were still running`)

  await clearSession()
  // One company's settings must not answer for the next person to sign in on
  // this machine — including whether the notice has been accepted.
  clearRoutingCache()

  // The cache holds one company's claims and credentials. Signing out and
  // handing the machine to someone else must not leave them readable.
  await clearOfflineCache()
  // The company document holds this operator's marketplace passwords and
  // sessions. The next person to sign in on this machine must not inherit them.
  await clearCompany()

  // EVERYTHING ELSE this machine remembers, bar the AJIO and Snapdeal
  // master-data backups —
  // the claim queue, job history, refused-session verdicts, bulk reports. The
  // three clears above named the stores they knew about, which left the rest on
  // disk after an operator had asked to leave. See localData.service.
  await clearLocalData()

  return ok(SIGNED_OUT)
}

/** Called by the renderer on mount to learn whether a stored session survived. */
export const currentSession = async (): Promise<Result<SessionState>> => ok(await toSessionState())

/** Called once during startup, before the window opens. */
export const initialiseAuth = async (): Promise<void> => {
  const session = await restoreSession()

  // A restored session is a session: the app is signed in before the window
  // opens, and a claim dispatched while it was closed should arrive as soon as
  // it is listening again.
  if (session) {
    // NOT YET: queued until the home page has rendered (startupGate), so the
    // window paints before any background work competes with it.
    afterHomePage('claim socket, import schedule, queues and claim recovery', () => {
      connectClaimSocket()
      // Re-reads the company's schedule on every launch, which is the point:
      // a time changed elsewhere must take effect here without a reinstall.
      startImportScheduler()
      // A report requested before the app was last closed is still waiting to be
      // collected. Without this the queue only ever ran after a FRESH sign-in, so
      // an operator who simply reopened the app was never told their report was
      // ready — and the queue file sat there untouched.
      startMasterImportQueue()
      // Same reasoning for claims. One dispatched while the app was closed is
      // stored the moment the socket reconnects, but one that arrived and was
      // never worked — the app was killed mid-queue — would otherwise sit at
      // "received" for good.
      //
      // Recovery FIRST, then the drain. A claim this machine was working when it
      // died is still marked `running`; the drain would step over it and the
      // backend row would sit at Running with nothing watching it. Awaited for
      // the same reason — draining before the reset lands would race it.
      void recoverInterruptedRuns()
        .catch(error => logger.error('Could not recover interrupted claims', error))
        .finally(() => startDraining())
    })

    // HERE AS WELL AS ON SIGN-IN, and this is the path that matters: an
    // operator signs in once and then simply reopens the app for months, so a
    // version reported only at sign-in would describe the build they installed
    // on their first day. An update lands, the app restarts, and this is the
    // first thing that notices.
    void reportAppVersion().catch(() => undefined)
  }
}

/**
 * Signs in as another user, by id, without their password.
 *
 * Hits GET /system-admin/:id, which mints an access token for whatever user the
 * id names. Used by support staff to reproduce what a customer is seeing without
 * asking for their password.
 *
 * Two things about that endpoint, both worth knowing before relying on this:
 * it takes no credential of its own (see SECURITY.md), and the token it returns
 * is indistinguishable from a real sign-in — so anything done while impersonating
 * is attributed to the impersonated user, not to whoever is at the keyboard.
 */
export const impersonate = async (payload: unknown): Promise<Result<SessionState>> => {
  // The login screen hides the tab in a build without IMPERSON_LOGIN=true; this
  // is the half that matters, since the channel itself stays registered.
  if (!__IMPERSON_LOGIN__) {
    logger.warn('Impersonation refused — IMPERSON_LOGIN is not enabled in this build')
    return fail('VALIDATION_ERROR', 'Impersonation is not enabled in this build.')
  }

  const parsed = impersonateInputSchema.safeParse(payload)
  if (!parsed.success) {
    const fields: Record<string, string> = {}
    for (const issue of parsed.error.issues) {
      const key = issue.path.map(String).join('.') || 'form'
      fields[key] ??= issue.message
    }
    return fail('VALIDATION_ERROR', 'Enter a valid user ID', fields)
  }

  const { userId } = parsed.data
  const response = await apiRequest<ApiLoginData>(`/system-admin/${encodeURIComponent(userId)}`)
  if (!response.success) return response

  const accessToken = text(response.data?.accessToken)
  const apiUser = response.data?.user
  if (!accessToken || !apiUser) {
    logger.error('Impersonation succeeded but the response carried no token or user')
    return fail('INTERNAL_ERROR', 'Could not sign in as that user. Please try again.')
  }

  const user = toAuthUser(apiUser)
  await saveSession({ token: accessToken, user, loggedInAt: new Date().toISOString() })
  // Whatever the routing read holds belongs to the previous session — or to a
  // failed read made before there was a token. The responsible-use notice is
  // decided by that answer, so a stale one shows a dialog the company has
  // already dealt with. Impersonation switches company too, hence both paths.
  clearRoutingCache()
  // After the home page this sign-in leads to has rendered — see startupGate.
  afterHomePage('claim socket, import schedule and queue', () => {
    connectClaimSocket()
    startImportScheduler()
    startMasterImportQueue()
  })
  // Logged loudly and by id: an impersonated session looks exactly like a real
  // one afterwards, so this line is the only local record of how it started.
  logger.warn('Session started by IMPERSONATION', { userId: user.id, email: user.email })

  // Same as a normal sign-in: cache the company's data now, while the network
  // is known to be up. Not awaited — see login().
  void syncAll().then((result) => {
    if (result.success) {
      logger.info(
        `Cached company data after impersonation: ${result.data.refreshed} refreshed, ${result.data.failed} failed`
      )
    }
  })

  // Also as a normal sign-in: this path reaches an app whose schedule the last
  // sign-out wiped, and support reproducing what a customer sees should see the
  // automations running as the customer's would.
  resumeSchedule()

  return ok(await toSessionState())
}
