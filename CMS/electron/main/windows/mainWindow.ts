import { markAppWindow } from '../ipc/broadcast'
import { join } from 'node:path'
import { app, BrowserWindow, shell } from 'electron'
import { devAppIconPath } from './appIcon'
import { refuseDevTools } from './appMenu'
import { WINDOW_DEFAULTS } from '@shared/constants/app'
import { overridesFor } from '@shared/types/appearance'
import { THEMES } from '@shared/types/theme'
import { isHex } from '@shared/utils/palette'
import { platform } from '../platform'
import { getPreferences } from '../services/preferences.service'
import { busyState } from '../services/busyGuard'
import { isQuitting, promptClose } from './closeGuard'
import { logger } from '../services/logger'

/**
 * The renderer URL differs between `electron-vite dev` (dev server) and a
 * packaged build (file on disk). electron-vite injects ELECTRON_RENDERER_URL in
 * development; the file path is resolved with path.join, never concatenated.
 */
/**
 * Background painted before the renderer has rendered anything.
 *
 * Matching it to the stored theme means a launch never flashes a colour from a
 * different one — the previous hard-coded dark navy was wrong for every light
 * theme. And matching it to the operator's OWN page colour when they have set
 * one means a customised install does not flash the stock grey either, which
 * is the same bug one layer further in.
 *
 * HEX ONLY. Electron's `backgroundColor` rejects `oklch()`, which is why the
 * seed for the page background is stored as hex and validated on the way in.
 */
const themeBaseColor = (): string => {
  const { theme, appearance } = getPreferences()
  const own = overridesFor(appearance, theme).canvas

  if (own && isHex(own)) return own

  return THEMES.find((entry) => entry.id === theme)?.baseColor ?? '#f1f5f9'
}

/**
 * Whether a URL is safe to hand to the operating system.
 *
 * Parsed rather than pattern-matched: `startsWith('https')` is true of
 * `https-evil:` and false of a perfectly ordinary uppercase `HTTPS://`, and a
 * URL is not a string problem. An unparseable value is refused, which is the
 * right default for something whose next stop is the shell.
 */
const isExternallyOpenable = (url: string): boolean => {
  try {
    const scheme = new URL(url).protocol

    return scheme === 'http:' || scheme === 'https:'
  } catch {
    return false
  }
}

const rendererEntry = (): { url?: string; file?: string } => {
  const devServer = process.env['ELECTRON_RENDERER_URL']
  if (!app.isPackaged && devServer) return { url: devServer }
  return { file: join(__dirname, '../renderer/index.html') }
}

export const createMainWindow = (): BrowserWindow => {
  const icon = devAppIconPath()

  const window = new BrowserWindow({
    width: WINDOW_DEFAULTS.width,
    height: WINDOW_DEFAULTS.height,
    minWidth: WINDOW_DEFAULTS.minWidth,
    minHeight: WINDOW_DEFAULTS.minHeight,
    show: false,
    backgroundColor: themeBaseColor(),
    // Undefined in a packaged build, where the icon is compiled into the
    // executable already - and `icon: undefined` is what BrowserWindow expects
    // for "use the default".
    ...(icon ? { icon } : {}),
    ...platform.windowOptions,
    webPreferences: {
      preload: join(__dirname, '../preload/preload.js'),
      // The stored theme rides along in the renderer's argv so the sandboxed
      // preload can read it synchronously. Going through IPC instead would mean
      // the first frame paints in the default theme and then snaps to the
      // chosen one - a visible flash on every launch.
      // The stored appearance rides along for the same reason, and encoded
      // because it is JSON going through a command line.
      additionalArguments: [
        `--initial-theme=${getPreferences().theme}`,
        `--initial-appearance=${encodeURIComponent(JSON.stringify(getPreferences().appearance))}`
      ],
      // Security baseline - all three are required, none may be relaxed.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    }
  })

  // Tagged so main-process broadcasts reach this window and not the
  // marketplace login windows session capture opens.
  markAppWindow(window)
  refuseDevTools(window)

  // Avoid the white flash: show only once the first paint is ready.
  window.once('ready-to-show', () => window.show())

  /*
   * External links open in the user's browser, never inside the app shell.
   *
   * THE SCHEME IS CHECKED FIRST. `shell.openExternal` hands the URL to the
   * operating system, which will happily act on more than http — `file://`
   * opens a local path in Finder or Explorer, and a registered custom scheme
   * can start another application. Passing an unchecked URL to it turns any
   * link the renderer can be made to emit into "ask the OS to run something",
   * which is a wider door than this feature ever needed.
   *
   * http and https are the whole requirement: these are marketplace pages and
   * TrackVid links.
   */
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isExternallyOpenable(url)) void shell.openExternal(url)
    else logger.warn('Refused to open a URL externally', { url })

    return { action: 'deny' }
  })

  window.webContents.on('will-navigate', (event, url) => {
    const entry = rendererEntry()
    const allowed = entry.url ? url.startsWith(entry.url) : url.startsWith('file://')
    if (!allowed) {
      event.preventDefault()
      logger.warn('Blocked in-app navigation', { url })
    }
  })

  /**
   * Closing while an automation is running.
   *
   * THE RUN ENDS AT A MARKETPLACE, NOT HERE. A claim half-filed can leave a
   * ticket raised on the marketplace with nothing recorded against it on this
   * machine, and the next run — seeing a claim it believes was never filed —
   * raises a second one for the same return. That is the one mistake on this
   * screen nobody can undo, and it is worth a dialog.
   *
   * SO THE CLOSE IS REFUSED FIRST, always, and the operator is told what is
   * running. Quitting anyway stays available behind a second press, because an
   * app that cannot be quit at all is worse: a run that hangs would otherwise
   * leave force-quit as the only way out, which is exactly the abrupt stop this
   * exists to prevent.
   *
   * The question is the app's own dialog (see closeGuard), with the system
   * box only as the fallback for a page that cannot answer. `isQuitting` is the
   * escape hatch for "Quit anyway" — without it the close it triggers
   * re-enters this handler and nothing ever closes.
   */
  logger.info('[close] guard armed')

  window.on('close', event => {
    if (isQuitting()) return

    const { busy, holder } = busyState()

    if (!busy) {
      logger.info('[close] nothing is running — closing')

      return
    }

    event.preventDefault()
    logger.warn('[close] refused: an automation is running', { holder })

    promptClose(window, holder ?? 'An automation')
  })

  const entry = rendererEntry()
  if (entry.url) {
    void window.loadURL(entry.url)
  } else if (entry.file) {
    void window.loadFile(entry.file)
  }

  return window
}
