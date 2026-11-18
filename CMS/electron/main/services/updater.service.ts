import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { createWriteStream, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { app, net } from 'electron'
import { isWindows } from '../platform'
import electronUpdater, { type UpdateInfo } from 'electron-updater'
import { UPDATE_EVENTS } from '@shared/constants/channels'
import { broadcast } from '../ipc/broadcast'
import type { UpdateLogEntry, UpdateState } from '@shared/types/update'
import { initialUpdateState } from '@shared/types/update'
import { isNewerVersion } from '@shared/utils/version'
import { checkReleasePolicy } from './releasePolicy.service'
import { env } from '../config/env'
import { logger } from './logger'

/**
 * Automatic updates.
 *
 * This is the only file that imports electron-updater. It translates the
 * library's event stream into one UpdateState object, pushes it to every open
 * window, and exposes three verbs: check, (implicit) download, install.
 *
 * How a release reaches a user:
 *   1. electron-builder publishes the installer plus a latest.yml manifest.
 *   2. On launch this checks that manifest for a version newer than its own.
 *   3. If there is one it downloads in the background (verifying the sha512
 *      from the manifest - electron-updater refuses a mismatched file).
 *   4. The staged installer runs on quit and relaunches the app.
 *
 * The release policy feed is a separate, optional layer on top: it can mark a
 * version as mandatory, which turns the dismissible notice into a blocking one.
 * A failure to reach it never blocks the update itself.
 *
 * CommonJS interop: electron-updater has no named ESM export, so the default
 * export is destructured rather than imported by name.
 */
const { autoUpdater } = electronUpdater

let state: UpdateState = initialUpdateState('0.0.0')
let initialised = false

/**
 * Broadcast to the app's own windows; a window that opens later reads
 * update:status instead.
 *
 * Goes through `broadcast` rather than getAllWindows() because not every window
 * is ours — session capture opens the marketplace's login page in one, and that
 * renders a third party's document.
 */
const publish = (next: Partial<UpdateState>): void => {
  state = { ...state, ...next }
  broadcast(UPDATE_EVENTS.status, state)
}

export const getUpdateState = (): UpdateState => state

/**
 * Feed the updater is configured against, for logs and error messages.
 *
 * FROM OUR OWN CONFIG, not from `autoUpdater.getFeedURL()`. That method is
 * deprecated in electron-updater and returns the literal string "Deprecated. Do
 * not use it." — which this passed straight into the message, so the one line
 * whose job was to name the host printed a library's deprecation notice
 * instead, at exactly the moment somebody needed the host.
 *
 * `env.updateFeedUrl` is the same value electron-builder baked into
 * app-update.yml, since both come from MAIN_VITE_API_BASE_URL at build time.
 */
let feedInUse: string | null = null

/**
 * What the updater did, in order, so a failure can be read from the app.
 *
 * KEPT IN MEMORY AND SMALL. This is a diagnostic an operator can open on the
 * machine that failed — not a record. Thirty lines covers a check, a download
 * and whatever went wrong; keeping more would only mean holding the last
 * fortnight of successful checks nobody will read.
 */
const LOG_LIMIT = 30
const log: UpdateLogEntry[] = []

export const getUpdateLog = (): UpdateLogEntry[] => [...log]

const record = (level: UpdateLogEntry['level'], message: string, detail?: string): void => {
  log.push({ at: new Date().toISOString(), level, message, ...(detail ? { detail } : {}) })

  if (log.length > LOG_LIMIT) log.splice(0, log.length - LOG_LIMIT)
}

const feedUrl = (): string => feedInUse ?? env.updateFeedUrl ?? '(the configured update host)'

/**
 * Points the updater at the manifest the policy names, instead of the feed
 * baked in at package time.
 *
 * WHY THIS EXISTS. `app-update.yml` is written when the installer is built and
 * is permanent for every copy shipped from it — so a release uploaded anywhere
 * that host does not serve is one no installed machine can fetch, and the only
 * channel left for telling them is the policy feed they still read. This is
 * that channel.
 *
 * ELECTRON-UPDATER WANTS THE DIRECTORY, not the file: the generic provider
 * appends `<channel>.yml` itself. So a link to
 * `https://host/releases/latest.yml` becomes url `https://host/releases` and
 * channel `latest` — and the installer named inside that manifest is fetched
 * relative to the same directory, which is why it has to hold both.
 *
 * Returns false and changes nothing when the URL cannot be read that way: a
 * feed that certainly cannot work is worse than the one the build shipped with.
 */
const useManifest = (manifestUrl: string): boolean => {
  try {
    const url = new URL(manifestUrl)
    const file = url.pathname.split('/').pop() ?? ''
    const channel = file.replace(/\.ya?ml$/i, '')

    if (channel === '' || channel === file) return false

    url.pathname = url.pathname.slice(0, -file.length)

    // Trimmed on the FINAL string: emptying the pathname makes URL put the
    // slash back, so a manifest at a host root would otherwise give
    // "https://host/" — and the updater would ask for "https://host//latest.yml".
    const directory = url.toString().replace(/\/$/, '')

    autoUpdater.setFeedURL({ provider: 'generic', url: directory, channel })
    feedInUse = directory
    logger.info('Update feed set from the release policy', { directory, channel })
    record('info', 'Feed taken from the release policy', `${directory}/${channel}.yml`)

    return true
  } catch (error) {
    logger.warn('Release policy manifest link could not be used as a feed', {
      manifestUrl,
      reason: error instanceof Error ? error.message : String(error)
    })
    record('warn', 'The policy’s manifest link could not be used — keeping the built-in feed', manifestUrl)

    return false
  }
}

/**
 * Turns an updater failure into something a person can act on.
 *
 * The generic "could not reach the update server" hid the single most common
 * setup mistake by far: the installers were uploaded but `latest.yml` was not,
 * so the host answers 404 and the app looks offline when it is perfectly online.
 * The feed URL is baked in at build time and cannot be inspected from the UI,
 * so the message names it.
 */
export const describeUpdateFailure = (error: unknown): string => {
  const raw = error instanceof Error ? error.message : String(error)
  const feed = feedUrl()

  // electron-updater surfaces a 404 as an HttpError; a missing manifest also
  // shows up as a YAML parse failure when the host returns an HTML error page.
  if (/404/.test(raw) || /Cannot parse|unexpected token|end of the stream/i.test(raw)) {
    return `No update manifest found at ${feed}. Upload latest.yml next to the installer.`
  }
  if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ETIMEDOUT|ECONNRESET/.test(raw)) {
    return `Cannot reach ${feed}. Check the connection or the update host.`
  }
  return 'Could not check for updates. The app will try again on the next start.'
}

/**
 * Auto-update only works from a packaged, installed app. In dev there is no
 * installer to replace, and electron-updater throws rather than no-opping, so
 * the whole feature is reported as unsupported instead.
 */
const canAutoUpdate = (): boolean => app.isPackaged

/** Grace period between "downloaded" and the app restarting itself. */
const AUTO_INSTALL_DELAY_MS = 3000

export const initialiseUpdater = (): void => {
  if (initialised) return
  initialised = true

  state = initialUpdateState(app.getVersion())

  if (!canAutoUpdate()) {
    state = {
      ...state,
      phase: 'unsupported',
      message: 'Automatic updates are disabled in development builds.'
    }
    logger.info('Updater disabled: not a packaged build')
    return
  }

  // Download without asking - the user is never interrupted, and nothing is
  // applied until they choose to restart.
  autoUpdater.autoDownload = true
  // The staged installer runs on quit, so a user who just closes the app gets
  // the update anyway without ever seeing a prompt.
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.logger = {
    info: (message: unknown) => logger.info(`[updater] ${String(message)}`),
    warn: (message: unknown) => logger.warn(`[updater] ${String(message)}`),
    error: (message: unknown) => logger.error(`[updater] ${String(message)}`),
    debug: (message: unknown) => logger.debug(`[updater] ${String(message)}`)
  }

  autoUpdater.on('checking-for-update', () => publish({ phase: 'checking', message: null }))

  autoUpdater.on('update-available', (info: UpdateInfo) => {
    logger.info('Update available', { version: info.version })
    record('info', `Found version ${info.version} — downloading`)
    publish({
      phase: 'available',
      latest: info.version,
      releaseNotes: typeof info.releaseNotes === 'string' ? info.releaseNotes : null
    })
  })

  autoUpdater.on('update-not-available', () => {
    // Worth a line: "nothing newer" and "never got an answer" look identical
    // on screen, and they are the two things most often confused here.
    record('info', `Nothing newer than ${state.current} at the feed`)
    publish({ phase: 'idle', latest: null, percent: 0, message: null })
  })

  autoUpdater.on('download-progress', (progress) => {
    publish({
      phase: 'downloading',
      percent: Math.round(progress.percent),
      bytesPerSecond: Math.round(progress.bytesPerSecond),
      totalBytes: progress.total
    })
  })

  autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
    logger.info('Update downloaded and staged', { version: info.version })
    record('info', `Version ${info.version} downloaded and staged`)
    publish({ phase: 'downloaded', latest: info.version, percent: 100 })

    // WHETHER THIS RESTARTS THE APP IS THE FORCE FLAG'S DECISION.
    //
    // It used to restart unconditionally — every update was compulsory, and
    // `isForceFullyUpdate` changed only how it was announced. So an operator
    // mid-claim had the app quit under them for a release nobody had called
    // urgent, and turning the flag OFF in Monitor changed nothing.
    //
    // Now: forced ends the session, optional waits. An optional update is
    // already staged on disk and `autoInstallOnAppQuit` applies it the next
    // time the app closes on its own, so choosing "Later" postpones it rather
    // than refusing it.
    if (!state.mandatory) {
      logger.info('Update staged; waiting for the user (policy does not force it)')
      return
    }

    // The delay is not a prompt. It exists so the renderer can paint
    // "restarting to install" before the window disappears, and so a write
    // already in flight can finish — pulling the process out from under
    // someone mid-keystroke is how a half-typed record gets lost.
    setTimeout(() => quitAndInstall(), AUTO_INSTALL_DELAY_MS)
  })

  autoUpdater.on('error', (error: Error) => {
    // A failed update must never take the app down with it: the user keeps
    // working on the version they have.
    logger.error('Updater error', error)
    // The download half fails here rather than in checkForUpdates — a manifest
    // that reads fine and names a file the host will not serve lands on this
    // line, so the raw text is the whole diagnosis.
    record('error', describeUpdateFailure(error), error.message)
    publish({ phase: 'error', message: describeUpdateFailure(error) })
  })

  logger.info('Updater initialised', { current: state.current })
}

/**
 * Runs a check. Also refreshes the mandatory flag from the release policy feed,
 * which is what lets a bad build be forced off the estate.
 */
export const checkForUpdates = async (): Promise<UpdateState> => {
  // THE POLICY IS CHECKED EVEN WHERE THE APP CANNOT UPDATE ITSELF.
  //
  // This used to return immediately unless the build was packaged, which meant
  // an unpackaged build never asked the server anything at all: the policy could
  // not be observed, and "is the force flag working?" had no answer short of
  // cutting a release. The fetch costs one request and is safe anywhere — it is
  // only INSTALLING that needs a packaged app.
  const policy = await checkReleasePolicy(state.current)

  if (policy) {
    // AND-ed with a real version comparison: a policy naming a version at or
    // below this build is not something to act on, forced or not. That is what
    // stops a force from blocking the build it is asking people to move to.
    const outOfDate = isNewerVersion(state.current, policy.minimumVersion)

    // BEFORE the check below, so the request that follows goes to the right
    // host. Only when the policy names one; otherwise the build keeps the feed
    // it was packaged with.
    record(
      'info',
      `Policy: version ${policy.minimumVersion}${policy.mandatory ? ' (required)' : ''}`,
      policy.manifestUrl ?? 'no manifest link — using the feed built into this app'
    )

    if (policy.manifestUrl) useManifest(policy.manifestUrl)

    publish({
      mandatory: policy.mandatory && outOfDate,
      downloadUrl: policy.downloadUrl,
      // The policy knows a version even when there is no manifest to read one
      // from, which is what lets an unpackaged build name the build it wants.
      ...(outOfDate && state.latest === null ? { latest: policy.minimumVersion } : {})
    })
  }

  // Only the electron-updater half needs a packaged app. Reaching it in dev
  // throws ("dev-app-update.yml not found") and is reported as an error the
  // user cannot act on, so it is skipped rather than attempted.
  if (!canAutoUpdate()) return state

  logger.info('Checking for updates', { current: state.current, feed: feedUrl() })
  record('info', `Asking ${feedUrl()} for anything newer than ${state.current}`)

  try {
    await autoUpdater.checkForUpdates()
  } catch (error) {
    logger.error('Update check failed', error)
    // THE RAW ERROR, not the summary. The sentence on screen says what to do;
    // this says what happened — the status the host answered, the file it was
    // asked for — which is the part that settles where the fault is.
    record('error', describeUpdateFailure(error), error instanceof Error ? error.message : String(error))
    publish({ phase: 'error', message: describeUpdateFailure(error) })
  }

  return state
}

/**
 * Quits and installs a staged update.
 *
 * The ordering here is the whole feature, so it is worth spelling out.
 * quitAndInstall() SPAWNS THE INSTALLER FIRST and only then asks the app to
 * quit. The installer immediately looks for a running instance, so anything
 * that delays this process's exit is found and reported as "TrackVid CMS cannot
 * be closed", followed by "Failed to uninstall old application files".
 *
 * Two things therefore matter:
 *
 *   isSilent: true       runs the NSIS installer with /S, so it terminates the
 *                        running instance itself rather than prompting.
 *   isForceRunAfter: true relaunches afterwards, so it reads as a restart.
 *
 * And two things must NOT happen. Windows are not destroyed here: with the
 * window-all-closed listener removed, Electron's default is to quit once the
 * last window closes, so destroying them starts a shutdown that races the
 * installer spawn. Removing the listener is still correct - it stops a
 * platform handler from vetoing the quit - but the closing itself is left to
 * electron-updater's own app.quit().
 *
 * The timer is a backstop, not the mechanism: if the graceful quit is still
 * pending a second later, exit hard so the installer's retry finds nothing
 * holding the files.
 */
// Generous on purpose. At one second this fired on every update, hard-killing
// the app while it was still shutting down normally - and a hard kill can leave
// Electron's helper processes briefly holding files in the install directory,
// which is what makes the NSIS uninstaller fail with exit code 2. It must be a
// last resort for a genuinely stuck quit, not part of the normal path.
const FORCE_EXIT_AFTER_MS = 8000

export const quitAndInstall = (): void => {
  if (state.phase !== 'downloaded') {
    logger.warn('Install requested with no staged update', { phase: state.phase })
    return
  }

  logger.info('Installing update and relaunching', { version: state.latest })

  // Documented electron-updater workaround: this listener can otherwise keep
  // the app alive after its windows close.
  app.removeAllListeners('window-all-closed')

  autoUpdater.quitAndInstall(true, true)

  const forceExit = setTimeout(() => {
    logger.warn('Graceful quit did not complete; exiting so the installer can proceed')
    app.exit(0)
  }, FORCE_EXIT_AFTER_MS)
  // Never let this timer be the reason the process stays alive.
  forceExit.unref()
}

/* -------------------------------------------------------------------------- *
 * Reinstall the version already installed
 * -------------------------------------------------------------------------- */

/**
 * The update host to download from — the policy's feed, the env override, or
 * the one baked into this installer's `app-update.yml`, in that order.
 */
const reinstallFeed = (): string | null => {
  if (feedInUse) return feedInUse
  if (env.updateFeedUrl) return env.updateFeedUrl

  try {
    const yml = readFileSync(join(process.resourcesPath, 'app-update.yml'), 'utf8')
    const url = /^url:\s*(\S+)\s*$/m.exec(yml)?.[1]

    return url ? url.replace(/\/+$/, '') : null
  } catch {
    return null
  }
}

/** The two lines of `latest.yml` a reinstall needs. */
const readManifest = (yml: string): { version: string; path: string; sha512: string } | null => {
  // Top-level `key: value` lines only — `files:` entries are indented and skipped.
  const field = (name: string): string => {
    const line = yml.split(/\r?\n/).find(entry => entry.startsWith(`${name}:`))

    return line ? line.slice(name.length + 1).trim().replace(/^['"]|['"]$/g, '') : ''
  }
  const version = field('version')
  const path = field('path')
  const sha512 = field('sha512')

  return version && path && sha512 ? { version, path, sha512 } : null
}

let reinstalling = false

/**
 * REINSTALL — download the installer the feed serves now and run it, even when
 * its version is the one installed.
 *
 * WHY. A release is sometimes re-uploaded under the same version number with
 * different contents. The updater compares version numbers, sees nothing newer,
 * and never fetches it — so a machine would keep the old build for good. This
 * fetches it regardless: the manifest, the installer it names, a checksum
 * check against the manifest, then the same silent install + relaunch an
 * automatic update ends with.
 *
 * Windows only: the NSIS installer can be run silently over the running app.
 * Packaged builds only: a dev build has nothing installed to replace.
 */
export const reinstallCurrentVersion = async (): Promise<
  { success: true; version: string } | { success: false; message: string }
> => {
  if (!canAutoUpdate()) return { success: false, message: 'Reinstall is only available in an installed app.' }
  if (!isWindows) return { success: false, message: 'Reinstall is available on Windows only.' }
  if (reinstalling) return { success: false, message: 'A reinstall is already downloading.' }
  if (state.phase === 'downloading') return { success: false, message: 'An update is downloading — wait for it to finish.' }

  const feed = reinstallFeed()

  if (!feed) return { success: false, message: 'No update host is configured for this installation.' }

  reinstalling = true

  try {
    record('info', `Reinstall requested — reading ${feed}/latest.yml`)

    const manifestResponse = await net.fetch(`${feed}/latest.yml?t=${Date.now()}`, { cache: 'no-store' })

    if (!manifestResponse.ok) throw new Error(`the update host answered HTTP ${manifestResponse.status} for latest.yml`)

    const manifest = readManifest(await manifestResponse.text())

    if (!manifest) throw new Error('latest.yml does not name an installer and its checksum')

    record('info', `Downloading ${manifest.path} (version ${manifest.version}) to reinstall`)
    publish({ phase: 'downloading', latest: manifest.version, percent: 0, message: null })

    const installerResponse = await net.fetch(`${feed}/${encodeURI(manifest.path)}?t=${Date.now()}`, { cache: 'no-store' })

    if (!installerResponse.ok || !installerResponse.body) {
      throw new Error(`the update host answered HTTP ${installerResponse.status} for ${manifest.path}`)
    }

    const total = Number(installerResponse.headers.get('content-length')) || 0
    const target = join(app.getPath('temp'), `trackvid-reinstall-${manifest.version}-${Date.now()}.exe`)
    const out = createWriteStream(target)
    const hash = createHash('sha512')
    const reader = installerResponse.body.getReader() as ReadableStreamDefaultReader<Uint8Array>
    let received = 0
    let lastPercent = -1

    try {
      for (;;) {
        const { done, value } = await reader.read()

        if (done) break

        hash.update(value)
        received += value.length

        if (!out.write(value)) await new Promise<void>(resolve => out.once('drain', () => resolve()))

        const percent = total > 0 ? Math.floor((received / total) * 100) : 0

        if (percent !== lastPercent) {
          lastPercent = percent
          publish({ phase: 'downloading', percent, totalBytes: total })
        }
      }
    } finally {
      await new Promise<void>(resolve => out.end(() => resolve()))
    }

    // The same check the updater makes: a truncated or tampered download is
    // never run.
    if (hash.digest('base64') !== manifest.sha512) {
      rmSync(target, { force: true })
      throw new Error('the downloaded installer does not match the checksum in latest.yml')
    }

    record('info', `Version ${manifest.version} downloaded and verified — reinstalling and relaunching`)
    publish({ phase: 'downloaded', latest: manifest.version, percent: 100 })

    // The arguments electron-updater gives the NSIS installer on a silent
    // update: /S closes the running app itself, --force-run relaunches after.
    spawn(target, ['--updated', '/S', '--force-run'], { detached: true, stdio: 'ignore' }).unref()

    app.removeAllListeners('window-all-closed')
    setTimeout(() => app.quit(), 500)

    const forceExit = setTimeout(() => app.exit(0), FORCE_EXIT_AFTER_MS)

    forceExit.unref()

    return { success: true, version: manifest.version }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)

    record('error', `Reinstall failed — ${message}`)
    publish({ phase: 'idle', percent: 0 })
    reinstalling = false

    return { success: false, message: `Could not reinstall: ${message}` }
  }
}
