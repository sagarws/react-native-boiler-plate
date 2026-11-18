import { BrowserWindow, session as electronSession, type Cookie } from 'electron'
import { PLATFORMS, getPlatform } from '@trackvid/automation-core/common/platforms'
import { getLoginForm } from '@trackvid/automation-core/common/loginForms'
import { canRenew } from '@trackvid/automation-core/common/renewSession'
import { getPreferences } from './preferences.service'
import { loadCore } from '@main/automations/common/coreLoader'
import {
  getSessionExtras,
  platformsNeedingTokenCapture
} from '@trackvid/automation-core/common/sessionExtras'
import { probePlatformSession } from '@trackvid/automation-core/common/probeSession'
import { renewsOnCheck } from '@trackvid/automation-core/common/sessionIdentity'
import { processName, withProcessLogResult } from '@main/automations/common/processLog'
import type {
  PendingSummary,
  CaptureSessionInput,
  CaptureSessionResult,
  CredentialRow,
  HarvestedCookie,
  PlatformCredentials,
  PlatformDescriptor,
  SessionSummary
} from '@shared/types/platformSession'
import { fail, ok, type Result } from '@shared/types/result'
import { domainMatches } from '@shared/utils/cookieDomain'
import { healthOf } from '@shared/utils/sessionHealth'
import { platformKey } from '@shared/utils/platformKey'
import { shapeJar } from '@shared/utils/sessionJar'
import { apiRequest } from './httpClient'
import { getAccessToken } from './session.store'
import { sessionChanged } from './sessionChangeSignal'
import { logger } from './logger'
import { broadcast } from '@main/ipc/broadcast'
import { PLATFORM_SESSION_EVENTS, type SessionCapturingEvent } from '@shared/constants/channels'
import {
  applyPageIdentity,
  reportPageEnvironment,
  useBrowserIdentity
} from './browserIdentity'
import { forgetAllSessions, forgetSession, rememberSession } from './localSession.store'
import { autoLoginEnabled, clearRoutingCache } from './automationRouting.service'
import { credentialSecret } from './credentialSecret.service'
import { cloudflareInboxOf } from './otpSource'
import { driveLogin, type LoginForm } from './loginDriver.service'
import { renewSessionOnServer } from './serverRenew.service'
import {
  loginLocally,
  needsRealBrowserForManualSignIn,
  operatorLoginLocally,
  OTP_FETCHERS,
  type LocalLoginResult
} from './localLogin.service'
import { discardPending, listPending, queuePending, readPending } from './pendingSession.store'
import {
  credentialsFor,
  forgetCompanySession,
  refusedLogins,
  rememberCompanySession,
  rememberOtpMode
} from './company.service'
import { forgetSessionRejected, sessionRejectionKey, sessionRejections } from './sessionRejection.store'
import { reusableSession } from './sessionReuse.service'
import { withOfflineCache } from './offlineCache'
import { env } from '../config/env'

/**
 * Capturing a marketplace session with the app's own browser.
 *
 * Every platform's claim automation talks HTTP, but none of them can *sign in*
 * over HTTP — the runner on the server drives Puppeteer or Selenium once to
 * clear the login page and harvest a jar. A desktop app does not need a second
 * Chromium to do the same thing: Electron already is one.
 *
 * So a capture is: open a real window at the platform's login page, sign in,
 * then read the cookies out of a partitioned session and POST them to the
 * backend's existing /<platform>/ingest-session.
 *
 * Who signs in depends on `settings.isAutoLoginOnActiveSession[platform]`. When
 * it is on, the app fills the form itself from the stored credential and the
 * operator only sees the window finish; when it is off — or the platform has no
 * form descriptor, or no password is stored, or the portal asks for a one-time
 * code — the window stays open and the operator signs in by hand, which is what
 * happened before this existed and is also how OTP, captcha and consent screens
 * get handled. A human is already watching either way.
 *
 * The jar never touches the renderer and is never written to disk here. The
 * backend owns storage; this is a courier.
 */

/** Each capture gets its own partition, so platforms cannot see each other's cookies. */
const partitionFor = (platform: string, username: string): string =>
  `persist:platform-${platform}-${username.toLowerCase().trim()}`

/**
 * Wipes a capture partition before it is reused.
 *
 * Re-capture has to MINT a session, not confirm one. The partition is
 * `persist:`, so last time's cookies are still there — and a marketplace that
 * still recognises them serves the dashboard instead of the login page. The
 * form never appears, the scripted sign-in stalls waiting for it, and the
 * "fresh" session is really the old one handed back.
 *
 * Safe to do unconditionally: this partition is scratch space. The session of
 * record lives in the backend and in localSession.store, and neither is touched
 * until a capture actually succeeds — so a wipe followed by a failed sign-in
 * leaves the operator exactly where they were.
 */
const wipeCaptureData = async (partition: string): Promise<void> => {
  const scope = electronSession.fromPartition(partition)

  try {
    await scope.clearStorageData({
      storages: ['cookies', 'localstorage', 'indexdb', 'serviceworkers', 'cachestorage', 'filesystem']
    })
    await scope.clearCache()
  } catch (error) {
    // Not fatal. Worst case the portal recognises the old session and the
    // operator sees a dashboard rather than a login form — which the sign-in
    // will report rather than silently mis-capture.
    logger.warn(`Could not clear the capture partition for ${partition}`, error)
  }
}

/** Windows currently open, keyed by platform, so a second capture cannot race the first. */
const openCaptures = new Map<string, BrowserWindow>()

/** Manual sign-ins running in the real Chrome (see `needsRealBrowserForManualSignIn`), by platform. */
const operatorCaptures = new Set<string>()

export const listPlatforms = (): Result<PlatformDescriptor[]> =>
  ok(
    PLATFORMS.map((p) => ({
      key: p.key,
      label: p.label,
      loginUrl: p.loginUrl,
      automations: [...p.automations]
    }))
  )

const toHarvested = (cookie: Cookie): HarvestedCookie => ({
  name: cookie.name,
  value: cookie.value,
  domain: cookie.domain ?? '',
  path: cookie.path,
  secure: cookie.secure,
  httpOnly: cookie.httpOnly,
  ...(cookie.expirationDate === undefined ? {} : { expirationDate: cookie.expirationDate })
})

/** The backend rejects a jar under this as unusable, so it is also our target. */
const MIN_COOKIES = 3

/**
 * How long to leave the operator alone before asking the marketplace whether
 * they are in yet, and how often to ask after that.
 *
 * Ten seconds because the window has only just opened and nobody types a
 * password and an emailed code faster than that.
 *
 * THE WINDOW MUST CLOSE WITHIN TEN SECONDS OF THE SIGN-IN. The timed check
 * alone could not promise that — it needed the jar unchanged across two asks
 * five seconds apart, then a request — so the watcher also wakes on what a
 * sign-in actually does: the marketplace setting its cookies and navigating to
 * the dashboard. It waits `SIGN_IN_SETTLE_MS` of quiet (the redirect chain
 * writing the rest of the session), asks once, and closes on a yes. The timed
 * check stays, every three seconds, for a sign-in that ends without either.
 * `SIGN_IN_MIN_GAP_MS` keeps a page that sets analytics cookies on every
 * keystroke from turning into a request per keystroke.
 */
const SIGN_IN_WATCH_DELAY_MS = 10_000
const SIGN_IN_WATCH_INTERVAL_MS = 3_000
const SIGN_IN_SETTLE_MS = 1_500
const SIGN_IN_MIN_GAP_MS = 2_000

/**
 * Every cookie the platform set, de-duplicated by name+domain.
 *
 * Reads the whole partition and filters here. The partition is already scoped
 * to one platform and one username, so there is nothing else in it — and a
 * marketplace commonly splits its session across the apex (.ajio.com) and a
 * subdomain (seller.ajio.com), so anything narrower drops half of it.
 */
const harvest = async (partition: string, domains: readonly string[]): Promise<HarvestedCookie[]> => {
  const jar = electronSession.fromPartition(partition).cookies
  const seen = new Map<string, HarvestedCookie>()

  let cookies: Cookie[]

  try {
    cookies = await jar.get({})
  } catch (error) {
    logger.warn(`Cookie read failed for ${partition}`, error)

    return []
  }

  for (const cookie of cookies) {
    const domain = cookie.domain ?? ''

    if (!domains.some((wanted) => domainMatches(domain, wanted))) continue
    const key = `${cookie.name}@${domain}`

    if (!seen.has(key)) seen.set(key, toHarvested(cookie))
  }

  return [...seen.values()]
}

/**
 * What is actually in the partition, when the expected cookies are not.
 *
 * The likeliest cause of an empty harvest after a good sign-in is a cookie
 * domain the registry does not list — a marketplace moving its session to a new
 * host. Without this the symptom is indistinguishable from "never signed in",
 * and the log says nothing either way.
 */
const logCookieDiagnostics = async (
  partition: string,
  platform: { key: string; cookieDomains: readonly string[] }
): Promise<void> => {
  try {
    const all = await electronSession.fromPartition(partition).cookies.get({})
    const domains = [...new Set(all.map((c) => c.domain ?? '(none)'))].sort()

    logger.warn(
      `${platform.key}: ${all.length} cookie(s) in the partition across ${domains.length} domain(s)`,
      { present: domains, expected: [...platform.cookieDomains] }
    )
  } catch (error) {
    logger.warn(`${platform.key}: could not read the partition for diagnostics`, error)
  }
}

/**
 * Waits for the session cookies to actually land before the window is closed.
 *
 * Signing in is not one navigation. AJIO's success signal is the OAuth callback
 * arriving at seller.ajio.com — but the callback is the START of the portal's
 * own redirect chain, and the session cookies are set during it. Closing the
 * window the moment the URL matches aborts that chain, and the capture harvests
 * an empty jar from a sign-in that genuinely worked.
 *
 * So: poll until the jar is both big enough and has stopped growing. Stability
 * matters as much as the count — cookies arrive across several responses, and
 * stopping at the first three can ship a partial session that fails later, at
 * claim time, where the cause is far less obvious.
 */
const settleCookies = async (
  partition: string,
  domains: readonly string[],
  timeoutMs = 20_000
): Promise<HarvestedCookie[]> => {
  const deadline = Date.now() + timeoutMs
  let previous = -1
  let stableFor = 0
  let jar: HarvestedCookie[] = []

  while (Date.now() < deadline) {
    jar = await harvest(partition, domains)

    if (jar.length === previous) stableFor += 1
    else stableFor = 0
    previous = jar.length

    if (jar.length >= MIN_COOKIES && stableFor >= 2) return jar

    await new Promise((resolve) => setTimeout(resolve, 500))
  }

  logger.warn(
    `Cookies for ${partition} never settled — ${jar.length} after ${timeoutMs}ms`
  )

  return jar
}

/**
 * Opens the login window and resolves when the operator closes it.
 *
 * Closing the window IS the signal that login is done. Detecting it from the URL
 * would need a per-platform success pattern that breaks the first time a
 * marketplace changes its post-login redirect; asking the operator to close the
 * window when they can see they are signed in never breaks.
 */
const openLoginWindow = (
  key: string,
  label: string,
  loginUrl: string,
  partition: string,
  /**
   * Start the window hidden.
   *
   * For the sign-in that needs no screen: the page still has to LOAD — it is
   * where the request is submitted from and where the cookies land — but
   * nobody has to look at it. Shown the moment anything needs a person, which
   * is what `revealLoginWindow` is for; a hidden window waiting for input
   * would be the worst of both.
   */
  hidden = false
): { window: BrowserWindow; closed: Promise<void>; loaded: Promise<void> } => {
  // Before the window exists, so the very first request already carries it.
  // A marketplace behind a bot check refuses an `Electron/` user-agent outright
  // — see browserIdentity.
  useBrowserIdentity(partition)

  const window = new BrowserWindow({
    width: 1280,
    height: 900,
    title: `Sign in to ${label} — this window closes by itself once you are in`,
    autoHideMenuBar: true,
    show: !hidden,
    webPreferences: {
      partition,
      // The marketplace's own page runs here. It gets no bridge, no Node, and
      // its own session partition — it must never reach this app's internals.
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: false
    }
  })

  // Before the first navigation: these run in the page's main world ahead of
  // its own scripts, which is the only moment a bot check has not already run.
  applyPageIdentity(window)

  // Read-only. Logs what the portal's own scripts can see about this window —
  // and whether the page has disabled its Login button — 8s after paint, which
  // is past the bootstrap the automated path waits 6s for.
  reportPageEnvironment(window, label)

  openCaptures.set(key, window)

  const closed = new Promise<void>((resolve) => {
    window.once('closed', () => {
      openCaptures.delete(key)
      resolve()
    })
  })

  // Resolves on the first paint rather than on 'did-finish-load': these login
  // pages keep fetching after the document is ready, and waiting for quiet
  // means waiting far longer than the form takes to appear.
  const loaded = new Promise<void>((resolve) => {
    window.webContents.once('dom-ready', () => resolve())
    window.once('closed', () => resolve())
  })

  void window.loadURL(loginUrl)

  return { window, closed, loaded }
}

/**
 * Signs in on the operator's behalf, when the company has that turned on.
 *
 * `signedIn` is true only when the window can be closed and the jar harvested.
 * Every other outcome leaves the window open for the operator — auto-login is a
 * shortcut, never a gate, so the worst case is the manual sign-in that happened
 * before this existed.
 *
 * `reason` says WHY it was handed back, and is carried all the way into the
 * error the operator sees. Without it a stalled scripted sign-in was reported
 * as "the window was closed before sign-in completed", which blames the
 * operator for something they had no part in.
 */
interface SignInAttempt {
  signedIn: boolean
  attempted: boolean
  reason?: string
}

interface MyntraHeadlessLogin {
  readCidx: (url: string) => string
  isLoginPage: (url: string) => boolean
  emailLoginScript: (input: {
    email: string
    password: string
    cidx: string
    pageRequested?: string
  }) => string
  interpretLoginResponse: (result: unknown) => {
    outcome: 'submitted' | 'rejected' | 'challenged' | 'otp' | 'failed'
    message: string
  }
}

/**
 * Submits Myntra's sign-in from inside the page it is already on.
 *
 * THE WINDOW IS STILL THIS APP'S. Nothing is opened or closed here and no
 * cookies are read: the caller owns the window and harvests afterwards, which
 * is what keeps this path and the click path interchangeable.
 *
 * The landing page has to be reached first. `loginUrl` is the portal, which
 * redirects to accounts.myntra.com with a fresh `cidx` — the per-attempt id
 * the request has to carry and which cannot be invented. So the sequence is:
 * wait for that redirect, read the id off the URL, post the credentials.
 *
 * A challenge or a one-time code is reported, not fought. Both mean a person
 * is needed, and the caller's next move — driving the form in the visible
 * window — is the one that gives them something to answer.
 */
const signInMyntraHeadlessly = async (
  window: BrowserWindow,
  username: string,
  password: string
): Promise<SignInAttempt> => {
  const core = loadCore<MyntraHeadlessLogin>('platforms/myntra/common/headlessLogin')

  // The portal bounces to the accounts host on load; give it that moment.
  // Polled rather than waited on a navigation event, because the redirect may
  // already have happened by the time this runs.
  const deadline = Date.now() + 30_000
  let url = window.webContents.getURL()

  while (!core.isLoginPage(url) && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 500))

    if (window.isDestroyed()) return { signedIn: false, attempted: false, reason: 'window closed' }

    url = window.webContents.getURL()
  }

  const cidx = core.readCidx(url)

  if (!cidx) {
    // No id, no request worth making. The form path can still get there by
    // clicking through whatever the page is showing.
    return { signedIn: false, attempted: false, reason: 'the login page did not carry a cidx' }
  }

  // `unknown`, not the `any` executeJavaScript hands back: whatever the page
  // returns is the page's word, and the core's interpreter is what turns it
  // into an outcome.
  const raw: unknown = await window.webContents.executeJavaScript(
    core.emailLoginScript({ email: username, password, cidx }),
    true
  )
  const verdict = core.interpretLoginResponse(raw)

  if (verdict.outcome !== 'submitted') {
    return { signedIn: false, attempted: true, reason: verdict.message }
  }

  /**
   * SUBMITTED IS NOT SIGNED IN, and this is where that bit.
   *
   * Myntra answers the POST by setting the session on the ACCOUNTS host,
   * accounts.myntra.com. The cookies this app harvests are the PORTAL's —
   * partners.myntrainfo.com — and those are only issued when the portal is
   * loaded and completes its handshake against that new session.
   *
   * The click path gets that for free: clicking LOG IN navigates, and the
   * redirect chain ends on the portal with its cookies written. A `fetch` does
   * not navigate, so the hop has to be made deliberately. It was not — the
   * comment here claimed the portal was loaded and the code only slept — and
   * the consequence was invisible in the worst way. The harvest read whatever
   * the partition already held, which on a RE-CAPTURE is the PREVIOUS
   * session's jar: enough cookies to look like a capture, stale enough for
   * Myntra to answer "nobody is signed in", and a re-capture that could never
   * succeed however many times it was run.
   *
   * So the portal is loaded, and being bounced back to the login page is taken
   * as the refusal it is — the operator then gets the visible window, which is
   * the one thing that can still fix it.
   */
  const portal =
    loadCore<{ getPlatform: (key: string) => { loginUrl?: string } | undefined }>(
      'common/platforms'
    ).getPlatform('myntra')?.loginUrl ?? 'https://partners.myntrainfo.com/'

  try {
    await window.loadURL(portal)
  } catch (error) {
    // A redirect during load aborts the original navigation (ERR_ABORTED),
    // which here is the normal case rather than a failure. Where the window
    // actually settles is checked below, and that is what decides.
    logger.info(`Myntra portal load returned ${String(error)} — reading where it landed`)
  }

  // A handshake is a redirect chain: where it lands is the answer, not how
  // long it took.
  const deadlineAt = Date.now() + 15_000

  while (Date.now() < deadlineAt) {
    if (window.isDestroyed()) return { signedIn: false, attempted: true, reason: 'window closed' }

    if (!core.isLoginPage(window.webContents.getURL()) && !window.webContents.isLoading()) {
      return { signedIn: true, attempted: true }
    }

    await new Promise(resolve => setTimeout(resolve, 500))
  }

  // Still on the login page after the hop: the accounts host took the
  // credentials and the portal will not take the session. Reported as a failed
  // sign-in so the caller reveals the window, rather than going on to harvest a
  // jar that cannot work.
  return {
    signedIn: false,
    attempted: true,
    reason: 'the portal sent the sign-in back to the login page'
  }
}

/**
 * Puts a hidden sign-in window on screen.
 *
 * Called the instant the scripted path gives up: from then on the window is
 * the operator's, and one they cannot see is one they cannot finish.
 */
const revealLoginWindow = (window: BrowserWindow): void => {
  if (window.isDestroyed() || window.isVisible()) return

  window.show()
  window.focus()
}

const trySignIn = async (
  window: BrowserWindow,
  platformKey: string,
  label: string,
  username: string,
  // A scheduled run has no operator to ask, so the company's "should the
  // button sign in by itself" switch does not apply to it. See `unattended`
  // on CaptureSessionInput.
  ignoreCompanySwitch = false
): Promise<SignInAttempt> => {
  if (!ignoreCompanySwitch && !(await autoLoginEnabled(platformKey))) {
    return { signedIn: false, attempted: false }
  }

  const form = getLoginForm(platformKey) as LoginForm | null

  if (!form) {
    logger.info(`No scripted sign-in described for ${platformKey}; asking the operator`)

    return { signedIn: false, attempted: false }
  }

  const secret = await credentialSecret(platformKey, username)

  if (!secret.success) {
    // A 403 (turned off) and NO_PASSWORD_STORED both land here, and both are
    // ordinary. Logged at info, not error — nothing is broken.
    logger.info(`Scripted ${label} sign-in unavailable for ${username}: ${secret.error.message}`)

    return { signedIn: false, attempted: false, reason: secret.error.message }
  }

  // MYNTRA, WITHOUT THE CLICK — when this installation has asked for it.
  //
  // Everything else signs in by driving the form, which ends in a click. On
  // Myntra that click is the one step that needs a real screen: the LOG IN
  // button ignores a synthetic one, so the established path finishes with an
  // OS-level mouse click at coordinates. The capture of a successful sign-in
  // shows the click produces one ordinary JSON request, so this submits that
  // instead — see the core's platforms/myntra/common/headlessLogin for the
  // evidence and the reasoning.
  //
  // Same window, same cookie partition, same harvest afterwards: only the way
  // the credentials are handed over changes. A refusal falls through to the
  // operator exactly as a failed click does.
  if (platformKey === 'myntra' && getPreferences().myntraHeadlessLogin) {
    const headless = await signInMyntraHeadlessly(window, username, secret.data.password)

    if (headless.signedIn) return headless

    logger.info(
      `${label} headless sign-in did not complete (${headless.reason}) — driving the form instead`
    )
  }

  const verdict = await driveLogin(
    window,
    form,
    { username, password: secret.data.password },
    /*
     * The code reader for this platform, when this machine has one.
     *
     * Looked up rather than passed in, so adding a platform is one entry in
     * `OTP_READERS` and no change here. Absent is the behaviour this had
     * before: see the challenge, stop, hand the window to the operator.
     */
    OTP_FETCHERS[platformKey]
  )

  if (verdict.status === 'signed-in') {
    logger.info(`Signed in to ${label} as ${username} without operator input`)

    return { signedIn: true, attempted: true }
  }

  logger.info(`${label} sign-in handed to the operator: ${verdict.reason}`)

  return { signedIn: false, attempted: true, reason: verdict.reason }
}

/**
 * The parts of a session that are not cookies.
 *
 * Four ingest endpoints reject a bare jar. AJIO needs the seller's
 * activeSellerProfileId and places of business — read from the signed-in page,
 * because one lives in localStorage and the other behind an authenticated API
 * call. Flipkart needs its double-submit csrf token, which is already in the
 * jar. The core owns both, so the server and this app derive them identically.
 *
 * A platform with no descriptor returns `{}` — that is the common case, not a
 * failure: five of the eight need nothing more than cookies.
 */
interface ExtrasDescriptor {
  platform: string
  required: string[]
  pageScript?: string
  fromJar?: (jar: HarvestedCookie[]) => Record<string, unknown>
  /** Loaded after sign-in, for cookies host-scoped to an API domain. */
  visitAfterLogin?: string[]
  /** Cookie names the session is useless without. */
  requiredCookies?: string[]
}

/**
 * Loads each URL in turn, waiting for it to finish.
 *
 * Myntra's session cookies are host-scoped to partnersapi.myntrainfo.com, so
 * signing in at partners.myntrainfo.com never sets them and a jar harvested
 * there is missing exactly the two cookies that matter. One request to the API
 * host materialises them — the same hop the server's login makes.
 */
const visitAfterLogin = async (window: BrowserWindow, urls: string[]): Promise<void> => {
  for (const url of urls) {
    if (window.isDestroyed()) return
    try {
      await window.webContents.loadURL(url)
      // The response has arrived; give the cookie store a beat to write.
      await new Promise((resolve) => setTimeout(resolve, 1500))
    } catch (error) {
      // A 401/404 here is fine — the cookies are set by the request, not the
      // response body. Only a genuine navigation failure matters, and even then
      // the required-cookie check below is the real verdict.
      logger.warn(`Post-login hop to ${url} did not complete cleanly`, error)
    }
  }
}

const readPageExtras = async (
  window: BrowserWindow,
  descriptor: ExtrasDescriptor
): Promise<Record<string, unknown> | null> => {
  if (window.isDestroyed() || !descriptor.pageScript) return null

  try {
    const value = (await window.webContents.executeJavaScript(descriptor.pageScript, true)) as
      | Record<string, unknown>
      | null

    if (!value || typeof value.error === 'string') return null

    return value
  } catch {
    // Mid-navigation, or the page is not signed in yet. Normal while polling.
    return null
  }
}

/**
 * Watches for the page-derived extras while the window is open.
 *
 * Polling rather than reading once at the end, because on the manual path the
 * OPERATOR closes the window and the page is gone before this code runs again.
 * The last good read is kept and used after close, so a manual sign-in yields
 * the same session a scripted one does.
 *
 * Silent on failure by design: until the operator finishes signing in, every
 * read legitimately fails.
 */
const watchPageExtras = (
  window: BrowserWindow,
  descriptor: ExtrasDescriptor | null
): { latest: () => Record<string, unknown> | null; stop: () => void } => {
  let latest: Record<string, unknown> | null = null
  let stopped = false

  if (descriptor?.pageScript) {
    const tick = async (): Promise<void> => {
      while (!stopped && !window.isDestroyed()) {
        const value = await readPageExtras(window, descriptor)

        if (value) latest = value
        await new Promise((resolve) => setTimeout(resolve, 2000))
      }
    }

    void tick()
  }

  return { latest: () => latest, stop: () => { stopped = true } }
}

/**
 * Whatever a platform can work out from the jar alone, and nothing else.
 *
 * Never throws and never refuses: this feeds the capture-time PROBE, where a
 * missing field is a reason the probe may be weaker, not a reason to fail a
 * sign-in. `collectExtras` below is the strict version, and it is the one that
 * decides whether a session may be stored.
 */
/**
 * Is the session we just captured one the marketplace actually honours — and if
 * not, WHY NOT, in words that reach the log and the operator.
 *
 * THE PROBE ALONE COULD NOT SAY. `probePlatformSession` answers true/false/null
 * and the reason goes to `console.log` inside the core — which this app does
 * not capture, so it reaches neither the log file nor the screen. One account
 * failed this check every single time for a FORTNIGHT (Myntra, 10-23 Sept:
 * sign in, refuse, discard, sign in again an hour later) and all any of it said
 * was "Myntra does not recognise the session that was captured". Whether Myntra
 * had answered 401, rate-limited the burst, timed out, or answered 200 with a
 * payload naming nobody — the four things somebody would do something different
 * about — was the one thing not written down anywhere.
 *
 * So ask the identity endpoint first, exactly as the REUSE path already does
 * (`reusableSession`): it is three-valued, it logs through this app's logger,
 * and it distinguishes "the portal refused" from "the portal never answered".
 * The old probe stays as the fallback for platforms with no identity check, so
 * nothing this does not cover is made worse.
 */
/**
 * Closes the window itself, the moment the marketplace agrees it is signed in.
 *
 * "Sign in, then close the window" is a true instruction and a bad one. The
 * operator has to know that closing is what saves it, they close too early and
 * lose the session, or they leave a signed-in marketplace open on screen
 * wondering whether anything happened. And the app can simply tell: the same
 * question it asks AFTER the window closes — does this jar name a seller — can
 * be asked WHILE it is open.
 *
 * So it watches — on every cookie write and navigation, and on a timer — and
 * the first time the answer is yes it closes the window. The
 * capture then proceeds exactly as it does when a person closes it, because
 * that is all this does: the operator's own close still works, and is still
 * the signal on every platform this cannot verify.
 *
 * WAITS FOR THE JAR TO SETTLE FIRST, then asks. Signing in is not one
 * navigation — the cookies arrive across a redirect chain — and asking on the
 * first three would spend a request on a session that is half-written.
 *
 * NEVER FAILS THE CAPTURE. Any error here leaves the window with the operator,
 * which is the behaviour this replaces.
 *
 * @returns a stop function; the caller must call it once the window is gone.
 *
 * Exported for its test: closing a window at the wrong moment either throws
 * away a session the operator just made or never closes at all, and neither is
 * visible from reading it.
 */
export const closeWhenSignedIn = (
  window: BrowserWindow,
  platform: {
    key: string
    label: string
    cookieDomains: readonly string[]
    jarFormat: string
  },
  partition: string,
  extrasOf: () => Record<string, unknown>
): { stop: () => void } => {
  let stopped = false
  /** Past the grace period — before it, nothing is asked whatever happens. */
  let armed = false
  let checking = false
  /** A wake-up arrived mid-ask; ask again straight after. */
  let again = false
  let previous = -1
  let lastAskAt = 0
  const timers = new Set<NodeJS.Timeout>()

  const later = (ms: number, run: () => void): void => {
    const timer = setTimeout(() => {
      timers.delete(timer)
      run()
    }, ms)

    timers.add(timer)
  }

  /**
   * One look. `settled` is true when the caller already waited for quiet (a
   * cookie or navigation wake-up); the timed check instead requires the jar to
   * have stopped growing since its last look, as it always has.
   */
  const look = async (settled: boolean): Promise<void> => {
    if (stopped || !armed || window.isDestroyed()) return
    if (checking) {
      again = true

      return
    }

    checking = true

    try {
      const jar = await harvest(partition, platform.cookieDomains)
      const stable = jar.length === previous

      previous = jar.length

      // The count alone proves nothing — see recogniseCaptured — but a jar
      // that is still filling is one the marketplace would answer about twice.
      if (jar.length < MIN_COOKIES || !(settled || stable)) return

      lastAskAt = Date.now()

      const extras = { ...extrasFromJar(platform.key, jar), ...extrasOf() }
      // AJIO and Tata CliQ answer only from inside the page; everything else
      // is asked from the jar. `null` from either means "not yet".
      const fromPage = await askThePage(window, platform.key, extras)
      const verdict =
        fromPage === null
          ? await recogniseCaptured(platform.key, shapeJar(jar, platform.jarFormat), extras)
          : { ok: fromPage, detail: 'the page answered as a signed-in session does' }

      if (verdict.ok === true && !stopped) {
        logger.info(`${platform.label} signed in — closing the sign-in window (${verdict.detail})`)
        stop()

        if (!window.isDestroyed()) window.close()
      }
    } finally {
      checking = false

      if (again && !stopped) {
        again = false
        void look(true).catch(warn)
      }
    }
  }

  const warn = (error: unknown): void => {
    logger.warn(`Could not watch the ${platform.label} sign-in window`, error)
  }

  /** Something a sign-in does just happened — look once things go quiet. */
  let wake: NodeJS.Timeout | undefined

  const onActivity = (): void => {
    if (stopped || !armed) return
    if (wake) {
      clearTimeout(wake)
      timers.delete(wake)
    }

    const wait = Math.max(SIGN_IN_SETTLE_MS, lastAskAt + SIGN_IN_MIN_GAP_MS - Date.now())

    wake = setTimeout(() => {
      if (wake) timers.delete(wake)
      wake = undefined
      void look(true).catch(warn)
    }, wait)
    timers.add(wake)
  }

  // Optional chaining throughout: the test window has no webContents, and an
  // event source that is missing must cost the fast path, never the watcher.
  const cookies = electronSession.fromPartition(partition)?.cookies as
    | (Electron.Cookies & { on?: Electron.Cookies['on']; removeListener?: Electron.Cookies['removeListener'] })
    | undefined
  const contents = (window as { webContents?: Electron.WebContents }).webContents

  cookies?.on?.('changed', onActivity)
  contents?.on?.('did-navigate', onActivity)
  contents?.on?.('did-navigate-in-page', onActivity)

  const tick = (): void => {
    if (stopped) return

    void look(false)
      .catch(warn)
      .finally(() => later(SIGN_IN_WATCH_INTERVAL_MS, tick))
  }

  // A grace period before the first ask: the operator has only just been
  // shown the form, and a marketplace's public page can carry enough cookies
  // to look worth asking about.
  later(SIGN_IN_WATCH_DELAY_MS, () => {
    armed = true
    tick()
  })

  function stop(): void {
    if (stopped) return

    stopped = true

    for (const timer of timers) clearTimeout(timer)

    timers.clear()
    cookies?.removeListener?.('changed', onActivity)

    if (contents && !contents.isDestroyed?.()) {
      contents.removeListener?.('did-navigate', onActivity)
      contents.removeListener?.('did-navigate-in-page', onActivity)
    }
  }

  return { stop }
}

/**
 * The same question, asked INSIDE the window — for the two platforms that
 * cannot be asked any other way.
 *
 * AJIO and Tata CliQ are deliberately absent from every jar-based check: one
 * needs the browser's own TLS fingerprint past Akamai, the other is scoped to a
 * slave the portal holds server-side. So a capture for either could never be
 * verified, which means it could never be closed automatically and whatever the
 * operator left behind was stored unchecked.
 *
 * The window is a browser, though, and the thing those checks need is already
 * on screen. See the core's common/sessionPageProbe for the scripts.
 *
 * Null on anything that is not a clear answer, including a window that has gone
 * — a page mid-navigation is not a signed-out session.
 */
const askThePage = async (
  window: BrowserWindow,
  platformKey: string,
  extras: Record<string, unknown>
): Promise<boolean | null> => {
  if (window.isDestroyed()) return null

  try {
    /*
     * INSIDE THE TRY, INCLUDING THE LOAD. This app runs against whatever core
     * commit it pins, and a pin without this module — or with an older shape —
     * would otherwise throw out of here and take the watching loop with it.
     * The window would then never close itself, for every platform, with one
     * confusing line in the log. "No page check" is a perfectly good answer.
     */
    const probe = loadCore<{
      hasPageProbe?: (platform: string) => boolean
      pageProbeScript?: (platform: string, extras: Record<string, unknown>) => string | null
      readPageProbe?: (platform: string, value: unknown) => boolean | null
    }>('common/sessionPageProbe')

    if (typeof probe?.hasPageProbe !== 'function' || !probe.hasPageProbe(platformKey)) return null

    const script = probe.pageProbeScript?.(platformKey, extras)

    // The extras it needs have not been read yet — "ask again later", not a
    // verdict.
    if (!script) return null

    const value: unknown = await window.webContents.executeJavaScript(script, true)

    return probe.readPageProbe?.(platformKey, value) ?? null
  } catch (error) {
    logger.info(
      `[capture] ${platformKey}: the in-page check could not run — ` +
        `${error instanceof Error ? error.message : String(error)}`
    )

    return null
  }
}

const recogniseCaptured = async (
  platformKey: string,
  jar: unknown,
  extras: Record<string, unknown>
): Promise<{ ok: boolean | null; detail: string }> => {
  const { checkSessionIdentity } = loadCore<{
    checkSessionIdentity: (
      platform: string,
      record: unknown,
      options?: { logger?: unknown }
    ) => Promise<{ ok: true | false | null; who: string | null; detail: string }>
  }>('common/sessionIdentity')

  try {
    const identity = await checkSessionIdentity(platformKey, { jar, ...extras }, { logger })

    if (identity.ok !== null) return { ok: identity.ok, detail: identity.detail }

    logger.info(`[capture] ${platformKey}: identity check — ${identity.detail}`)
  } catch (error) {
    // Never fatal: an improvement on the probe below, not a replacement.
    logger.info(
      `[capture] ${platformKey}: identity check could not run — ` +
        `${error instanceof Error ? error.message : String(error)}`
    )
  }

  const probed = await probePlatformSession(platformKey, jar, extras)

  return {
    ok: probed,
    detail:
      probed === false
        ? 'the platform check answered as it does for a signed-out login'
        : 'the platform check could not tell'
  }
}

const extrasFromJar = (platformKey: string, jar: HarvestedCookie[]): Record<string, unknown> => {
  try {
    const descriptor = getSessionExtras(platformKey) as ExtrasDescriptor | null

    return descriptor?.fromJar ? descriptor.fromJar(jar) : {}
  } catch (error) {
    logger.warn(`Could not read ${platformKey} session extras from the jar`, error)

    return {}
  }
}

const collectExtras = (
  platformKey: string,
  jar: HarvestedCookie[],
  fromPage: Record<string, unknown> | null
): Result<Record<string, unknown>> => {
  const descriptor = getSessionExtras(platformKey) as ExtrasDescriptor | null

  if (!descriptor) return ok({})

  const result: Record<string, unknown> = descriptor.fromJar
    ? descriptor.fromJar(jar)
    : (fromPage ?? {})

  if (typeof result.warning === 'string') logger.warn(`${platformKey}: ${result.warning}`)
  if (typeof result.error === 'string') return fail('VALIDATION_ERROR', result.error)

  // Checked here rather than left to the backend: it answers with a 400 whose
  // wording is about its own contract, and the operator needs to know their
  // sign-in did not finish carrying what it needed.
  const missing = descriptor.required.filter((field) => {
    const value = result[field]

    return value === undefined || value === null || value === '' ||
      (Array.isArray(value) && value.length === 0)
  })

  if (missing.length > 0) {
    return fail(
      'VALIDATION_ERROR',
      `The ${platformKey} sign-in did not yield ${missing.join(' and ')} — the login cannot be used without it`
    )
  }

  return ok(result)
}

/**
 * Signs in on this machine and stores the result through the backend.
 *
 * The login is the platform's own, from @trackvid/automation-core, driven by a
 * browser this app installed — Automated-Scripts is not in the path at all.
 *
 * If the backend cannot be reached, the session is NOT lost: it is real and it
 * works, and the only thing missing is the write to the shared database. It is
 * queued locally, encrypted, and the Sessions screen offers an Update button to
 * ship it when the network is back.
 */
const captureHere = async (
  platform: {
    key: string
    label: string
    ingestPath: string
    jarFormat: string
    cookieDomains: readonly string[]
  },
  username: string,
  credentialId: string,
  token: string,
  // Who signs in: the platform's scripted login by default, or — for a portal
  // that refuses the app's own window — the operator, in the same real Chrome.
  // Storage below is identical either way.
  signIn: (
    platform: string,
    username: string,
    credentialId: string
  ) => Promise<Result<LocalLoginResult>> = loginLocally
): Promise<Result<CaptureSessionResult>> => {
  const signedIn = await signIn(platform.key, username, credentialId)

  if (!signedIn.success) return signedIn

  // The core hands back whatever shape that platform's login produces; the
  // ingest endpoint wants its own. Both rules live in the core so this app and
  // the server cannot disagree about either.
  const jar = signedIn.data.jar
  const asCookies: HarvestedCookie[] = Array.isArray(jar)
    ? jar
    : Object.entries(jar).map(([name, value]) => ({ name, value, domain: '' }))

  const extras: Record<string, unknown> = {
    ...(signedIn.data.extra ?? {}),
    ...(signedIn.data.tokens ?? {})
  }

  const body = {
    username,
    jar: shapeJar(asCookies, platform.jarFormat),
    ...extras,
    source: 'cms-desktop',
    capturedAt: new Date().toISOString()
  }

  /**
   * ASK THE MARKETPLACE BEFORE CALLING THIS A SESSION.
   *
   * The window path has done this for a long time — a jar of public-page
   * cookies is not a session, however many of them there are — and this path,
   * the scripted one, did not. So a login that drove the form, landed on the
   * dashboard and harvested eight cookies was stored and announced as
   * "1 updated" whether or not the marketplace recognised any of it.
   *
   * What that looked like in the field: Session update reports success at
   * 06:16:14, the Sessions page turns green, and Auto claim probes the very
   * same jar at 06:17:01 and is told it is anonymous — so the account's claims
   * are skipped forty-five seconds after an operator watched the sign-in
   * succeed. Re-capturing repeats it exactly, because nothing in the loop ever
   * checks the thing that is wrong.
   *
   * `false` stops the capture here: nothing is sent to the backend and nothing
   * is written locally, so the old session — which may still work — is kept and
   * the operator is told what actually happened.
   *
   * `null` is NOT a failure. It means no probe exists for the platform (AJIO,
   * whose probe needs a live page) or that the check could not run at all.
   * Refusing a real session because a network call hiccuped would be its own
   * bug, so the capture proceeds and the backend's validation is the next gate.
   */
  /**
   * WITH THE EXTRAS, not just the cookies.
   *
   * A jar is not always the whole session. Flipkart signs every API call with
   * `fk-csrf-token`, double-submit against a cookie, and answers 403
   * EBADCSRFTOKEN the moment the header is missing — which is what a probe
   * given only `body.jar` sends, because the token lives beside the jar rather
   * than in it.
   *
   * So the probe was failing on its own malformed request and reporting that as
   * "the marketplace does not recognise this session". Every Flipkart capture
   * was refused, no matter how good the sign-in was: the operator watched the
   * OTP go in, the dashboard load and nineteen cookies come back, and was told
   * Flipkart answers as if nobody is signed in.
   *
   * The core's probe takes exactly this third argument and spreads it into the
   * record (`{ jar, ...extra }`); it was simply never passed.
   *
   * Derived from the jar as a fallback, for a login path that returns the
   * cookies without surfacing the token. Flipkart's descriptor does that from
   * the jar alone, no page needed — and an explicitly returned value still
   * wins, because it came from the sign-in itself.
   */
  const probeExtras = { ...extrasFromJar(platform.key, asCookies), ...extras }
  const verdict = await recogniseCaptured(platform.key, body.jar, probeExtras)
  const recognised = verdict.ok

  if (recognised === false) {
    /**
     * WHAT WAS ACTUALLY CAPTURED, named.
     *
     * A refusal here is confusing precisely because the sign-in worked — the
     * operator watched the browser reach a logged-in dashboard with the
     * company's own name on it. So the question is never "did it log in", it is
     * "which cookies came back", and without this line there is no way to
     * answer it: the jar is encrypted at rest and the only other record is a
     * count.
     *
     * The DUPLICATE count matters as much as the names. The jar is flattened to
     * `{ name: value }` before it is stored, and a marketplace that sets the
     * same cookie name on two domains or paths loses one of the two — silently,
     * and the survivor is whichever came last.
     *
     * Names only, never values: a cookie value IS the session.
     */
    const names = signedIn.data.cookieNames
    const distinct = new Set(names)
    const shaped = Object.keys(body.jar).length

    logger.warn(
      `[capture] ${platform.label}/${username}: signed in, but the marketplace does not ` +
        `recognise the captured session — ${verdict.detail} — nothing was saved`
    )
    logger.warn(
      `[capture] ${platform.label}/${username}: captured ${names.length} cookie(s) ` +
        `(${distinct.size} distinct, ${shaped} stored): ${[...names].sort().join(', ')}`
    )

    return fail(
      'VALIDATION_ERROR',
      `Signed in to ${platform.label}, but ${platform.label} does not recognise the login that ` +
        `was captured — ${verdict.detail}. Nothing has been saved, so the previous login is ` +
        'untouched. If re-capturing from the Login page, where you can watch the sign-in, ' +
        'gives the same answer, the sign-in is working and it is the ACCOUNT the marketplace ' +
        'will not name — check that it is still an active seller there.'
    )
  }

  if (recognised === null) {
    logger.warn(
      `Could not verify the ${platform.label} session before saving it — ${verdict.detail}`
    )
  }

  const stored = await apiRequest<{ message?: string }>(platform.ingestPath, {
    method: 'POST',
    token,
    body
  })

  if (stored.success) {
    await rememberSession(platform.key, username, asCookies)
    // And in the local company document, which is what the automations read.
    // Without this it still holds the OLD jar until the next Sync, so an import
    // started right after a re-capture would use the session that was just
    // replaced — the one most likely to be dead.
    await rememberCompanySession(platform.key, username, body)

    /**
     * SAY SO, THE MOMENT IT IS SAVED.
     *
     * The other storage path announces and this one did not, and this is the
     * one the SCHEDULED run uses. So a nightly Session update fixed account
     * after account in silence: the Settings card kept every chip red, and the
     * banner kept naming platforms whose sessions had just been replaced, until
     * somebody pressed Refresh.
     *
     * Per account rather than at the end of the run, because that is what makes
     * it live — the operator watching sees each chip turn green as its sign-in
     * lands, which is also the only progress this job can honestly show.
     */
    announceSessionsChanged(platform.key, username)

    return ok({
      platform: platform.key,
      username,
      cookieCount: signedIn.data.cookieNames.length,
      message: stored.data?.message ?? `${platform.label} login saved`
    })
  }

  // Distinguish "the backend said no" from "the backend was not there". A
  // rejected payload will be rejected again tomorrow, so queueing it would give
  // the operator an Update button that can never succeed.
  const unreachable = /cannot reach|took too long|network|timeout|econnrefused/i.test(
    stored.error.message
  )

  if (!unreachable) {
    logger.error(`${platform.label} session was rejected by the backend`, stored.error)

    return fail(
      stored.error.code,
      `Signed in to ${platform.label}, but the server would not store the session: ${stored.error.message}`
    )
  }

  const queued = await queuePending({
    platform: platform.key,
    platformLabel: platform.label,
    username,
    credentialId,
    capturedAt: new Date().toISOString(),
    expiresAt: null,
    cookieCount: signedIn.data.cookieNames.length,
    payload: { jar: body.jar, extras }
  })

  await rememberSession(platform.key, username, asCookies)

  return queued
    ? fail(
        'CONFLICT',
        `Signed in to ${platform.label}, but the server is unreachable. ` +
          'The login is saved on this machine — use Update to send it when you are back online.'
      )
    : fail(
        'STORAGE_ERROR',
        `Signed in to ${platform.label}, but the server is unreachable and this machine has no ` +
          'secure storage to hold the login. Re-capture once you are back online.'
      )
}

/**
 * Ships a session to the backend and keeps the two local copies in step.
 *
 * The backend is the system of record; the local copies are what let an
 * automation run here without database access. All three used to be written
 * inline at each capture site, which is how they drifted — one site wrote the
 * company document, another did not, and a run right after a capture kept using
 * the jar that had just been replaced.
 *
 * Exported because a MASTER IMPORT that signs in has a session worth keeping
 * too. Nothing else saved one, so reuse could never bootstrap: the first run
 * signed in, threw the session away, and the next run found nothing to reuse —
 * for as many runs as you cared to watch.
 *
 * @param jar    the harvested cookies, in this app's shape; reshaped per platform here
 * @param extras platform-specific fields the ingest requires (AJIO's userId and
 *               pobIds, Flipkart's csrf token) — a missing one is a 400
 */
export const publishSession = async (
  platformKey: string,
  username: string,
  jar: HarvestedCookie[],
  extras: Record<string, unknown>,
  accessToken?: string
): Promise<Result<{ message?: string }>> => {
  const platform = getPlatform(platformKey)

  if (!platform) return fail('VALIDATION_ERROR', `Unknown platform "${platformKey}"`)

  const token = accessToken ?? getAccessToken()

  if (!token) return fail('VALIDATION_ERROR', 'Sign in to TrackVid to save a login')

  const body = {
    username,
    // Per-platform shape — see shapeJar. Sending the wrong one is accepted and
    // stored, and only fails much later.
    jar: shapeJar(jar, platform.jarFormat),
    ...extras,
    source: 'cms-desktop',
    capturedAt: new Date().toISOString()
  }

  const stored = await apiRequest<{ message?: string }>(platform.ingestPath, {
    method: 'POST',
    token,
    body
  })

  if (!stored.success) {
    logger.error(`Session ingest rejected for ${platform.key}`, stored.error)

    return stored
  }

  await rememberSession(platform.key, username, jar)
  // And in the company document the automations read, so it does not keep
  // serving the jar this capture just replaced.
  await rememberCompanySession(platform.key, username, body)

  announceSessionsChanged(platform.key, username)
  runSessionFollowUp(platform.key, username)

  return stored
}

/**
 * The platform's after-session work (SESSION_FOLLOW_UPS) — Delhivery's
 * Domestic list today. Detached: the capture is already saved and reported, and
 * a failure here must not turn it into a failed one. Imported lazily because the
 * registry pulls in every runner, several of which import this file.
 *
 * Called from both `publishSession` and `captureSession`, which a desktop
 * capture passes through one after the other — so one account runs it at most
 * once a minute.
 */
const FOLLOW_UP_GAP_MS = 60 * 1000
const followUpRanAt = new Map<string, number>()

const runSessionFollowUp = (platformKey: string, username: string): void => {
  const key = `${platformKey.trim().toLowerCase()}::${username.trim().toLowerCase()}`
  const last = followUpRanAt.get(key)

  if (last !== undefined && Date.now() - last < FOLLOW_UP_GAP_MS) return
  followUpRanAt.set(key, Date.now())

  void (async () => {
    try {
      const { sessionFollowUp } = await import('../automations/registry')
      const followUp = sessionFollowUp(platformKey)

      if (!followUp) return

      const result = await followUp(username)

      if (!result.success) {
        logger.warn(`[session-follow-up] ${platformKey}/${username}: ${result.error.message}`)
      }
    } catch (error) {
      logger.warn(
        `[session-follow-up] ${platformKey}/${username}: ${error instanceof Error ? error.message : String(error)}`
      )
    }
  })()
}

/**
 * Tells any open window that a session changed.
 *
 * FROM HERE, because everything funnels through `publishSession`: the Sessions
 * page's button, the banner's "Update now", the nightly Session update, a
 * claim runner harvesting a jar it just signed in with, a renewal. The
 * renderer had a pub/sub for this and it was process-local by design — so the
 * captures that happen with nobody watching, which are exactly the ones worth
 * announcing, announced nothing. The red banner sat over a scheduled run that
 * had just fixed every session it named, until somebody pressed Refresh.
 *
 * Fire-and-forget and payload-light: every listener re-reads health for itself,
 * because the question "is this session usable" has one answer and it is not
 * this function's to guess.
 */
const announceSessionsChanged = (platform: string, username: string): void => {
  broadcast(PLATFORM_SESSION_EVENTS.changed, { platform, username })
  // And the same news to this process, where the schedule may be holding
  // everything back because the logins were not usable. A capture made by
  // hand on the Login page has to count for that too, not only the Login
  // update's own.
  sessionChanged()
}

/**
 * Says which account is being signed in, and says when nothing is.
 *
 * The companion to `announceSessionsChanged`, and it exists because that one
 * only ever fires at the END of a capture. A scheduled run works through its
 * accounts one at a time, up to a minute each, and for that minute the screen
 * had nothing to distinguish the account in hand from the ones still queued —
 * so a run in progress and a run that had stalled looked the same.
 *
 * Pass null when the account is done, whatever the outcome. Every exit from the
 * loop has to reach one, or a chip spins forever over a run that ended.
 */
export const announceSessionCapturing = (target: SessionCapturingEvent | null): void => {
  broadcast(PLATFORM_SESSION_EVENTS.capturing, target)
}

/**
 * Announces the capture either side, then runs it.
 *
 * Split from the body because the name of the process is not known until the
 * payload has been read — and the body has a dozen exits, half of which are
 * `fail(...)` rather than a throw, so wrapping it whole is the only way the
 * closing line cannot go missing.
 */
/**
 * Did the session ACTUALLY land where everything else reads it from?
 *
 * Every capture route reports success from a different vantage point: the
 * ingest returning 200, the automation server saying it drove a browser, a
 * local store accepting a jar. None of them is the thing that decides whether a
 * claim can run — that is the credential record TrackVid serves back, and the
 * two came apart in the field: a Delhivery capture announced "Sessions updated"
 * while the server kept reporting the account as never captured, so the gate
 * re-opened on the next press and the operator had no way to see why.
 *
 * So the claim is checked against the record. A capture that cannot be
 * confirmed is reported as a FAILURE naming what was written and what came
 * back, which is the difference between a loop and a bug report.
 *
 * Its own failure to READ is not a failure to capture: an unreachable server a
 * second after a successful ingest says nothing about the ingest.
 */
const confirmStored = async (
  platform: string,
  username: string,
  result: Result<CaptureSessionResult>
): Promise<Result<CaptureSessionResult>> => {
  if (!result.success) return result

  const health = await sessionHealth()

  if (!health.success) {
    logger.warn(
      `[capture] could not confirm the ${platform} session for ${username}: ${health.error.message}`
    )

    return result
  }

  const entry = health.data.find(
    (row) => row.platform.trim().toLowerCase() === platform.trim().toLowerCase()
  )
  const credential = entry?.credentials.find(
    (row) => row.username.trim().toLowerCase() === username.trim().toLowerCase()
  )

  if (!credential) {
    return fail(
      'CONFLICT',
      `Signed in to ${platform}, but TrackVid has no credential called ${username} on this ` +
        'company — the login was written against an account this company does not list.'
    )
  }

  if (healthOf(credential.session) === 'none') {
    return fail(
      'CONFLICT',
      `Signed in to ${platform} as ${username}, but TrackVid still reports no login for that ` +
        'account. The sign-in worked and the server did not keep it — nothing that needs a ' +
        'login will run until this is fixed.'
    )
  }

  return result
}

export const captureSession = async (payload: unknown): Promise<Result<CaptureSessionResult>> => {
  const input = payload as CaptureSessionInput
  const platform = String(input?.platform ?? '').toLowerCase().trim()
  const username = String(input?.username ?? '').trim()
  const label = processName(platform, 'session capture', username)

  return withProcessLogResult(label, async () => {
    const confirmed = await confirmStored(platform, username, await runCapture(payload))

    // Every capture route ends here, including the server renewal, which never
    // passes through `publishSession` on this machine.
    if (confirmed.success) runSessionFollowUp(platform, username)

    return confirmed
  })
}

const runCapture = async (payload: unknown): Promise<Result<CaptureSessionResult>> => {
  const input = payload as CaptureSessionInput
  const platformKey = String(input?.platform ?? '').toLowerCase().trim()
  const username = String(input?.username ?? '').trim()
  const credentialId = String(input?.credentialId ?? '').trim()

  const platform = getPlatform(platformKey)
  if (!platform) return fail('VALIDATION_ERROR', `Unknown platform "${input?.platform ?? ''}"`)
  if (!username) return fail('VALIDATION_ERROR', 'A marketplace username is required')

  const token = getAccessToken()
  if (!token) return fail('VALIDATION_ERROR', 'Sign in to TrackVid before capturing a login')

  if (openCaptures.has(platform.key)) {
    openCaptures.get(platform.key)?.focus()
    return fail('VALIDATION_ERROR', `A ${platform.label} sign-in window is already open`)
  }

  // Auto-login runs the platform's own proven login through the automation
  // server — the same path Trackvid-Monitor's Renew button uses, and the same
  // `login<Platform>Api` that runs mid-batch. It already knows every portal's
  // landing page, launcher, SSO chain and cookie scoping, and it writes the
  // session in the shape that platform's ingest expects.
  //
  // Only when auto-login is off does the app open its own window, and then the
  // operator is signing in by hand anyway.
  // Three routes to a session, chosen in this order:
  //
  //   1. backend        MAIN_VITE_USE_BACKEND_FOR_SESSION_UPDATE=true — the
  //                     automation server signs in and this app reports it.
  //   2. automatic here MAIN_VITE_SESSION_UPDATE_AUTOMATICALLY=true AND the
  //                     company has auto-login on for this platform — the app
  //                     runs the platform's own login from the core, and the
  //                     operator does nothing after pressing the button.
  //   3. manual here    otherwise — the app opens the marketplace login page
  //                     and the operator signs in themselves.
  //
  // Two switches guard route 2 because they answer different questions. The env
  // flag is the MACHINE's ("may this computer drive a browser unattended?"),
  // the Monitor setting is the COMPANY's ("should this platform be automated?").
  // Either saying no falls through to manual, which always works.
  //
  // Storage never varies: every route writes the session through the backend.
  const unattended = input?.unattended === true
  const companyAllows = await autoLoginEnabled(platform.key)

  /*
   * THE COMPANY SWITCH HOLDS FOR THE LOGIN UPDATE TOO.
   *
   * Unattended runs used to ignore `isAutoLoginOnActiveSession` here and rely
   * on the Login update's target list to leave those platforms out. A list
   * read a minute earlier is not the setting, so the capture itself refuses:
   * a platform the company set to manual is never signed in by a schedule.
   */
  if (unattended && !companyAllows) {
    logger.info(`[session-update] ${platform.key}/${username}: skipped — automatic sign-in is off for ${platform.label}`)

    return fail(
      'VALIDATION_ERROR',
      `Skipped — automatic sign-in is off for ${platform.label}. Re-capture it on the Login page.`
    )
  }

  const automaticHere =
    !env.useBackendForSessionUpdate &&
    env.sessionUpdateAutomatically &&
    companyAllows

  if (automaticHere) {
    return captureHere(platform, username, credentialId, token)
  }

  if (env.useBackendForSessionUpdate && (await autoLoginEnabled(platform.key))) {
    const renewed = await renewSessionOnServer(platform.key, credentialId)

    if (renewed.success) {
      logger.info(`Renewed ${platform.label} for ${username} without operator input`)

      return ok({
        platform: platform.key,
        username,
        cookieCount: renewed.data?.cookieNames?.length ?? 0,
        message: renewed.data?.message ?? `${platform.label} login renewed`
      })
    }

    // Do NOT quietly open a manual window here.
    //
    // That is what the first version did, and it turned "the automation server
    // is unreachable" into two different lies: Flipkart opened a login page
    // that sat there forever, and Delhivery answered "it signs in with OAuth
    // tokens, so it cannot be captured in this app" — a true sentence about the
    // wrong problem. Neither mentioned the server, which was the only thing
    // actually wrong.
    //
    // Auto-login is on, so report why it failed and let the operator decide.
    logger.error(`Automatic ${platform.label} renewal failed`, renewed.error)

    // Only add the "is the server up?" advice when that is plausibly the
    // problem. The runner's own messages are already written for an operator —
    // "Myntra did not show its login form … try again in a few minutes" needs
    // no help, and appending server advice to it sends them to check something
    // that is working fine.
    const looksUnreachable =
      /cannot reach|took too long|internal server error|network|timeout|econnrefused/i.test(
        renewed.error.message
      )

    return fail(
      renewed.error.code,
      looksUnreachable
        ? `Could not renew ${platform.label} automatically: ${renewed.error.message} ` +
          'Auto-login runs the sign-in on the automation server, so it needs that server reachable. ' +
          `Turn auto-login off for ${platform.label} to sign in from this app instead.`
        : `Could not renew ${platform.label}: ${renewed.error.message}`
    )
  }

  /**
   * EVERYTHING BELOW NEEDS A PERSON, so a scheduled run stops here.
   *
   * A window opened at 02:00 cannot be completed by anybody: it would hold the
   * account's whole budget, close itself on the timeout and fail anyway, having
   * told nobody anything in the meantime. The account is reported by name
   * instead, which is what an operator reads in the morning.
   */
  if (unattended) {
    return fail(
      'VALIDATION_ERROR',
      `${platform.label} could not be signed in with nobody present — ` +
        (env.sessionUpdateAutomatically
          ? 'its scripted sign-in did not run. Re-capture it on the Login page.'
          : 'automatic sign-in is turned off on this installation, so nothing can sign in by itself.')
    )
  }

  // Only reached when auto-login is off or the server renewal failed. Delhivery
  // and Xbees have no cookie session at all — their portals hand out OAuth
  // tokens, which a local window cannot capture. The server can, so this is a
  // dead end rather than a fallback.
  if (platformsNeedingTokenCapture().includes(platform.key)) {
    return fail(
      'VALIDATION_ERROR',
      `${platform.label} signs in with OAuth tokens rather than cookies, so it cannot be captured by signing in ` +
        'through a window — the tokens never appear as cookies to harvest. Its login has to be minted by the ' +
        'platform login, so enable automatic sign-in for it, or renew it from Monitor.'
    )
  }

  // Manual sign-in for a portal that refuses the app's own window. Myntra sits
  // behind Akamai: its login request from an Electron window is refused ("Network
  // Error" under LOG IN) however carefully the operator types, because the
  // window's client hints and JS-visible fingerprint say Chromium while its
  // user-agent says Chrome. The automated sign-in never saw this — it drives the
  // installed Google Chrome. So the manual one now does too: same browser, same
  // headers, the operator types. Closing Chrome cancels, like closing the window.
  if (needsRealBrowserForManualSignIn(platform.key)) {
    if (operatorCaptures.has(platform.key)) {
      return fail('VALIDATION_ERROR', `A ${platform.label} sign-in is already open in Chrome`)
    }

    operatorCaptures.add(platform.key)

    try {
      return await captureHere(platform, username, credentialId, token, operatorLoginLocally)
    } finally {
      operatorCaptures.delete(platform.key)
    }
  }

  const partition = partitionFor(platform.key, username)

  // Always, not just when a session looks stale: the operator asked for a new
  // session by pressing the button, and reusing a live one would answer a
  // different question.
  await wipeCaptureData(partition)

  /**
   * Hidden only where the sign-in genuinely needs no screen.
   *
   * Myntra with the headless preference on: the page is loaded because the
   * request is submitted from it and the cookies land in it, but nothing is
   * clicked, so nothing has to be looked at. `revealLoginWindow` puts it on
   * screen the moment that path gives up — a hidden window waiting for a
   * person is the one outcome worse than a visible one nobody needed.
   */
  const startHidden =
    platform.key === 'myntra' &&
    getPreferences().myntraHeadlessLogin &&
    (await autoLoginEnabled(platform.key))

  const { window, closed, loaded } = openLoginWindow(
    platform.key,
    platform.label,
    platform.loginUrl,
    partition,
    startHidden
  )

  // Started before the sign-in, not after: on the manual path the operator
  // closes the window, and by the time this code runs again the page is gone.
  const extrasWatch = watchPageExtras(
    window,
    getSessionExtras(platform.key) as ExtrasDescriptor | null
  )

  /*
   * And the window closes itself once the marketplace says the operator is in.
   *
   * The instruction on the row — "sign in, then close the window" — asks them
   * to know that closing is what saves it. This makes that a fallback rather
   * than the contract: closing still works, and still is the only signal on a
   * platform whose session cannot be verified from a jar.
   */
  const signInWatch = closeWhenSignedIn(
    window,
    platform,
    partition,
    () => extrasWatch.latest() ?? {}
  )

  await loaded

  // A scripted sign-in either finishes the job or hands the window back. When
  // it finishes, close the window ourselves so the operator is not left staring
  // at a signed-in marketplace wondering what to do; otherwise fall through to
  // the original contract, where closing the window IS the signal.
  const attempt: SignInAttempt = window.isDestroyed()
    ? { signedIn: false, attempted: false }
    : await trySignIn(window, platform.key, platform.label, username)

  const signedIn = attempt.signedIn

  // From here the window is the operator's. One they cannot see is one they
  // cannot finish, so a hidden window is shown the moment the scripted path
  // did not sign in.
  if (!signedIn) revealLoginWindow(window)

  let lastExtras: Record<string, unknown> | null = null

  // Let the post-sign-in redirect chain finish writing its cookies before the
  // window is taken away. Only on the scripted path: a human closes the window
  // themselves, by which point the chain is long done.
  if (signedIn && !window.isDestroyed()) {
    const settled = await settleCookies(partition, platform.cookieDomains)

    if (settled.length >= MIN_COOKIES) {
      // One last read while the page is still alive — the scripted path can
      // reach this within a second of sign-in, before the poller's next tick.
      const descriptor = getSessionExtras(platform.key) as ExtrasDescriptor | null
      const finalRead = descriptor?.pageScript ? await readPageExtras(window, descriptor) : null

      if (finalRead) lastExtras = finalRead

      // After the extras read, because the hop navigates away from the page the
      // script needs.
      if (descriptor?.visitAfterLogin?.length) {
        await visitAfterLogin(window, descriptor.visitAfterLogin)
      }

      if (!window.isDestroyed()) window.close()
    } else {
      // Signed in, but the session never materialised. Closing now would throw
      // away the one thing that might still fix it — the page is live and may
      // simply be slow, or showing a consent screen the sign-in did not expect.
      // Leave it with the operator and fall back to close-when-done.
      await logCookieDiagnostics(partition, platform)
      logger.warn(
        `${platform.label} signed in but only ${settled.length} cookie(s) settled — leaving the window open`
      )
    }
  }

  // Bounded only when the caller asked for it — see `waitMs`. On timeout the
  // window is closed here so the harvest below still runs: a partial jar is
  // reported as too small, which is a better answer than hanging.
  if (typeof input?.waitMs === 'number' && input.waitMs > 0) {
    const timedOut = Symbol('timed-out')
    const outcome = await Promise.race([
      closed,
      new Promise(resolve => setTimeout(() => resolve(timedOut), input.waitMs))
    ])

    if (outcome === timedOut) {
      logger.warn(
        `${platform.label} sign-in window was not completed within ${Math.round(input.waitMs / 1000)}s — closing it`
      )

      if (!window.isDestroyed()) window.close()
      await closed
    }
  } else {
    await closed
  }

  extrasWatch.stop()
  signInWatch.stop()

  const jar = await harvest(partition, platform.cookieDomains)

  // The backend rejects a jar under three cookies as unusable; catching it here
  // means the operator is told "you are not signed in" rather than shown a 400.
  if (jar.length < MIN_COOKIES) {
    logger.warn(`Capture for ${platform.key} harvested only ${jar.length} cookies`)
    return fail(
      'VALIDATION_ERROR',
      signedIn
        ? `No ${platform.label} login found — the sign-in completed but set no cookies.`
        : attempt.attempted
          ? // The scripted sign-in ran and could not finish, so say that rather
            // than blaming the operator for closing the window.
            `No ${platform.label} login found — automatic sign-in could not finish` +
            `${attempt.reason ? ` (${attempt.reason})` : ''}, and the window was closed before signing in by hand.`
          : `No ${platform.label} login found — the window was closed before sign-in completed.`
    )
  }

  /*
   * Cookies are not proof of a sign-in. A marketplace's public landing page
   * sets plenty of them — analytics, CDN, bot detection — so an operator who
   * opens the window, does not sign in, and closes it produces a jar that
   * passes every count-based check and is accepted by an ingest endpoint that
   * only rejects an EMPTY one. The session then reads Active and fails
   * everywhere else. So ask the marketplace.
   *
   * WITH THE EXTRAS, which is the whole of a bug that rejected good Flipkart
   * sign-ins. This called the bare probe with the jar alone — and Flipkart's
   * probe signs its request with `fk-csrf-token` off the RECORD. No extras, no
   * token, and Flipkart answers 403 EBADCSRFTOKEN, which the probe reads as
   * "not signed in". An operator who typed their password and their emailed
   * code, reached the Seller Dashboard and closed the window was told "that is
   * not a signed-in Flipkart login — the window was closed before sign-in
   * completed". Every word of that was wrong.
   *
   * `recogniseCaptured` is the version that already knew better: it asks the
   * identity endpoint first, which treats a CSRF refusal as a statement about
   * the REQUEST rather than the session, and only falls back to the probe.
   * Flipkart's token is in the jar (see its sessionExtras.fromJar), so there is
   * nothing to fetch — it was simply never passed.
   */
  const verifyExtras = {
    ...extrasFromJar(platform.key, jar),
    ...(extrasWatch.latest() ?? lastExtras ?? {})
  }
  const verdict = await recogniseCaptured(
    platform.key,
    shapeJar(jar, platform.jarFormat),
    verifyExtras
  )

  if (verdict.ok === false) {
    return fail(
      'VALIDATION_ERROR',
      `That is not a signed-in ${platform.label} login — ${verdict.detail}. Nothing has been saved.`
    )
  }

  // `null` means the check could not run (no check for this platform, or the
  // network refused). Not the same as a failed one: refusing a real session
  // because a check hiccuped would be its own bug. Proceed, and let the
  // backend's own validation be the next gate.
  if (verdict.ok === null) {
    logger.warn(`Could not verify the ${platform.label} session before saving it: ${verdict.detail}`)
  }

  // Named cookies the automation cannot work without. Checked here so the
  // operator reads "Myntra did not set erp.at" rather than a backend 400
  // phrased in terms of the endpoint's own contract.
  const descriptor = getSessionExtras(platform.key) as ExtrasDescriptor | null
  const present = new Set(jar.map((cookie) => cookie.name))
  const missingCookies = (descriptor?.requiredCookies ?? []).filter((name) => !present.has(name))

  if (missingCookies.length > 0) {
    await logCookieDiagnostics(partition, platform)

    return fail(
      'VALIDATION_ERROR',
      `The ${platform.label} sign-in did not set ${missingCookies.join(' and ')} — ` +
        'the login cannot be used without those cookies.'
    )
  }

  // A jar is not a whole session everywhere. AJIO also needs the seller's
  // activeSellerProfileId and places of business; Flipkart needs its csrf
  // token. Resolved from the core so the server and this app agree.
  const extras = collectExtras(platform.key, jar, extrasWatch.latest() ?? lastExtras)

  if (!extras.success) {
    logger.error(`${platform.label} session details incomplete`, extras.error)

    return extras
  }

  const response = await publishSession(platform.key, username, jar, extras.data, token)

  if (!response.success) return response

  logger.info(
    `Captured ${platform.label} session for ${username} (${jar.length} cookies` +
      `${signedIn ? ', scripted sign-in' : ''})`
  )
  return ok({
    platform: platform.key,
    username,
    cookieCount: jar.length,
    message: response.data?.message ?? `${platform.label} login saved`
  })
}

/**
 * End every sign-in this app has in flight, wherever it is happening.
 *
 * FOR SIGNING OUT, and the reason is in one log:
 *
 *   06:01:16  [session-update] 5/7 — flipkart · …     a sign-in starts
 *   06:01:21  User signed out                          token gone, stores cleared
 *   06:01:50  Local flipkart sign-in failed            34s later, unsaveable
 *
 * `requestScheduleStop` already stops the NEXT account; the one in flight ran
 * on, driving a marketplace for a company this app had just left, in front of
 * whoever uses the machine next. Nothing it produced could be saved — the
 * access token it writes with was cleared at 06:01:21 — so the whole 34 seconds
 * was spent on an outcome that could not exist.
 *
 * A SIGN-IN IS SAFE TO ABANDON, unlike a claim: nothing is half-written at the
 * marketplace, and the stored session is untouched. The worst case is a login
 * somebody has to do again.
 *
 * Two kinds, because there are two kinds of sign-in: the app's own capture
 * window, and the real browser the scripted logins drive (see the core's
 * common/openBrowsers). Best effort on both — this runs while things are being
 * torn down, and one that will not close must not stop the sign-out.
 */
export const abandonSignIns = async (reason: string): Promise<number> => {
  let ended = 0

  for (const [key, window] of openCaptures) {
    if (window.isDestroyed()) continue

    logger.info(`[sign-out] closing the ${key} sign-in window — ${reason}`)
    window.close()
    ended += 1
  }

  return ended + (await abandonScriptedSignIns(reason))
}

/**
 * Close the real browsers the scripted logins drive — and only those.
 *
 * What a per-marketplace Skip on the Login update needs: the run is one
 * scripted sign-in at a time, and the operator's own capture window (if one is
 * open) is theirs, not the run's. Best effort, never throws.
 */
export const abandonScriptedSignIns = async (reason: string): Promise<number> => {
  try {
    const browsers = loadCore<{ closeAllBrowsers: (why?: string) => Promise<number> }>(
      'common/openBrowsers'
    )

    return await browsers.closeAllBrowsers(reason)
  } catch (error) {
    // An older core pin has no registry. A scripted sign-in then ends at its
    // own timeout as it did before.
    logger.info(
      `[sign-in] could not end the scripted sign-ins — ` +
        `${error instanceof Error ? error.message : String(error)}`
    )

    return 0
  }
}

export const cancelCapture = (payload: unknown): Result<{ cancelled: boolean }> => {
  const key = String((payload as { platform?: string })?.platform ?? '').toLowerCase().trim()
  const window = openCaptures.get(key)
  if (!window) return ok({ cancelled: false })
  window.close()
  return ok({ cancelled: true })
}

/**
 * Session health for every credential this company has, per platform.
 *
 * Reads GET /api/cms/my-company-credentials, which already existed for the
 * browser extension. It returns one bucket per platform, and each credential
 * carries a <platform>Session summary — cookie *names*, never values — with the
 * other seven platforms' fields nulled out. This flattens that into one shape so
 * the UI does not have to know the per-platform field names.
 */
interface RawCredential {
  credentialId?: unknown
  username?: unknown
  accountType?: unknown
  vendorCode?: unknown
  isVerified?: unknown
  visible?: unknown
  isOtpBased?: unknown
  /** Present on the generic `platforms` array; the named buckets use <platform>Session. */
  session?: unknown
  [sessionField: string]: unknown
}

interface CredentialsResponse {
  /**
   * Derived from whatever the company actually has, so it can never omit a
   * platform. Absent on API builds older than TrackVid-BE's generic view, which
   * is why the named buckets below are still read as a fallback.
   */
  platforms?: { platform?: unknown; credentials?: RawCredential[] }[]
  [namedBucket: string]: unknown
}

const asString = (value: unknown): string => (typeof value === 'string' ? value : '')
const asNullableString = (value: unknown): string | null =>
  typeof value === 'string' && value.length > 0 ? value : null

const toSummary = (raw: unknown): SessionSummary | null => {
  if (!raw || typeof raw !== 'object') return null
  const s = raw as Record<string, unknown>
  return {
    savedAt: asNullableString(s.savedAt),
    expiresAt: asNullableString(s.expiresAt),
    ip: asNullableString(s.ip),
    source: asNullableString(s.source),
    hasProxySession: s.hasProxySession === true,
    cookieNames: Array.isArray(s.cookieNames) ? s.cookieNames.filter((n): n is string => typeof n === 'string') : [],
    // Never from the server: the marketplace's verdict is something THIS
    // machine learned by asking, and `withRejections` stamps it below.
    rejectedAt: null,
    rejectedDetail: null
  }
}

const toRow = (raw: RawCredential, sessionField: string): CredentialRow => ({
  credentialId: asString(raw.credentialId),
  username: asString(raw.username),
  accountType: asString(raw.accountType),
  vendorCode: asString(raw.vendorCode),
  isVerified: raw.isVerified === true,
  // Absent means visible: the field was added later and older credentials
  // predate it, so defaulting to hidden would blank out most of the list.
  visible: raw.visible !== false,
  // Epoch ms from the server; anything else (absent, null, a string) means
  // "never synced" rather than a date this app should try to interpret.
  masterDataSync: typeof raw.masterDataSync === 'number' && raw.masterDataSync > 0 ? raw.masterDataSync : null,
  // Absent means nobody has said, which is NOT the same as false: false is a
  // decision to skip the code, absent is the old behaviour of attempting it.
  isOtpBased: typeof raw.isOtpBased === 'boolean' ? raw.isOtpBased : null,
  // The generic array normalises the session onto `session`; the named buckets
  // carry it under the platform's own field name.
  session: toSummary(raw.session ?? raw[sessionField]),
  // Filled in from the LOCAL company document below — the credentials endpoint
  // does not report POBs, and this app already holds the document that does.
  pobCount: 0,
  pobSyncedAt: null,
  slaveCount: 0,
  slavesSyncedAt: null,
  domesticCount: 0,
  domesticsSyncedAt: null
})

/**
 * Adds each Delhivery credential's Domestic count from the local company
 * document. Same shape and reasoning as `withSlaves` and `withPobs`.
 */
const withDomestics = async (platforms: PlatformCredentials[]): Promise<PlatformCredentials[]> => {
  const delhivery = platforms.find(entry => entry.platform === 'delhivery')

  if (!delhivery) return platforms

  const local = await credentialsFor('delhivery')

  for (const row of delhivery.credentials) {
    const match = local.find(
      (entry) => entry.username.trim().toLowerCase() === row.username.trim().toLowerCase()
    )

    if (!match) continue

    row.domesticCount = match.domestics.length
    row.domesticsSyncedAt = match.domesticsSyncedAt
  }

  return platforms
}

/**
 * Adds each Tata CliQ credential's slave count from the local company document.
 *
 * Same reasoning as `withPobs`, and the same source: the credentials endpoint
 * does not report slaves, and this app already holds the document they live on.
 * A screen that showed "never synced" only after a claim failed would be
 * showing it too late.
 */
const withSlaves = async (platforms: PlatformCredentials[]): Promise<PlatformCredentials[]> => {
  const tatacliq = platforms.find(entry => entry.platform === 'tatacliq')

  if (!tatacliq) return platforms

  const local = await credentialsFor('tatacliq')

  for (const row of tatacliq.credentials) {
    const match = local.find(
      (entry) => entry.username.trim().toLowerCase() === row.username.trim().toLowerCase()
    )

    if (!match) continue

    row.slaveCount = match.slaves.length
    row.slavesSyncedAt = match.slavesSyncedAt
  }

  return platforms
}

/**
 * Adds each Tata CliQ credential's Cloudflare Access inbox from the local
 * company document, for the Login page to show and copy.
 *
 * Includes refused logins, unlike `withSlaves`: the row someone is fixing is
 * the one they need this address on. No local copy resolves to the default
 * inbox, which is where the OTP reader would look too.
 */
const withCloudflareEmail = async (platforms: PlatformCredentials[]): Promise<PlatformCredentials[]> => {
  const tatacliq = platforms.find(entry => entry.platform === 'tatacliq')

  if (!tatacliq) return platforms

  const local = await credentialsFor('tatacliq', { includeRefused: true })

  for (const row of tatacliq.credentials) {
    const match = local.find(
      (entry) => entry.username.trim().toLowerCase() === row.username.trim().toLowerCase()
    )

    row.cloudflareEmail = cloudflareInboxOf(match ?? null)
  }

  return platforms
}

/**
 * Adds each AJIO credential's POB count from the local company document.
 *
 * Not from `/cms/my-company-credentials`: that endpoint has never reported
 * POBs, and this app already keeps the document they live on. A screen that
 * showed "never synced" only after a claim failed for it would be showing it
 * too late — every AJIO tool here refuses without a POB list.
 */
const withPobs = async (platforms: PlatformCredentials[]): Promise<PlatformCredentials[]> => {
  const ajio = platforms.find(entry => entry.platform === 'ajio')

  if (!ajio) return platforms

  const local = await credentialsFor('ajio')

  for (const row of ajio.credentials) {
    const match = local.find(
      (entry) => entry.username.trim().toLowerCase() === row.username.trim().toLowerCase()
    )

    if (!match) continue

    row.pobCount = match.pobIds.length
    row.pobSyncedAt = match.pobSyncedAt
  }

  return platforms
}

const usable = (rows: RawCredential[], sessionField: string): CredentialRow[] =>
  rows.map((raw) => toRow(raw, sessionField)).filter((row) => row.visible && row.username.length > 0)

/**
 * Stamps on the sessions the marketplace has actually refused.
 *
 * WHY THE SERVER CANNOT TELL US THIS. The credentials endpoint reports what was
 * stored and when it is guessed to expire. Whether the cookies still
 * authenticate is something only a live probe knows, and the probes run HERE —
 * so the one fact that matters most was being discovered on this machine every
 * night and then dropped on the floor. Every screen that reads session health
 * goes through this function, so they all now say the same thing.
 *
 * Same shape as `withPobs` and `withSlaves`: one local read, folded into rows
 * the endpoint could not fill in.
 */
/**
 * Marks each login the marketplace has refused (`is_verified: false`), so
 * every screen and the Login update read one answer — see `CredentialRow.refused`.
 * Best effort: an unreadable company copy marks nothing.
 */
const withRefusals = async (platforms: PlatformCredentials[]): Promise<PlatformCredentials[]> => {
  for (const bucket of platforms) {
    const refused = await refusedLogins(bucket.platform).catch(() => new Set<string>())

    if (refused.size === 0) continue

    for (const row of bucket.credentials) {
      if (refused.has(row.username.trim().toLowerCase())) row.refused = true
    }
  }

  return platforms
}

const withRejections = async (
  platforms: PlatformCredentials[]
): Promise<PlatformCredentials[]> => {
  await withRefusals(platforms)

  const rejections = await sessionRejections()

  if (rejections.size === 0) return platforms

  for (const bucket of platforms) {
    for (const row of bucket.credentials) {
      if (!row.session) continue

      const rejected = rejections.get(sessionRejectionKey(bucket.platform, row.username))

      if (!rejected) continue

      // A session captured AFTER the rejection is a different session, and the
      // old verdict says nothing about it. The stamp is cleared on capture, so
      // this is a backstop for a machine that was rejected, re-captured from
      // the Sessions page on another machine, and synced.
      if (row.session.savedAt && Date.parse(row.session.savedAt) > Date.parse(rejected.at)) {
        continue
      }

      row.session.rejectedAt = rejected.at
      row.session.rejectedDetail = rejected.detail
    }
  }

  return platforms
}

/**
 * Asks the marketplace about every session the DATES call healthy.
 *
 * WHY THE NIGHTLY RUN HAS TO DO THIS. `healthOf` compares `expiresAt` to the
 * clock, and that value is a guess made at capture time. A session revoked, or
 * invalidated by a login elsewhere, or bound to an IP that has changed, keeps
 * an expiry days away and reads "Saved" — so the 02:00 Session update looked at
 * it, found nothing to do, and the 04:00 Auto claim then passed the account's
 * claims over because the marketplace refused the very same jar.
 *
 * ONE PROBE PER ACCOUNT, and only for the ones that would otherwise be left
 * alone: anything already expired, expiring or missing is a target on the dates
 * alone and does not need asking. A probe is a single request; the sign-in it
 * saves — or triggers — is a browser.
 *
 * `unverifiable` and `probe-failed` change NOTHING. AJIO's probe needs a live
 * page and is permanently the first; a flat network is the second. Re-capturing
 * on "cannot tell" would sign in to every AJIO account every night.
 *
 * Mutates the rows it was given, so the caller's next `sessionUpdateTargets`
 * sees the verdicts — one rule, applied to better data, rather than a second
 * list of what needs work.
 */
export interface SessionVerdict {
  platform: string
  username: string
  credentialId: string | null
  /** Did the marketplace accept the stored session? */
  usable: boolean
  /** Why not, in the marketplace's own words. Null when it was accepted. */
  detail: string | null
  /**
   * It could not be ASKED — offline, or the probe itself failed.
   *
   * Not a verdict about the jar, and must never be read as one: stamping a
   * good session dead on one slow night stops every claim on the account until
   * somebody re-captures it by hand.
   */
  unreachable: boolean
  /** How long this session had been alive when it was checked, in hours. */
  maintainedHours: number | null
}

/** Whole hours between a session being saved and now. */
const maintainedHours = (session: SessionSummary | null): number | null => {
  if (!session?.savedAt) return null

  const saved = Date.parse(session.savedAt)

  if (Number.isNaN(saved)) return null

  return Math.max(0, Math.round((Date.now() - saved) / 3_600_000))
}

export const verifySavedSessions = async (
  platforms: PlatformCredentials[]
): Promise<SessionVerdict[]> => {
  const verdicts: SessionVerdict[] = []

  for (const bucket of platforms) {
    if (!getPlatform(bucket.platform)) continue

    for (const row of bucket.credentials) {
      if (row.visible === false || !row.username.trim()) continue

      /*
       * EVERY STORED SESSION IS ASKED ABOUT, whatever its expiry says.
       *
       * This used to skip anything `healthOf` did not call 'active' — which
       * meant the expiry decided who got asked. That expiry is not measured;
       * it is a TTL from a constant, and the constant is wrong. So a session
       * the date called expired was never asked and was re-captured on trust,
       * costing a browser sign-in — and on Tata CliQ an emailed one-time code
       * — for a jar the marketplace would have accepted.
       *
       * Asking is one cheap request. Guessing is a sign-in.
       */
      if (!row.session) continue

      // Read before anything can rewrite the session, so a refusal reports how
      // long the jar it is refusing had actually lasted.
      const hours = maintainedHours(row.session)

      /**
       * WHERE SIGNING IN AGAIN IS THE CHECK.
       *
       * Xbees has no cookie jar and no browser step — its session is a bearer
       * token from one API call. Asking "is this token still good?" and then
       * signing in when the answer is no is two calls to settle what one call
       * settles, and the one call leaves a FRESH token behind either way.
       *
       * The core declares which platforms these are; the sign-in stays here,
       * because driving a login is the consumer's job and a shared library
       * should not start one from a health check.
       */
      if (renewsOnCheck(bucket.platform)) {
        const renewed = await captureSession({
          platform: bucket.platform,
          username: row.username,
          credentialId: row.credentialId
        })

        if (renewed.success) {
          logger.info(`[session-update] ${bucket.platform}/${row.username}: signed in again`)

          verdicts.push({
            platform: bucket.platform,
            username: row.username,
            credentialId: row.credentialId ?? null,
            usable: true,
            detail: null,
            unreachable: false,
            maintainedHours: hours
          })

          continue
        }

        // A refused sign-in IS the verdict here — there is nothing else to ask.
        row.session.rejectedAt = new Date().toISOString()
        row.session.rejectedDetail = renewed.error.message

        verdicts.push({
          platform: bucket.platform,
          username: row.username,
          credentialId: row.credentialId ?? null,
          usable: false,
          detail: renewed.error.message,
          unreachable: false,
          maintainedHours: hours
        })

        continue
      }

      const verdict = await reusableSession(bucket.platform, row.username)

      /*
       * ONLY 'dead' IS A VERDICT ABOUT THE JAR.
       *
       * 'probe-failed' and 'unverifiable' say the MARKETPLACE did not answer,
       * or that nothing here can tell — neither says the session is bad.
       * Stamping those would record a good session as dead on one slow night
       * and stop every claim on the account until a re-capture.
       */
      const dead = verdict.reason === 'dead'
      const unreachable = verdict.reason === 'probe-failed' || verdict.reason === 'unverifiable'

      if (dead) {
        // `reusableSession` has already written this to the rejection store —
        // the copy here is the same fact, put where the caller can act on it
        // without re-reading the session health it is holding.
        row.session.rejectedAt = new Date().toISOString()
        row.session.rejectedDetail = verdict.detail
      } else if (!unreachable && row.session.rejectedAt) {
        /*
         * ACCEPTED, SO THE OLD STAMP GOES.
         *
         * Without this a session refused once carried its stamp for ever:
         * `healthOf` reads the stamp before anything else, so it stayed
         * "rejected" and was re-captured on every run even after the
         * marketplace had started accepting it again.
         */
        row.session.rejectedAt = null
        row.session.rejectedDetail = null
        await forgetSessionRejected(bucket.platform, row.username)
      }

      verdicts.push({
        platform: bucket.platform,
        username: row.username,
        credentialId: row.credentialId ?? null,
        usable: !dead && !unreachable,
        detail: dead ? verdict.detail : null,
        unreachable,
        maintainedHours: hours
      })
    }
  }

  const refused = verdicts.filter(entry => !entry.usable && !entry.unreachable)

  if (refused.length > 0) {
    logger.warn(
      `[session-update] ${refused.length} session(s) were refused by the marketplace — ` +
        're-capturing them'
    )
  }

  return verdicts
}

export const sessionHealth = async (): Promise<Result<PlatformCredentials[]>> =>
  withOfflineCache('session-health', fetchSessionHealth)

/**
 * Removing a saved session — here, on the server, and everywhere this app
 * caches one.
 *
 * WHY ALL FOUR PLACES. A captured session is written to the backend, to an
 * encrypted store on this machine, and into the local copy of the company
 * document, and a rejection stamp may be sitting beside it. Clearing only the
 * server leaves the automations reading a jar from the local document that the
 * operator believes is gone — which is worse than not offering the button,
 * because now they have been told it worked.
 *
 * THE SERVER GOES FIRST, and a refusal stops everything. It is the copy the
 * other three are derived from: wiping the local ones against a server that
 * still holds the jar would have the next Sync put it straight back, and the
 * button would look intermittent rather than broken.
 */
export const clearPlatformSession = async (payload: unknown): Promise<Result<{ platform: string }>> => {
  const request = (payload ?? {}) as { platform?: unknown; username?: unknown }
  // Narrowed rather than coerced: `String(someObject)` is "[object Object]",
  // which would travel to the backend as a platform name and be refused there
  // rather than caught here.
  const asText = (value: unknown): string => (typeof value === 'string' ? value : '')
  const key = platformKey(asText(request.platform))
  const username = asText(request.username).trim()

  if (!key || !username) return fail('VALIDATION_ERROR', 'Pick the account to remove')

  const token = getAccessToken()

  if (!token) return fail('VALIDATION_ERROR', 'Sign in to TrackVid to remove a login')

  const removed = await apiRequest('/cms/clear-session', {
    method: 'POST',
    token,
    body: { platform: key, username }
  })

  if (!removed.success) {
    logger.error(`Could not remove the ${key} session for ${username}`, removed.error)

    return removed
  }

  await forgetSession(key, username)
  await forgetCompanySession(key, username)
  // The stamp outliving the session it described is a permanently red account
  // that re-capturing cannot clear — see rememberCompanySession.
  await forgetSessionRejected(key, username)

  logger.info(`Removed the ${key} session for ${username}`)

  return ok({ platform: key })
}

/**
 * Every saved session this company holds, on every platform.
 *
 * SEPARATE FROM THE ONE ABOVE rather than the same call with its arguments
 * omitted — on the server side too. The gap between the two is one credential
 * signing in again and an entire company doing so, and a request that reaches
 * the wide behaviour through a dropped field is the shape of an expensive
 * mistake. It has to be asked for by name.
 */
export const clearAllPlatformSessions = async (): Promise<Result<{ cleared: boolean }>> => {
  const token = getAccessToken()

  if (!token) return fail('VALIDATION_ERROR', 'Sign in to TrackVid to remove logins')

  const removed = await apiRequest<{ changed?: boolean }>('/cms/clear-all-sessions', {
    method: 'POST',
    token,
    body: {}
  })

  if (!removed.success) {
    logger.error('Could not remove this company’s sessions', removed.error)

    return removed
  }

  await forgetAllSessions()
  await forgetCompanySession()

  for (const platform of PLATFORMS) {
    for (const credential of await credentialsFor(platform.key)) {
      await forgetSessionRejected(platform.key, credential.username)
    }
  }

  logger.warn('Removed every saved marketplace session on this installation')

  return ok({ cleared: true })
}

/**
 * Session health, with every healthy-looking session actually checked.
 *
 * What the Session update card's "Check now" calls. The rows come back with
 * `rejectedAt` on anything the marketplace refused, so the card lists the
 * accounts that need re-capturing rather than the accounts whose expiry date
 * has run out — which, for a revoked session, is nobody.
 *
 * The verdicts are written to the rejection store as a side effect of the
 * probe, so the banner and the next `sessionHealth` agree with what is shown
 * here without this call having to touch the cache.
 */
export const verifySessionHealth = async (): Promise<Result<PlatformCredentials[]>> => {
  const health = await sessionHealth()

  if (!health.success) return health

  await verifySavedSessions(health.data)

  return ok(health.data)
}


const fetchSessionHealth = async (): Promise<Result<PlatformCredentials[]>> => {
  const token = getAccessToken()
  if (!token) return fail('VALIDATION_ERROR', 'Sign in to TrackVid to see login health')

  const response = await apiRequest<CredentialsResponse>('/cms/my-company-credentials', { token })
  if (!response.success) return response

  const payload = response.data ?? {}

  // This screen is where an operator checks what Re-capture will do, and they
  // reach it right after flipping the switch in Monitor. A 60-second cache
  // would show them the old answer and make the badge untrustworthy, so this
  // one read pays for a fresh fetch. It is user-initiated and infrequent.
  clearRoutingCache()

  // Resolved once for every platform rather than per bucket: the routing call
  // is cached again after the first await, so the map below stays synchronous.
  // What the operator will actually get, not just what the company setting
  // says. An automatic sign-in needs the company's per-platform switch AND this
  // machine's env flag; on the backend route only the company switch applies,
  // because the server is the one driving the browser. A badge reading
  // "Auto-login" over a button that opens a manual window would be a lie.
  const autoLogin = new Map<string, { effective: boolean; blockedBy?: 'company' | 'machine' | 'no-script' }>(
    await Promise.all(
      PLATFORMS.map(async (p) => {
        const companyAllows = await autoLoginEnabled(p.key)

        // On the backend route the SERVER drives the browser, and it can sign
        // in to platforms this app cannot script itself — Tata CliQ's login
        // needs an emailed code that only the server's mailbox holds. So the
        // descriptor below is not required there.
        if (env.useBackendForSessionUpdate) {
          return [
            p.key,
            companyAllows ? { effective: true } : { effective: false, blockedBy: 'company' as const }
          ] as const
        }

        /**
         * CAN THE CORE SIGN THIS PLATFORM IN? — which is not the same question
         * as "is there a form descriptor for it".
         *
         * This asked `getLoginForm`, the declarative step list `driveLogin`
         * walks inside an Electron BrowserWindow. But that is only how the
         * MANUAL window route works. The automatic route calls the core's own
         * `renewPlatformSession`, which for two platforms drives a browser it
         * owns rather than a descriptor — and Tata CliQ is one of them.
         *
         * So Tata CliQ was reported as having no scripted sign-in while the
         * app was already signing into it for Refill Data and account mapping,
         * through the very function the capture path would have called. The
         * nightly run skipped it as "needs a person" for a login it could do.
         *
         * `canRenew` is the core's own list, and it is the one the capture
         * actually uses. The difference between the two tests is exactly Tata
         * CliQ: the other eight have both.
         */
        const blockedBy = !companyAllows
          ? ('company' as const)
          : !env.sessionUpdateAutomatically
            ? ('machine' as const)
            : !canRenew(p.key)
              ? ('no-script' as const)
              : undefined

        return [p.key, blockedBy ? { effective: false, blockedBy } : { effective: true }] as const
      })
    )
  )

  // Preferred path: the server tells us which platforms the company has.
  if (Array.isArray(payload.platforms)) {
    return ok(
      await withRejections(
      await withDomestics(
      await withCloudflareEmail(
      await withSlaves(
        await withPobs(payload.platforms
        .map((entry) => {
          const key = asString(entry.platform).toLowerCase().trim()
          const known = getPlatform(key)
          if (!known) return null
          return {
            platform: known.key,
            reported: true,
            autoLogin: autoLogin.get(known.key)?.effective ?? true,
            ...(autoLogin.get(known.key)?.blockedBy
              ? { autoLoginBlockedBy: autoLogin.get(known.key)!.blockedBy! }
              : {}),
            credentials: usable(entry.credentials ?? [], known.sessionField)
          }
        })
          .filter((entry): entry is PlatformCredentials => entry !== null))
      )
      )
      )
      )
    )
  }

  // Fallback for API builds predating the generic view. A missing key means the
  // build does not know that platform, not that the company lacks it.
  const unreported = PLATFORMS.filter((p) => payload[p.key] === undefined).map((p) => p.key)
  if (unreported.length > 0) {
    logger.warn('Credentials endpoint omitted platforms', { platforms: unreported })
  }

  return ok(
    await withRejections(
    PLATFORMS.map((platform) => {
      const bucket = payload[platform.key]
      return {
        platform: platform.key,
        reported: Array.isArray(bucket),
        autoLogin: autoLogin.get(platform.key)?.effective ?? true,
        ...(autoLogin.get(platform.key)?.blockedBy
          ? { autoLoginBlockedBy: autoLogin.get(platform.key)!.blockedBy! }
          : {}),
        credentials: Array.isArray(bucket) ? usable(bucket as RawCredential[], platform.sessionField) : []
      }
    })
    )
  )
}


/** Sessions captured here that the backend has not accepted yet. */
export const pendingSessions = async (): Promise<Result<PendingSummary[]>> => ok(await listPending())

/**
 * Ships one queued session to the backend.
 *
 * The session was already captured and is already real — this is only the write
 * that could not happen offline. On success the queue entry is dropped; on a
 * rejection it is dropped too, because a payload the server refuses today it
 * will refuse tomorrow, and an Update button that can never succeed is worse
 * than none. Only an unreachable server leaves it queued to try again.
 */
export const flushPendingSession = async (payload: unknown): Promise<Result<{ platform: string }>> => {
  const input = (payload ?? {}) as { platform?: string; username?: string }
  const platformKey = String(input.platform ?? '').toLowerCase().trim()
  const username = String(input.username ?? '').trim()

  const platform = getPlatform(platformKey)

  if (!platform) return fail('VALIDATION_ERROR', `Unknown platform "${input.platform ?? ''}"`)

  const token = getAccessToken()

  if (!token) return fail('VALIDATION_ERROR', 'Sign in to TrackVid first')

  const queued = await readPending(platformKey, username)

  if (!queued) return fail('NOT_FOUND', 'That login is no longer queued on this machine')

  const stored = await apiRequest<{ message?: string }>(platform.ingestPath, {
    method: 'POST',
    token,
    body: {
      username,
      jar: queued.payload.jar,
      ...queued.payload.extras,
      source: 'cms-desktop',
      capturedAt: queued.summary.capturedAt
    }
  })

  if (stored.success) {
    await discardPending(platformKey, username)
    await rememberCompanySession(platformKey, username, {
      jar: queued.payload.jar,
      ...queued.payload.extras,
      source: 'cms-desktop',
      capturedAt: queued.summary.capturedAt
    })
    logger.info(`Uploaded the queued ${platform.label} session for ${username}`)
    announceSessionsChanged(platformKey, username)

    return ok({ platform: platformKey })
  }

  const unreachable = /cannot reach|took too long|network|timeout|econnrefused/i.test(
    stored.error.message
  )

  if (!unreachable) {
    await discardPending(platformKey, username)

    return fail(
      stored.error.code,
      `The server rejected the saved ${platform.label} session: ${stored.error.message} ` +
        'It has been discarded — re-capture to try again.'
    )
  }

  return fail('CONFLICT', `Still cannot reach the server. The ${platform.label} login is still saved here.`)
}

/**
 * Whether signing in to one credential costs a one-time code.
 *
 * SNAPDEAL, FLIPKART AND AJIO ONLY, because they are the ones that vary by
 * account: each raises a code on some seller accounts and not others, and nothing in the
 * app can work out which without spending a login finding out. Tata CliQ always
 * raises one and everything else never does, so a flag there could only be a
 * way to break a sign-in that works.
 *
 * Written to TrackVid, then patched into the LOCAL company copy so the very
 * next sign-in reads it — without that the setting would only take effect after
 * the next Sync, which is most of its value gone.
 */
/** The marketplaces whose OTP is an account-level setting, not a platform one. */
export const OTP_OPTIONAL_PLATFORMS = ['snapdeal', 'flipkart', 'ajio']

export const setCredentialOtpMode = async (payload: unknown): Promise<Result<{ isOtpBased: boolean }>> => {
  const request = (payload ?? {}) as { platform?: unknown; credentialId?: unknown; isOtpBased?: unknown }
  const platform = asString(request.platform).toLowerCase()
  const credentialId = asString(request.credentialId)
  const isOtpBased = request.isOtpBased === true
  const token = getAccessToken()

  if (!OTP_OPTIONAL_PLATFORMS.includes(platform)) {
    return fail('VALIDATION_ERROR', `${platform || 'That marketplace'} does not vary by account`)
  }
  if (!credentialId) return fail('VALIDATION_ERROR', 'No account was named')
  if (!token) return fail('VALIDATION_ERROR', 'Sign in to change this')

  const response = await apiRequest<{ isOtpBased: boolean }>('/cms/credential-otp-mode', {
    method: 'POST',
    token,
    body: { platform, credentialId, isOtpBased }
  })

  if (!response.success) return response

  await rememberOtpMode(platform, credentialId, isOtpBased)

  logger.info(`[otp-mode] ${platform}/${credentialId} → ${isOtpBased ? 'code expected' : 'no code'}`)

  return ok({ isOtpBased })
}
