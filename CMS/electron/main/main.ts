import { app, BrowserWindow, session } from 'electron'
import { APP_ID } from '@shared/constants/app'
import { devAppIconPath } from './windows/appIcon'
import { applyNativeAppearance } from './windows/nativeAppearance'
import { applyApplicationMenu } from './windows/appMenu'
import { initialiseClaimQueue } from './services/claimQueue.service'
import { initialiseImportScheduleStore } from './services/importScheduleStore'
import { initialiseCompanyStore } from './services/company.store'
import { initialiseLocalSessions } from './services/localSession.store'
import { initialisePendingSessions } from './services/pendingSession.store'
import { initialiseOfflineCache } from './services/offlineCache'
import { initialiseMasterImportQueue } from './services/masterImportQueue.store'
import { initialiseBulkSpfStore, recoverInterruptedRun } from './services/bulkSpf.store'
import { initialiseNykaaDdrStore, recoverInterruptedDdrRun } from './services/nykaaBulkDdr.store'
import { initialiseBulkJobArchive } from './services/bulkSpfArchive.store'
import { initialiseReClaimArchive, recoverInterruptedReClaims } from './services/reClaimArchive.store'
import { initialiseAccountMapArchive } from './services/accountMapArchive.store'
import { initialiseRefillArchive } from './services/refillArchive.store'
import { initialiseMasterBackup } from './services/masterBackup.store'
import { initialiseBackupArchive } from './services/masterBackupArchive.store'
import { foldInMonthFiles, initialiseSnapdealBackup } from './services/snapdealBackup.store'
import { initialiseSnapdealBackupArchive } from './services/snapdealBackupArchive.store'
import { initialiseFlipkartBackup } from './services/flipkartBackup.store'
import { pruneExpiredBackups } from './services/backupRetention.service'
import { initialiseSessionRejections } from './services/sessionRejection.store'
import { initialiseAutomationSchedule } from './services/automationSchedule.store'
import { initialiseStatusSync } from './services/statusSync.store'
import { initialiseSchedulerPause } from './services/schedulerPause.store'
import { initialiseMediaTools } from './services/mediaTools.service'
import { initialiseSeleniumManager } from './services/seleniumManager.service'
import { initialiseScheduledRunArchive } from './services/scheduledRunArchive.store'
import { initialiseCronHistory } from './services/cronHistory.store'
import { initialiseCronLog } from './services/cronLog.store'
import { stopImportScheduler } from './services/importScheduler.service'
import { stopMasterImportQueue } from './services/masterImportQueue.service'
import { requestScheduleStop } from './services/schedulerPause.store'
import {
  switchOnAtLaunch,
  stopAutomationScheduler
} from './services/automationScheduler.service'
import { stopMonitor } from './services/monitor.service'
import { initialiseAuth } from './services/auth.service'
import { getPreferences, initialisePreferences } from './services/preferences.service'
import { checkForUpdates, initialiseUpdater } from './services/updater.service'
import { registerIpcHandlers } from './ipc'
import { allowIpcOrigin } from './ipc/handler'
import { platform } from './platform'
import { logger } from './services/logger'
import { createMainWindow } from './windows/mainWindow'
import { afterHomePage } from './services/startupGate.service'
import { cleanUpInstallersAtLaunch } from './services/installerCleanup.service'
import { applyDevProfile } from './database'
import { isFeedHeld, releaseFeedQuickly } from './vms/feedSession.service'
import { stopSidecar } from './vms/sidecar.service'
import { stopUploadDriver } from './vms/uploadDriver.service'
import { attachPartnerVmsWindow, disablePartnerVms } from './vms/partnerVms/partnerVms.ipc'

// Windows: required for correct taskbar grouping and notification identity.
app.setAppUserModelId(APP_ID)

// Dev only: a second checkout can opt into its own userData (and lock).
applyDevProfile()

// A second instance would fight over the same JSON data files.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const [existing] = BrowserWindow.getAllWindows()
    if (existing) {
      if (existing.isMinimized()) existing.restore()
      existing.focus()
    }
  })

  void app.whenReady().then(async () => {
    logger.init()
    logger.info('Application starting', { platform: platform.name, arch: process.arch, version: app.getVersion() })

    // The dock, before the first window exists — otherwise an unpackaged run
    // shows Electron's atom for as long as it takes the window to open.
    const iconPath = devAppIconPath()

    if (iconPath) platform.setAppIcon(iconPath)

    // Before the window exists, so the title bar is painted in the right tone
    // from the first frame rather than flipping once the renderer reports in.
    applyNativeAppearance()

    // Before the first window, so no frame is ever drawn under the default menu.
    applyApplicationMenu()

    const devServer = process.env['ELECTRON_RENDERER_URL']
    if (devServer) allowIpcOrigin(devServer)

    applyContentSecurityPolicy()
    // Before initialiseAuth: a restored session connects the socket, and a
    // claim can land before the window is even open.
    initialiseClaimQueue()
    initialiseImportScheduleStore()
    initialiseLocalSessions()
    initialiseCompanyStore()
    initialisePendingSessions()
    initialiseOfflineCache()
    initialiseMasterImportQueue()
    initialiseBulkSpfStore()
    initialiseNykaaDdrStore()
    initialiseBulkJobArchive()
    initialiseReClaimArchive()
    initialiseAccountMapArchive()
    initialiseRefillArchive()
    initialiseMasterBackup()
    initialiseBackupArchive()
    initialiseSnapdealBackup()
    initialiseSnapdealBackupArchive()
    initialiseFlipkartBackup()
    /*
     * The Snapdeal rows used to be a file per month. Carrying them into the one
     * table has to happen before anything reads the backup, and it cannot be
     * skipped on a machine that already collected: Snapdeal's report window has
     * moved on, so a month dropped here is a month that cannot simply be asked
     * for again. Idempotent, and it does nothing on a machine that never had
     * the old files.
     */
    void foldInMonthFiles()
      .then(rows => {
        if (rows > 0) logger.info(`[snapdeal-backup] folded ${rows} row(s) into one table`)
      })
      // After the fold, so folded rows are held to the same five months.
      .then(() => pruneExpiredBackups())
    initialiseSessionRejections()
    initialiseAutomationSchedule()
    initialiseSchedulerPause()
    initialiseStatusSync()
    initialiseScheduledRunArchive()
    // The scheduler's own source of truth: one history collection per task.
    // Must be open before startAutomationScheduler(), which reconstructs the
    // scheduler's state by reading it.
    initialiseCronHistory()
    initialiseCronLog()
    // Before any claim can run, and cheap: two path lookups, no process started.
    initialiseMediaTools()
    initialiseSeleniumManager()
    // Anything still marked running in a fresh process was left by a crash:
    // this process holds the single-instance lock, so there is nobody else to
    // be running it. Exact, rather than a timeout guess.
    void recoverInterruptedRun()
    void recoverInterruptedDdrRun()
    // Same reasoning: this process holds the single-instance lock, so a
    // re-claim job still marked running has nobody running it.
    void recoverInterruptedReClaims()
    // Must run before createMainWindow(): the window passes the stored theme to
    // the renderer at construction time.
    initialisePreferences()
    // Restore the stored session before the window opens, so the renderer's
    // first auth:session call already knows whether to show the login screen.
    await initialiseAuth()
    initialiseUpdater()
    registerIpcHandlers()

    // VMS: the Flipkart VMS mirror's view is drawn inside the main window.
    attachPartnerVmsWindow(createMainWindow())

    // One check per launch, after the window exists so its events have somewhere
    // to go. Not awaited: a slow update server must never delay first paint.
    void checkForUpdates()

    // Old TrackVid CMS installers in Downloads, deleted on every launch and
    // reported once if any went. Not awaited, and a failure is only logged: a
    // locked file or an unreachable report server must never hold up startup.
    void cleanUpInstallersAtLaunch()

    // The monitor is the only clock the nightly schedule has: every
    // AUTOMATION_MONITOR_INTERVAL_MINUTES it reads the schedule and each task's
    // history table and starts whatever is owed. Deliberately NOT tied to the
    // signed-in session the way the import scheduler is: a pass does nothing
    // until a task is both switched on and due, and a machine left running
    // overnight should still keep its schedule.
    // ON BY DEFAULT, AND EVERY LAUNCH IS A SWITCH-ON: off for two seconds,
    // then on — the monitor starts, the schedule arms, and every enabled task
    // runs once, one at a time. See AUTOMATION_LAUNCH_OFF_MS.
    //
    // AFTER THE HOME PAGE, not before it: the scheduler's catch-up (Login
    // update, report syncs, claims) used to start while the window still showed
    // "Starting TrackVid CMS…". Queued until the home page has rendered and
    // settled — see startupGate.service.
    afterHomePage('Automations (monitor and schedule)', () => {
      // Unless Settings → Common settings says to open with them off.
      void switchOnAtLaunch(getPreferences().automationsOnAtLaunch).catch(error => logger.warn('[schedule] launch switch-on failed', error))
    })

    app.on('activate', () => {
      // macOS: clicking the dock icon reopens a window when none are open.
      if (BrowserWindow.getAllWindows().length === 0) attachPartnerVmsWindow(createMainWindow())
    })
  })

  app.on('window-all-closed', () => {
    if (platform.quitOnLastWindowClosed) app.quit()
  })

  app.on('before-quit', () => {
    /*
     * ASK EVERYTHING TO STOP BEFORE THE PROCESS GOES.
     *
     * This handler only logged. So a quit during a nightly run left the timers
     * armed and the task in flight still driving a browser while the app tore
     * down around it — the run was not stopped, it was cut off, and the row it
     * was working is the one that then reads "started and did not finish".
     *
     * `requestScheduleStop` is the one that reaches work already going: the
     * runners check it between accounts and between marketplaces, so the step
     * in flight completes and nothing further starts. The `stop*` calls
     * take the timers down so nothing new is queued while the window closes.
     *
     * Synchronous on purpose — `before-quit` does not wait for promises, and
     * every one of these is a flag or a `clearInterval`.
     */
    requestScheduleStop()
    stopMonitor()
    stopAutomationScheduler()
    stopImportScheduler()
    stopMasterImportQueue()

    // VMS: no upload starts while quitting, and the camera previews' ffmpeg
    // processes and the local server's port go with the app.
    stopUploadDriver()
    void stopSidecar()
    // The Flipkart VMS mirror: its view, probe timer and power blocker go too.
    // Its Flipkart login stays in its own persistent partition.
    disablePartnerVms()

    logger.info('Application shutting down')
    logger.close()
  })

  /*
   * VMS: give a held feed back (feed-logout) so its desk lock does not wait for
   * the server's timeout. `before-quit` cannot wait for a promise, so the quit
   * is held here for at most two seconds and then resumed; with no feed held
   * this does nothing.
   */
  app.on('will-quit', event => {
    if (!isFeedHeld()) return

    event.preventDefault()
    void releaseFeedQuickly(2_000).finally(() => app.quit())
  })
}

/**
 * Defence in depth: the renderer already ships a CSP meta tag, this makes the
 * policy apply to every response the app loads.
 */
function applyContentSecurityPolicy(): void {
  const devServer = process.env['ELECTRON_RENDERER_URL']
  const scriptSrc = devServer ? "'self' 'unsafe-inline'" : "'self'"

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          `default-src 'self'; script-src ${scriptSrc}; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; media-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self' http://127.0.0.1:* ws://127.0.0.1:* ${devServer ? `${devServer} ws:` : ''}; object-src 'none'; base-uri 'none'; form-action 'none'`
        ]
      }
    })
  })

  /**
   * The camera and the microphone, and nothing else.
   *
   * Create Claim records the return being opened and photographs the parcel
   * from every side — that footage IS the claim, on several marketplaces — so
   * the page needs `getUserMedia`. Geolocation, notifications, MIDI, USB and
   * the rest stay denied, and the allowance is scoped to media alone rather
   * than opened wholesale.
   *
   * macOS needs more than this: the hardened runtime also wants
   * `NSCameraUsageDescription` / `NSMicrophoneUsageDescription` in the
   * Info.plist and the two device entitlements — see `electron-builder.yml` and
   * `build/entitlements.mac.plist`. Without them a signed build is handed no
   * device at all while a dev run works perfectly, which is the failure this
   * comment exists to shorten.
   */
  const ALLOWED_PERMISSIONS = new Set(['media'])

  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    if (ALLOWED_PERMISSIONS.has(permission)) {
      callback(true)

      return
    }

    logger.warn('Denied permission request', { permission })
    callback(false)
  })

  /**
   * The same answer for the synchronous check.
   *
   * Chromium asks this one before it will even enumerate devices, and it does
   * NOT fall back to the request handler above — a page that only ever calls
   * `enumerateDevices` would otherwise be told there is no camera, with no
   * prompt shown and nothing logged.
   */
  session.defaultSession.setPermissionCheckHandler((_webContents, permission) =>
    ALLOWED_PERMISSIONS.has(permission)
  )
}
