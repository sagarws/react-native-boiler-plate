import { app, session, type BrowserWindow } from 'electron'
import { logger } from './logger'
import { env } from '@main/config/env'

/**
 * Make a capture window look like the browser it actually is.
 *
 * Electron's default user-agent carries two tokens no real Chrome ever sends:
 *
 *   Mozilla/5.0 (…) trackvid-cms/0.1.16 Chrome/140.0.0.0 Electron/43.4.1 Safari/537.36
 *                   ^^^^^^^^^^^^^^^^^^^                  ^^^^^^^^^^^^^^^^
 *
 * Akamai fronts Myntra, and an `Electron/` token is one of the cheapest
 * automation signals there is to match on. That is why the AUTOMATED path
 * works and the manual window does not: the automated one drives a real Chrome
 * through Selenium and sends a genuine Chrome UA, while the manual window
 * announces itself as an Electron app and gets refused before the page can
 * even load its own scripts.
 *
 * The version is NOT invented. Stripping the two tokens keeps the Chromium
 * version Electron is genuinely built on, so the UA still matches the engine
 * actually rendering the page. Claiming Chrome 120 while running Chrome 140
 * would be a fresh signal rather than a fix — the fingerprint and the string
 * would disagree, which is exactly what these checks look for.
 */

/** Electron's own UA with the app and Electron tokens removed. */
export const chromeUserAgent = (): string =>
  app.userAgentFallback
    .replace(/\s?Electron\/[\d.]+/, '')
    .replace(new RegExp(`\\s?${app.getName()}/[\\d.]+`, 'i'), '')
    .replace(/\s{2,}/g, ' ')
    .trim()

/**
 * The client hints that have to agree with that user-agent.
 *
 * THE UA IS ONLY HALF THE ANSWER. Chromium sends `sec-ch-ua` on every secure
 * request, and Electron's own brand list names itself:
 *
 *   sec-ch-ua: "Chromium";v="140", "Not=A?Brand";v="24", "Electron";v="43"
 *
 * So a window whose UA had been carefully stripped of its Electron token was
 * still announcing `"Electron"` in a header beside it — and a UA that
 * disagrees with the hints is a stronger signal than either one alone. Akamai,
 * which fronts Myntra's sign-in, reads both.
 *
 * The version is taken from the UA rather than stated here, so the two cannot
 * drift: whatever Chromium this Electron is built on is what both claim.
 *
 * Pure, and exported for the test — the platform and the UA are the only
 * inputs, and the whole point is that the output agrees with them.
 */
export const clientHintsFor = (
  userAgent: string,
  platform: NodeJS.Platform = process.platform
): Record<string, string> => {
  const major = /Chrome\/(\d+)/.exec(userAgent)?.[1] ?? ''
  const label =
    platform === 'win32' ? '"Windows"' : platform === 'darwin' ? '"macOS"' : '"Linux"'

  // Nothing to claim without a version — better to leave Chromium's own header
  // alone than to send a brand list with an empty `v`.
  if (!major) return { 'sec-ch-ua-platform': label }

  return {
    'sec-ch-ua': `"Not=A?Brand";v="99", "Google Chrome";v="${major}", "Chromium";v="${major}"`,
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': label
  }
}

/**
 * Applies it to a whole partition, not one navigation.
 *
 * `loadURL(url, { userAgent })` covers the top-level document only — every
 * script, XHR and image the page then requests would go out with the Electron
 * UA, and those are the requests a bot check actually inspects. Setting it on
 * the session covers all of them.
 *
 * The hints ride on the same requests, through `onBeforeSendHeaders`, because
 * there is no session-level setter for them — they are rewritten per request or
 * not at all. Only requests that already carry hints are touched, so a
 * navigation Chromium chose not to send them on is left as it is.
 */
export const useBrowserIdentity = (partition: string): void => {
  const userAgent = chromeUserAgent()
  const partitionSession = session.fromPartition(partition)

  partitionSession.setUserAgent(userAgent)

  const hints = clientHintsFor(userAgent)

  partitionSession.webRequest.onBeforeSendHeaders((details, callback) => {
    const requestHeaders = { ...details.requestHeaders }

    for (const [name, value] of Object.entries(hints)) {
      // Case matters here: Chromium sends these lowercase, and adding a
      // differently-cased copy would send the header twice — with two
      // different values, which is worse than the mismatch being fixed.
      if (name in requestHeaders || name.toLowerCase() in requestHeaders) {
        requestHeaders[name] = value
      }
    }

    callback({ requestHeaders })
  })
}

/**
 * The page-side patches, mirroring the core's Puppeteer `enableStealthMode`.
 *
 * Electron is Chromium, but it is not Chrome, and a handful of things a real
 * Chrome page can see are simply absent — most notably `window.chrome`, which
 * every genuine Chrome tab defines and no Electron window does. A bot check
 * that reads it finds `undefined` and stops there.
 *
 * Kept in step with `platforms/meesho/common/browserHelpers.enableStealthMode`
 * in the core, which is the version the automated paths already use.
 */
const PAGE_PATCHES = `
  // Electron already reports false, but pinning it costs nothing and survives
  // a future default change.
  Object.defineProperty(navigator, 'webdriver', { get: () => false });

  // The big one. Real Chrome always defines this; Electron never does.
  if (!window.chrome) window.chrome = { runtime: {} };

  // Left behind by older automation stacks. Harmless here, and their absence
  // is one fewer thing to look at.
  delete window.__webdriver_evaluate;
  delete window.__selenium_evaluate;
  delete window.__webdriver_script_function;
  delete window.__webdriver_script_func;
  delete window.__webdriver_script_name;

  // Chrome answers this for notifications from the permission store; the
  // default implementation disagrees with Notification.permission, and the
  // mismatch is itself a signal.
  try {
    const query = window.navigator.permissions.query;
    window.navigator.permissions.query = (parameters) =>
      parameters.name === 'notifications'
        ? Promise.resolve({ state: Notification.permission })
        : query(parameters);
  } catch (_) { /* permissions API unavailable — nothing to reconcile */ }
`

/**
 * Runs the patches in the page's MAIN world, before any of its own scripts.
 *
 * A preload script cannot do this: with `contextIsolation` on — which this
 * window keeps, because the marketplace's page must never reach the app — a
 * preload runs in an isolated world, and anything it defines is invisible to
 * the page. `executeJavaScript` after `dom-ready` is too late, since the checks
 * run as the page loads.
 *
 * So it goes through the DevTools Protocol, which is exactly what Puppeteer's
 * `evaluateOnNewDocument` does underneath.
 *
 * Best-effort throughout: an attach that fails (a debugger already attached,
 * devtools open) leaves the window working exactly as it did before. A capture
 * that opens without the patches is better than one that does not open.
 */
export const applyPageIdentity = (window: BrowserWindow): void => {
  // OFF unless asked for, and that is not caution — it is evidence.
  //
  // A capture with the user-agent fix alone reached the portal and signed in.
  // Adding these patches, the landing page stopped enabling its Login button.
  // Attaching Electron's debugger exposes the DevTools Protocol to the page,
  // and detecting CDP is a standard anti-bot check — so the very thing meant to
  // look more like a browser can read as less like one.
  //
  // The code stays because `window.chrome` is genuinely missing in Electron and
  // some portal will want it. Turn it on per machine when a capture fails
  // WITHOUT it, so the two are never changed together again.
  if (!env.capturePagePatches) return

  const { webContents } = window

  try {
    webContents.debugger.attach('1.3')
  } catch (error) {
    logger.warn('Could not attach the debugger to the capture window', error)

    return
  }

  webContents.debugger
    .sendCommand('Page.addScriptToEvaluateOnNewDocument', { source: PAGE_PATCHES })
    .catch((error: unknown) =>
      logger.warn('Could not install the page identity patches', error)
    )

  // Detach when the window goes, so a closed capture leaves nothing attached.
  window.once('closed', () => {
    try {
      webContents.debugger.detach()
    } catch {
      /* already gone with the window */
    }
  })
}

/**
 * Reports what the capture page can see about itself. READ-ONLY.
 *
 * A portal that renders its Login button DISABLED has run a check and decided
 * against us, and guessing which check is how this turns into a week of
 * one-change-at-a-time. This reads the properties those scripts conventionally
 * look at and logs them, so the next attempt produces evidence instead of
 * another theory.
 *
 * Deliberately NOT the DevTools Protocol: `executeJavaScript` runs in the
 * page's main world without attaching a debugger, so nothing here is itself
 * detectable as automation. It also changes nothing — every line is a read.
 */
export const reportPageEnvironment = (window: BrowserWindow, label: string): void => {
  window.webContents.once('dom-ready', () => {
    // A moment after paint: these scripts bootstrap asynchronously, and reading
    // at dom-ready catches the page before they have decided anything.
    setTimeout(() => {
      window.webContents
        .executeJavaScript(
          `(() => ({
            ua: navigator.userAgent,
            hasChrome: typeof window.chrome,
            webdriver: navigator.webdriver,
            languages: (navigator.languages || []).join(','),
            plugins: navigator.plugins ? navigator.plugins.length : -1,
            hardwareConcurrency: navigator.hardwareConcurrency,
            platform: navigator.platform,
            webglVendor: (() => {
              try {
                const gl = document.createElement('canvas').getContext('webgl');
                const ext = gl && gl.getExtension('WEBGL_debug_renderer_info');
                return ext ? gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) : 'none';
              } catch (e) { return 'error'; }
            })(),
            // What the page itself decided — the answer we actually want.
            loginButtons: [...document.querySelectorAll('button, a')]
              .filter(el => /log ?in/i.test(el.textContent || ''))
              .map(el => ({
                text: (el.textContent || '').trim().slice(0, 24),
                disabled: el.disabled === true || el.getAttribute('aria-disabled') === 'true',
                className: (el.className || '').toString().slice(0, 60)
              })),
            cookieNames: document.cookie.split(';').map(c => c.split('=')[0].trim()).filter(Boolean)
          }))()`,
          true
        )
        .then((info: unknown) =>
          logger.info(`[capture-env] ${label}: ${JSON.stringify(info)}`)
        )
        .catch((error: unknown) =>
          logger.warn(`[capture-env] ${label}: could not read the page`, error)
        )
    }, 8000)
  })
}
