import { createRequire } from 'node:module'
import { env } from '@main/config/env'
import { ensureBrowser, ensureDriverFor } from '@main/services/browserProvision.service'
import { logger } from '@main/services/logger'
import { autoLoginEnabled } from '@main/services/automationRouting.service'

/**
 * Puts @trackvid/automation-core into "running on a desktop" mode.
 *
 * The core is written for the automation server, and four of its assumptions
 * are wrong here. Every entry point that runs core automation locally has to
 * correct all four, which is why this is one function rather than a checklist
 * each caller repeats:
 *
 *   1. no database        the desktop has no Mongo and must never hold its
 *                         credentials; sessions go to the backend over HTTP
 *   2. no upstream proxy  the operator's connection already IS residential,
 *                         which is what the server rents Bright Data for
 *   3. a real browser     puppeteer-core ships none, so it must be told which
 *                         binary to launch, and Selenium needs a matching driver
 *   4. env the core reads MASTER_SERVER_BASE_URL and friends come from a .env
 *                         on the server; a packaged app has no such file
 *
 * Missing any one of them fails late and confusingly — the browser one arrives
 * as "An `executablePath` or `channel` must be specified for `puppeteer-core`",
 * minutes into a job, from a library the caller never mentioned.
 *
 * Idempotent, and safe to call at the top of any local run.
 */

const load = createRequire(import.meta.url)

const core = <T>(subpath: string): T => load(`@trackvid/automation-core/${subpath}`) as T

interface SessionPersistence {
  disableSessionPersistence: (why?: string) => void
}

interface NetworkRoute {
  useDirectConnection: (why?: string) => void
}

interface Headless {
  setAutoLoginEnabled: (platform: string, enabled: boolean) => void
}

interface BrowserRuntime {
  setChromeExecutablePath: (path: string | null) => void
  setChromedriverPath: (path: string | null) => void
  /** How the core asks for a driver matching a browser it did not pin. */
  setDriverProvider: (provider: (binaryPath: string) => Promise<string | null>) => void
  setPinnedFallbackAllowed: (allowed: boolean) => void
}

let processPrepared = false
let browserPrepared = false

/** The parts that need no I/O. Safe to call anywhere, any number of times. */
const prepareProcess = (): void => {
  if (processPrepared) return

  core<SessionPersistence>('common/sessionPersistence').disableSessionPersistence(
    'the desktop app has no database access; sessions go to the backend over HTTP'
  )
  core<NetworkRoute>('common/networkRoute').useDirectConnection(
    'the desktop app runs from the operator’s own connection'
  )

  // The core reads these from process.env. A packaged app has no .env — it is a
  // build input — so the baked-in values are published here.
  process.env.HEADLESS = env.headless ? 'true' : 'false'
  // <PLATFORM>_HEADLESS, for the platforms that set one. Only published when
  // present, so an unset key falls through to HEADLESS in the core rather than
  // being pinned to the string "undefined".
  for (const [platform, value] of Object.entries(env.platformHeadless)) {
    if (value) process.env[`${platform.toUpperCase()}_HEADLESS`] = value
  }
  // Read by the core's claimSubmitGuard, which every platform's submit call
  // asserts on.
  //
  // Published UNCONDITIONALLY — 'true' or 'false' — so the app's own setting is
  // the only thing that decides. Writing it only when true left the opposite
  // case reading whatever was already in process.env, and the core's
  // `loadEnv()` puts the raw .env there in development: a stray
  // `DISABLE_SUBMIT=true` line silently beat `MAIN_VITE_DISABLE_SUBMIT=false`,
  // and it only did so in dev, because a packaged build has no dotenv to load
  // it with. Dev held claims back while a packaged build would have filed them.
  process.env.DISABLE_SUBMIT = env.disableSubmit ? 'true' : 'false'
  process.env.MASTER_SERVER_BASE_URL = env.masterServerBaseUrl
  process.env.TRACKVID_GET_USER_PROFILE_URL = env.userProfileUrl
  // Where a downloaded report is uploaded. The core does not default it, so
  // leaving it unset failed as `TypeError: Invalid URL` inside axios, three
  // retries after the download had already succeeded.
  process.env.TRACKVID_IMPORTDATA_API_URL = env.importDataUrl
  // The AJIO claim flow builds its own S3 URL from these two. Unset, it fetches
  // https://s3.undefined.amazonaws.com/undefined/<key> and the claim's
  // side-images PDF never downloads.
  process.env.AWS_BUCKET_REGION = env.s3Region
  process.env.AWS_BUCKET_NAME = env.s3Bucket

  logger.info(
    `Core prepared for desktop execution (browser ${env.headless ? 'headless' : 'visible'})` +
      (env.disableSubmit ? ' — DISABLE_SUBMIT is ON: no claim will be filed' : '')
  )
  processPrepared = true
}

/**
 * Everything above, plus a browser.
 *
 * Separate because provisioning can download ~150MB on first use, and a caller
 * that only needs the process settings should not pay for that.
 *
 * @param onProgress surfaced to the UI during a first-run download
 */
/**
 * Tells the core who signs this platform in, which decides whether a window
 * is drawn.
 *
 * `settings.isAutoLoginOnActiveSession[platform]`:
 *
 *   true   the app signs in by script → HEADLESS / <PLATFORM>_HEADLESS decide
 *          whether anyone watches it happen
 *   false  a PERSON signs in by hand  → the window is shown, always
 *
 * The second is not a preference the environment may override. A manual
 * sign-in in a headless browser is a browser nobody can type into — the
 * automation would wait for a login that cannot happen.
 *
 * Resolved per run rather than once at startup: the setting is company data
 * that Trackvid-Monitor can change while the app is open, and the next
 * automation should obey the new value without a restart.
 */
const applyAutoLoginPolicy = async (platform?: string): Promise<void> => {
  if (!platform) return

  try {
    core<Headless>('common/headless').setAutoLoginEnabled(
      platform,
      await autoLoginEnabled(platform)
    )
  } catch (error) {
    // A routing lookup that fails must not stop the automation. The core's own
    // default is "follow the environment", which is what happened before this
    // existed.
    logger.warn(`Could not read the auto-login policy for ${platform}`, error)
  }
}

export const prepareCoreWithBrowser = async (
  onProgress?: (message: string) => void,
  platform?: string
): Promise<void> => {
  prepareProcess()
  await applyAutoLoginPolicy(platform)

  if (browserPrepared) return

  onProgress?.('Preparing the browser…')

  const paths = await ensureBrowser((percent) => onProgress?.(`Downloading browser… ${percent}%`))
  const runtime = core<BrowserRuntime>('common/browserRuntime')

  runtime.setChromeExecutablePath(paths.chrome)
  // Selenium needs the driver too, and it must match the browser.
  runtime.setChromedriverPath(paths.chromedriver)
  /*
   * And a driver for the browsers this app did NOT pin. Myntra drives the
   * operator's own Chrome on purpose, whose major version the pinned driver
   * cannot match — and Selenium Manager, which is meant to cover exactly that,
   * answered "Unable to obtain browser driver" from inside the packaged app.
   * See ensureDriverFor.
   */
  runtime.setDriverProvider(ensureDriverFor)
  /*
   * And never the pinned build in its place. Myntra in Chrome for Testing is a
   * login Akamai refuses every time — "Network Error" under a "only for
   * automated testing" banner — so a missing Chrome or driver is reported as
   * exactly that, with the fix, instead of opening a window that cannot work.
   */
  runtime.setPinnedFallbackAllowed(false)

  browserPrepared = true
}

export const prepareCoreProcess = prepareProcess
