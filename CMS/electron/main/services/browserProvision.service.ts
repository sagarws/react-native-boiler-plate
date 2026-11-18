import { join } from 'node:path'
import { app, net } from 'electron'
import { logger } from './logger'

/**
 * The browser the marketplace logins drive, installed and pinned by this app.
 *
 * Not the operator's Chrome. Chrome auto-updates, chromedriver must match its
 * major version, and the Selenium logins (Myntra, Flipkart) would then break on
 * random machines at random times — the hardest kind of failure to support
 * remotely. Not a bundled Chromium either: the installer already carries one
 * for Electron itself, and a second would roughly double it.
 *
 * Instead: one pinned Chrome-for-Testing build, fetched into the app's own data
 * directory the first time a session is captured, with the matching
 * chromedriver beside it. Deterministic, and the same binary serves both
 * puppeteer-core and Selenium.
 *
 * Downloaded lazily rather than at install or startup — an operator who never
 * captures a session should never pay for a ~150MB download.
 */

// Pinned deliberately. Moving it is a decision, not a side effect of a rebuild:
// a new Chrome can change how a portal renders and how its bot detection reads
// the browser, and every login here is tuned against real portals.
const CHROME_BUILD = '131.0.6778.108'

export interface BrowserPaths {
  chrome: string
  chromedriver: string
}

let cached: BrowserPaths | null = null
let inFlight: Promise<BrowserPaths> | null = null

const cacheDir = (): string => join(app.getPath('userData'), 'browsers')

/**
 * Installs the pinned browser if it is not already there, and returns both
 * paths.
 *
 * Concurrent callers share one install: two platforms captured at once must not
 * race two downloads into the same directory.
 */
export const ensureBrowser = async (
  onProgress?: (percent: number) => void
): Promise<BrowserPaths> => {
  if (cached) return cached
  if (inFlight) return inFlight

  inFlight = (async (): Promise<BrowserPaths> => {
    // Required at call time: pulling the installer in at startup costs every
    // launch, including the ones that never capture a session.
    const { install, computeExecutablePath, Browser, canDownload } = await import(
      '@puppeteer/browsers'
    )

    const cacheDirectory = cacheDir()
    const common = { cacheDir: cacheDirectory, buildId: CHROME_BUILD }

    const resolve = (browser: (typeof Browser)[keyof typeof Browser]): string =>
      computeExecutablePath({ ...common, browser })

    const chrome = resolve(Browser.CHROME)
    const chromedriver = resolve(Browser.CHROMEDRIVER)

    // Already installed: computeExecutablePath only builds a path, so the file
    // has to be checked separately.
    const { access } = await import('node:fs/promises')
    const present = async (p: string): Promise<boolean> =>
      access(p).then(() => true).catch(() => false)

    if ((await present(chrome)) && (await present(chromedriver))) {
      logger.info(`Using the pinned browser already installed at ${cacheDirectory}`)
      cached = { chrome, chromedriver }

      return cached
    }

    // A PARTIAL install is the failure that actually happens here, and it does
    // not heal itself. The download is ~150MB and takes a minute; close the app
    // or lose the network partway and the build directory exists while the
    // executable inside it does not. @puppeteer/browsers then reports "All
    // providers failed" and refuses to reinstall over the leftovers, so every
    // later attempt fails the same way until someone deletes the folder by
    // hand — which is not something an operator should have to be told.
    //
    // So clear the wreckage before installing. Removing a directory whose
    // binary is missing costs nothing: it is unusable by definition.
    const fs = await import('node:fs/promises')

    for (const [browser, folder] of [
      [Browser.CHROME, 'chrome'],
      [Browser.CHROMEDRIVER, 'chromedriver']
    ] as const) {
      const binary = resolve(browser)

      if (await present(binary)) continue

      // The layout is <cacheDir>/<browser>/<platform>-<buildId>/… — the build
      // directory is the parent of everything this buildId owns.
      const stale = join(cacheDirectory, folder)

      if (await present(stale)) {
        logger.warn(`Removing an unfinished ${folder} install before retrying`)
        await fs.rm(stale, { recursive: true, force: true }).catch((error) => {
          logger.warn(`Could not remove ${stale}`, error)
        })
      }
    }

    for (const browser of [Browser.CHROME, Browser.CHROMEDRIVER] as const) {
      if (!(await canDownload({ ...common, browser }))) {
        throw new Error(
          `Chrome-for-Testing ${CHROME_BUILD} (${browser}) is not available for this platform`
        )
      }
    }

    logger.info(`Installing the pinned browser ${CHROME_BUILD} into ${cacheDirectory}`)

    await install({
      ...common,
      browser: Browser.CHROME,
      downloadProgressCallback: (downloaded: number, total: number) => {
        if (total > 0) onProgress?.(Math.round((downloaded / total) * 100))
      }
    })
    await install({ ...common, browser: Browser.CHROMEDRIVER })

    // Verify rather than trust. A truncated or partially extracted download
    // leaves a file that exists and cannot execute, and the failure then
    // surfaces much later as an unhelpful spawn error.
    if (!(await present(chrome)) || !(await present(chromedriver))) {
      // Reached only if a fresh install into a cleaned directory still produced
      // no binary — a broken download rather than leftovers. Say what to do.
      throw new Error(
        `The browser download finished but produced no runnable binary in ${cacheDirectory}. ` +
          'Check the disk has room and the network is not filtering the download, then try again.'
      )
    }

    logger.info('Pinned browser installed')
    cached = { chrome, chromedriver }

    return cached
  })()

  try {
    return await inFlight
  } finally {
    inFlight = null
  }
}

/** Whether the browser is already installed, without starting a download. */
export const browserIsInstalled = async (): Promise<boolean> => {
  if (cached) return true
  try {
    const { computeExecutablePath, Browser } = await import('@puppeteer/browsers')
    const { access } = await import('node:fs/promises')
    const path = computeExecutablePath({
      cacheDir: cacheDir(),
      buildId: CHROME_BUILD,
      browser: Browser.CHROME
    })

    await access(path)

    return true
  } catch {
    return false
  }
}

export const pinnedChromeBuild = (): string => CHROME_BUILD

/**
 * A chromedriver for a browser this app did NOT pin — the operator's own Chrome.
 *
 * WHY IT IS NEEDED AT ALL. Myntra's sign-in deliberately drives the installed
 * Google Chrome (Chrome for Testing announces itself in a banner and is refused
 * by the Akamai layer in front of the portal), and chromedriver matches its
 * browser on MAJOR version — so the pinned 131 driver beside the pinned browser
 * cannot drive a Chrome 152.
 *
 * SELENIUM MANAGER WAS SUPPOSED TO COVER THIS and does not, here. Handed no
 * service, selenium-webdriver shells out to `selenium-manager` to fetch the
 * matching driver; in the packaged app that produced "Unable to obtain browser
 * driver" on every re-capture, which is the toast an operator saw instead of a
 * login. It needs network the machine may filter and a cache it may not be able
 * to write, and it reports neither.
 *
 * So the driver is fetched the same way the pinned browser is: through
 * @puppeteer/browsers, into this app's own cache directory, where the code that
 * cleans up a half-finished download already lives.
 *
 * Returns null rather than throwing. A machine with no route to the download is
 * a machine where the sign-in falls back to the pinned browser — worse odds
 * against Akamai, but a sign-in that starts. The core decides that; this only
 * reports what it has.
 */
// Keyed by binary AND version: the app stays open for days while Chrome updates
// itself underneath it, and a driver cached for yesterday's major cannot drive
// today's — the core then falls back to the pinned testing build, banner and all.
const driversByBinary = new Map<string, string | null>()

const compareVersions = (a: string, b: string): number => {
  const left = a.split('.').map(Number)
  const right = b.split('.').map(Number)

  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0)

    if (diff !== 0) return diff
  }

  return 0
}

/**
 * Which of the version directories beside `chrome.exe` is the one that runs.
 *
 * Normally the highest — compared numerically, because as strings ".85" sorts
 * above ".100". But Chrome stages an update by unpacking the new version beside
 * the old and leaving `new_chrome.exe` until the next restart; until then
 * `chrome.exe` still launches the OLDER directory. Fetching a driver for the
 * staged major hands chromedriver a browser it refuses ("only supports Chrome
 * version N"), and the sign-in falls back to Chrome for Testing.
 *
 * Exported for the test.
 */
export const activeChromeVersion = (entries: string[]): string | null => {
  const versions = entries
    .filter((name) => /^\d+\.\d+\.\d+\.\d+$/.test(name))
    .sort(compareVersions)
  const staged = entries.some((name) => name.toLowerCase() === 'new_chrome.exe')

  if (staged && versions.length > 1) return versions[versions.length - 2] ?? null

  return versions[versions.length - 1] ?? null
}

/**
 * The build ids to ask Chrome for Testing for, best first.
 *
 * NEVER the full four-part version. `resolveBuildId` only looks up a milestone
 * ("152") or a build prefix ("152.0.7300"); anything else it returns UNCHANGED
 * without checking it exists. An operator's Chrome is routinely on a patch that
 * was never published as a testing build, so the install then 404s — and that,
 * not the network, is why only some machines fell back to the banner browser:
 * the ones whose patch happened to differ from a published one.
 *
 * chromedriver enforces only the major, so the newest driver for the same build
 * prefix, then for the same major, are both correct.
 *
 * Exported for the test.
 */
export const driverBuildCandidates = (version: string): string[] => {
  const parts = version.split('.')

  return [...new Set([parts.slice(0, 3).join('.'), parts[0] ?? version])]
}

/** The installed Chrome's full version, or null. */
export const chromeVersionOf = async (binary: string): Promise<string | null> => {
  const { readdir } = await import('node:fs/promises')
  // The namespace, not `{ dirname }`: destructuring it reads to the linter as
  // pulling a method off its object, which is a real hazard for methods that
  // use `this` and noise for the ones that do not.
  const path = await import('node:path')

  // Windows lays Chrome out as `…\Application\<full version>\chrome.dll`, so
  // the directory listing IS the version — no process to spawn.
  if (/chrome\.exe$/i.test(binary)) {
    try {
      const version = activeChromeVersion(await readdir(path.dirname(binary)))

      if (version) return version
    } catch (error) {
      logger.warn(`Could not read Chrome's version directory beside ${binary}`, error)
    }
  }

  // macOS and Linux keep no such directory, so the browser is asked.
  try {
    const { execFile } = await import('node:child_process')
    const { promisify } = await import('node:util')
    const { stdout } = await promisify(execFile)(binary, ['--version'], { timeout: 10_000 })

    return /(\d+\.\d+\.\d+\.\d+)/.exec(stdout)?.[1] ?? null
  } catch (error) {
    logger.warn(`Could not ask ${binary} for its version`, error)

    return null
  }
}

const isFullBuild = (value: string | undefined): value is string =>
  Boolean(value && /^\d+\.\d+\.\d+\.\d+$/.test(value))

const majorOf = (version: string): string => version.split('.')[0] ?? version

/**
 * The chromedriver builds already on disk for one Chrome major, newest first.
 *
 * `entries` is the listing of `<cache>/chromedriver`, whose directories are
 * `<platform>-<buildId>`. chromedriver enforces only the major, so any of these
 * drives the operator's Chrome — no network needed, and no fresh download every
 * time Chrome for Testing publishes another patch of the same major.
 *
 * Exported for the test.
 */
export const driverBuildsOnDisk = (entries: string[], platform: string, major: string): string[] =>
  entries
    .filter((name) => name.startsWith(`${platform}-${major}.`))
    .map((name) => name.slice(platform.length + 1))
    .filter(isFullBuild)
    .sort(compareVersions)
    .reverse()

/**
 * Driver directories left behind by older Chrome majors. Chrome only moves
 * forward, so they can never be used again — except the pinned build's, which
 * the Chrome-for-Testing fallback still needs.
 *
 * Exported for the test.
 */
export const staleDriverDirectories = (
  entries: string[],
  platform: string,
  currentMajor: string,
  keepBuild: string
): string[] =>
  entries.filter((name) => {
    if (!name.startsWith(`${platform}-`)) return false

    const build = name.slice(platform.length + 1)

    return isFullBuild(build) && build !== keepBuild && Number(majorOf(build)) < Number(currentMajor)
  })

/**
 * Requests that go out the way Chrome's own do.
 *
 * Node's http — what @puppeteer/browsers downloads with — knows nothing of the
 * Windows proxy, PAC script or a company's inspecting certificate. On a managed
 * machine that is the difference between the operator's Chrome opening Chrome
 * for Testing and this app being refused it: the driver page loads in the
 * browser and the driver never arrives. Electron's `net` IS Chromium's network
 * stack, so if Chrome can reach the page, so can this.
 */
const CFT_INDEX = 'https://googlechromelabs.github.io/chrome-for-testing'
const INDEX_TIMEOUT_MS = 20_000
const ARCHIVE_TIMEOUT_MS = 180_000

const fetchLikeChrome = async (url: string, timeoutMs: number): Promise<Response> => {
  const response = await net.fetch(url, { signal: AbortSignal.timeout(timeoutMs) })

  if (!response.ok) throw new Error(`${url} answered HTTP ${response.status}`)

  return response
}

/** The index lookup resolveBuildId does, through Chrome's network stack. */
const resolveLikeChrome = async (candidate: string): Promise<string | undefined> => {
  const milestone = /^\d+$/.test(candidate)
  const file = milestone ? 'latest-versions-per-milestone.json' : 'latest-patch-versions-per-build.json'
  const response = await fetchLikeChrome(`${CFT_INDEX}/${file}`, INDEX_TIMEOUT_MS)
  const data = (await response.json()) as {
    milestones?: Record<string, { version?: string }>
    builds?: Record<string, { version?: string }>
  }

  return (milestone ? data.milestones : data.builds)?.[candidate]?.version
}

/**
 * Which driver build to fetch for this Chrome — through Chrome's network first,
 * then through the library's own lookup, so a machine where only one of the two
 * gets out still resolves.
 */
const resolveDriverBuild = async (version: string, platform: string): Promise<string | null> => {
  const { resolveBuildId, Browser } = await import('@puppeteer/browsers')

  // See driverBuildCandidates for why the full version is never asked for.
  for (const candidate of driverBuildCandidates(version)) {
    const viaChrome = await resolveLikeChrome(candidate).catch((error: unknown) => {
      logger.warn(`Could not look up chromedriver ${candidate} through the system network`, error)

      return undefined
    })

    if (isFullBuild(viaChrome)) return viaChrome

    // An unresolvable tag comes back unchanged; only a real four-part build
    // is one Chrome for Testing actually published.
    const viaLibrary = await resolveBuildId(
      Browser.CHROMEDRIVER,
      platform as Parameters<typeof resolveBuildId>[1],
      candidate
    ).catch(() => undefined)

    if (isFullBuild(viaLibrary)) return viaLibrary
  }

  return null
}

/**
 * Downloads the driver archive through Chrome's network into the exact path
 * `install()` looks for one already downloaded, so the library then only
 * unpacks it. If this fails, `install()` downloads it itself — the old path,
 * kept as the second try.
 */
const preloadArchive = async (cacheDirectory: string, platform: string, buildId: string): Promise<void> => {
  const { getDownloadUrl, Cache, Browser } = await import('@puppeteer/browsers')
  const { mkdir, writeFile, rename, rm } = await import('node:fs/promises')

  const url = getDownloadUrl(
    Browser.CHROMEDRIVER,
    platform as Parameters<typeof getDownloadUrl>[1],
    buildId
  )
  // Named exactly as installUrl() names it, or the library would not find it.
  const fileName = decodeURIComponent(url.toString()).split('/').pop() ?? 'chromedriver.zip'
  const root = new Cache(cacheDirectory).browserRoot(Browser.CHROMEDRIVER)
  const archive = join(root, `${buildId}-${fileName}`)
  // Written aside and renamed: a half-written archive at the real path would be
  // unpacked as if it were whole.
  const partial = `${archive}.part`

  try {
    const response = await fetchLikeChrome(url.toString(), ARCHIVE_TIMEOUT_MS)
    const bytes = Buffer.from(await response.arrayBuffer())

    await mkdir(root, { recursive: true })
    await writeFile(partial, bytes)
    await rename(partial, archive)
  } catch (error) {
    await rm(partial, { force: true }).catch(() => undefined)
    throw error
  }
}

/** Driver directories of older majors, removed; failures only logged. */
const pruneStaleDrivers = async (cacheDirectory: string, platform: string, major: string): Promise<void> => {
  const { readdir, rm } = await import('node:fs/promises')
  const root = join(cacheDirectory, 'chromedriver')
  const entries = await readdir(root).catch(() => [] as string[])

  for (const name of staleDriverDirectories(entries, platform, major, CHROME_BUILD)) {
    // A driver still running holds its exe open on Windows; the next prune
    // gets it.
    await rm(join(root, name), { recursive: true, force: true }).catch((error: unknown) => {
      logger.warn(`Could not remove the old chromedriver ${name}`, error)
    })
  }
}

// The build each Chrome major last resolved to, for the rail's download link.
const resolvedBuilds = new Map<string, string>()

export const ensureDriverFor = async (chromeBinary: string): Promise<string | null> => {
  if (!chromeBinary) return null

  // Read every time — a directory listing on Windows — so an update between
  // two captures is seen.
  const version = await chromeVersionOf(chromeBinary)

  if (!version) return null

  const key = `${chromeBinary}@${version}`

  if (driversByBinary.has(key)) return driversByBinary.get(key) ?? null

  const remember = (value: string | null): string | null => {
    driversByBinary.set(key, value)

    return value
  }

  try {
    const { install, computeExecutablePath, detectBrowserPlatform, Browser } =
      await import('@puppeteer/browsers')
    const { access, readdir, rm } = await import('node:fs/promises')
    const present = async (p: string): Promise<boolean> =>
      access(p).then(() => true).catch(() => false)

    const platform = detectBrowserPlatform()

    if (!platform) return remember(null)

    const cacheDirectory = cacheDir()
    const major = majorOf(version)
    const driverFor = (buildId: string): string =>
      computeExecutablePath({ cacheDir: cacheDirectory, browser: Browser.CHROMEDRIVER, buildId })

    // 1. Already on disk — fetched earlier, or put there by the operator. No
    //    network at all, so a machine that cannot reach Chrome for Testing
    //    today still signs in with the driver it got yesterday.
    const entries = await readdir(join(cacheDirectory, 'chromedriver')).catch(() => [] as string[])

    for (const buildId of driverBuildsOnDisk(entries, platform, major)) {
      const driver = driverFor(buildId)

      if (await present(driver)) {
        logger.info(`Using chromedriver ${buildId} for Chrome ${version}`)
        await pruneStaleDrivers(cacheDirectory, platform, major)

        return remember(driver)
      }
    }

    // 2. Fetch it.
    const buildId = await resolveDriverBuild(version, platform)

    if (!buildId) {
      logger.warn(`Could not find a chromedriver build for Chrome ${version}`)

      return null
    }

    resolvedBuilds.set(major, buildId)

    const driver = driverFor(buildId)

    // install() refuses to reinstall over a build directory whose binary is
    // missing — the wreckage of an interrupted download. It is unusable, so
    // clear it, as ensureBrowser does.
    const buildDir = join(cacheDirectory, 'chromedriver', `${platform}-${buildId}`)

    if (await present(buildDir)) {
      await rm(buildDir, { recursive: true, force: true }).catch(() => undefined)
    }

    logger.info(`Installing chromedriver ${buildId} to drive Chrome ${version}`)
    await preloadArchive(cacheDirectory, platform, buildId).catch((error: unknown) => {
      logger.warn('Download through the system network failed; trying the direct download', error)
    })
    await install({ cacheDir: cacheDirectory, browser: Browser.CHROMEDRIVER, buildId })

    if (!(await present(driver))) return remember(null)

    await pruneStaleDrivers(cacheDirectory, platform, major)

    return remember(driver)
  } catch (error) {
    // Not fatal, and not cached as a permanent no: a network that is down now
    // may be up on the next capture, and a wrong "no" costs the real browser.
    logger.warn(`Could not obtain a chromedriver for Chrome ${version}`, error)

    return null
  }
}

/**
 * The exact archive to download for this Chrome, when its build was resolved —
 * so the rail links the one file needed instead of a page listing twenty.
 */
export const driverDownloadUrlFor = async (version: string): Promise<string | null> => {
  const buildId = resolvedBuilds.get(majorOf(version))

  if (!buildId) return null

  const { getDownloadUrl, detectBrowserPlatform, Browser } = await import('@puppeteer/browsers')
  const platform = detectBrowserPlatform()

  return platform ? getDownloadUrl(Browser.CHROMEDRIVER, platform, buildId).toString() : null
}

/** Parses `chromedriver --version` output. Exported for the test. */
export const parseDriverVersion = (stdout: string): string | null =>
  /ChromeDriver (\d+\.\d+\.\d+\.\d+)/.exec(stdout)?.[1] ?? null

export type DriverImport =
  | { imported: true; buildId: string }
  | { imported: false; reason: string }

/** Finds the chromedriver binary inside an unpacked archive, however nested. */
const findDriverBinary = async (directory: string, depth = 3): Promise<string | null> => {
  const { readdir } = await import('node:fs/promises')
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => [])

  for (const entry of entries) {
    if (entry.isFile() && /^chromedriver(\.exe)?$/i.test(entry.name)) return join(directory, entry.name)
  }

  if (depth === 0) return null

  for (const entry of entries) {
    if (!entry.isDirectory()) continue

    const found = await findDriverBinary(join(directory, entry.name), depth - 1)

    if (found) return found
  }

  return null
}

/**
 * Installs a chromedriver the operator downloaded — the zip as it came, or the
 * exe from inside it — into the place `ensureDriverFor` looks first.
 *
 * The fallback for a machine that cannot download at all: the operator fetches
 * the file in their own browser and picks it. They never unzip, run or place
 * anything by hand, and the binary's own `--version` decides where it goes, so
 * a wrong guess about the build number cannot strand it.
 */
export const importDriverFile = async (file: string, chromeMajor: string): Promise<DriverImport> => {
  const { install, computeExecutablePath, detectBrowserPlatform, getDownloadUrl, Cache, Browser } =
    await import('@puppeteer/browsers')
  const fs = await import('node:fs/promises')
  const { execFile } = await import('node:child_process')
  const { promisify } = await import('node:util')

  const platform = detectBrowserPlatform()

  if (!platform) return { imported: false, reason: 'This computer is not one ChromeDriver is published for.' }

  const cacheDirectory = cacheDir()
  // A build id no real build can collide with; the directory is temporary.
  const staging = `import-${Date.now()}`
  const stagingDir = join(cacheDirectory, 'chromedriver', `${platform}-${staging}`)

  try {
    let binary = file

    if (/\.zip$/i.test(file)) {
      // Placed where install() expects an already-downloaded archive, so the
      // library unpacks it without touching the network.
      const url = getDownloadUrl(Browser.CHROMEDRIVER, platform, staging)
      const fileName = decodeURIComponent(url.toString()).split('/').pop() ?? 'chromedriver.zip'
      const root = new Cache(cacheDirectory).browserRoot(Browser.CHROMEDRIVER)

      await fs.mkdir(root, { recursive: true })
      await fs.copyFile(file, join(root, `${staging}-${fileName}`))
      await install({ cacheDir: cacheDirectory, browser: Browser.CHROMEDRIVER, buildId: staging, platform })

      const found = await findDriverBinary(stagingDir)

      if (!found) return { imported: false, reason: 'That zip has no ChromeDriver in it.' }

      binary = found
    }

    const { stdout } = await promisify(execFile)(binary, ['--version'], { timeout: 15_000 }).catch(
      () => ({ stdout: '' })
    )
    const buildId = parseDriverVersion(stdout)

    if (!buildId) return { imported: false, reason: 'That file is not a ChromeDriver for this computer.' }

    if (majorOf(buildId) !== chromeMajor) {
      return {
        imported: false,
        reason: `That is ChromeDriver ${majorOf(buildId)}, but Chrome is ${chromeMajor}. Download the ${chromeMajor} one.`
      }
    }

    const target = computeExecutablePath({ cacheDir: cacheDirectory, browser: Browser.CHROMEDRIVER, buildId })
    // The namespace, as chromeVersionOf does, not `{ dirname }`.
    const path = await import('node:path')

    await fs.mkdir(path.dirname(target), { recursive: true })
    await fs.copyFile(binary, target)
    // Unzipping and copying can both drop the execute bit on macOS.
    await fs.chmod(target, 0o755)

    // Forget every cached answer, including "none": the next check must see it.
    driversByBinary.clear()
    logger.info(`Imported chromedriver ${buildId} from a file the operator chose`)

    return { imported: true, buildId }
  } finally {
    await fs.rm(stagingDir, { recursive: true, force: true }).catch(() => undefined)
  }
}
