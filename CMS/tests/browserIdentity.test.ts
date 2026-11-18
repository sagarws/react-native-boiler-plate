import { describe, expect, it, vi } from 'vitest'

/**
 * The manual capture window must not announce itself as Electron.
 *
 * Akamai fronts Myntra, and an `Electron/` token is one of the cheapest
 * automation signals to match on — which is why the automated path (real Chrome
 * via Selenium) works while the manual window is refused with a network error
 * before its own scripts load.
 */
const attached = vi.hoisted(() => ({ calls: [] as { method: string; params?: unknown }[] }))

vi.mock('@main/services/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}))

const config = vi.hoisted(() => ({ capturePagePatches: true }))

vi.mock('@main/config/env', () => ({ env: config }))

vi.mock('electron', () => ({
  app: {
    userAgentFallback:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) ' +
      'trackvid-cms/0.1.16 Chrome/140.0.7339.16 Electron/43.4.1 Safari/537.36',
    getName: () => 'trackvid-cms'
  },
  session: { fromPartition: () => ({ setUserAgent: vi.fn() }) }
}))

const { applyPageIdentity, chromeUserAgent, clientHintsFor } =
  await import('@main/services/browserIdentity')

/** A window just far enough along to record what was asked of the debugger. */
const fakeWindow = () =>
  ({
    webContents: {
      debugger: {
        attach: vi.fn(),
        detach: vi.fn(),
        sendCommand: vi.fn((method: string, params?: unknown) => {
          attached.calls.push({ method, params })

          return Promise.resolve()
        })
      }
    },
    once: vi.fn()
  }) as never

describe('chromeUserAgent', () => {
  it('drops both tokens no real Chrome sends', () => {
    const ua = chromeUserAgent()

    expect(ua).not.toContain('Electron/')
    expect(ua).not.toContain('trackvid-cms/')
  })

  /**
   * The version is kept, never invented. A UA claiming Chrome 120 while the
   * engine is Chrome 140 is a FRESH signal, not a fix: the string and the
   * fingerprint would disagree, which is precisely what these checks look for.
   */
  it('keeps the Chromium version the app actually runs', () => {
    expect(chromeUserAgent()).toContain('Chrome/140.0.7339.16')
  })

  it('leaves a UA that reads exactly like Chrome', () => {
    expect(chromeUserAgent()).toBe(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) ' +
        'Chrome/140.0.7339.16 Safari/537.36'
    )
  })

  it('leaves no double spaces where the tokens were', () => {
    expect(chromeUserAgent()).not.toMatch(/\s{2,}/)
  })
})

/**
 * Electron is Chromium but it is not Chrome: `window.chrome` is defined in
 * every real tab and in no Electron window, so a check that reads it finds
 * `undefined` and stops there.
 */
/**
 * THE OTHER HALF OF THE SAME CLAIM. The UA above is stripped of its Electron
 * token — while Chromium went on sending `sec-ch-ua: … "Electron";v="43"` on
 * every request beside it. A browser whose UA and hints disagree is a stronger
 * signal than either alone, and it is the one a bot manager is built to find.
 */
describe('clientHintsFor', () => {
  const ua =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
    'Chrome/140.0.0.0 Safari/537.36'

  it('claims the same Chrome version the user-agent does', () => {
    // Read from the UA rather than stated here, so the two cannot drift when
    // Electron's Chromium moves.
    expect(clientHintsFor(ua, 'win32')['sec-ch-ua']).toBe(
      '"Not=A?Brand";v="99", "Google Chrome";v="140", "Chromium";v="140"'
    )
  })

  it('never names Electron', () => {
    expect(JSON.stringify(clientHintsFor(ua, 'win32'))).not.toMatch(/electron/i)
  })

  it('reports the platform the window is actually on', () => {
    expect(clientHintsFor(ua, 'win32')['sec-ch-ua-platform']).toBe('"Windows"')
    expect(clientHintsFor(ua, 'darwin')['sec-ch-ua-platform']).toBe('"macOS"')
    expect(clientHintsFor(ua, 'linux')['sec-ch-ua-platform']).toBe('"Linux"')
  })

  it('sends no brand list at all when the UA carries no version', () => {
    // A brand list with an empty `v` would be a fresh signal, not a fix.
    const hints = clientHintsFor('Mozilla/5.0 (Windows NT 10.0)', 'win32')

    expect(hints['sec-ch-ua']).toBeUndefined()
    expect(hints['sec-ch-ua-platform']).toBe('"Windows"')
  })
})

describe('applyPageIdentity', () => {
  /**
   * OFF by default, on evidence: a capture with the user-agent fix alone signed
   * in successfully, and adding these stopped Myntra's landing page enabling
   * its Login button. Attaching the debugger exposes CDP to the page, and
   * detecting CDP is a standard anti-bot check.
   */
  it('does nothing at all unless it is turned on', () => {
    config.capturePagePatches = false
    attached.calls = []

    applyPageIdentity(fakeWindow())

    expect(attached.calls).toEqual([])

    config.capturePagePatches = true
  })

  it('installs the patches before any page script runs', () => {
    attached.calls = []
    applyPageIdentity(fakeWindow())

    // Not executeJavaScript, which would run after the page's own checks.
    expect(attached.calls[0]?.method).toBe('Page.addScriptToEvaluateOnNewDocument')
  })

  it('defines window.chrome and pins navigator.webdriver', () => {
    attached.calls = []
    applyPageIdentity(fakeWindow())

    const source = String((attached.calls[0]?.params as { source: string }).source)

    expect(source).toContain('window.chrome')
    expect(source).toContain("'webdriver'")
    expect(source).toContain('__selenium_evaluate')
  })

  // A capture that opens without the patches is better than one that does not
  // open — devtools already attached is a normal reason for this to fail.
  it('leaves the window usable when the debugger cannot attach', () => {
    const window = fakeWindow() as unknown as {
      webContents: { debugger: { attach: () => void } }
    }

    window.webContents.debugger.attach = () => {
      throw new Error('already attached')
    }

    expect(() => applyPageIdentity(window as never)).not.toThrow()
  })
})
