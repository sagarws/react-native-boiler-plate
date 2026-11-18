import { beforeEach, describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'

/**
 * Two different questions decide whether a window appears.
 *
 *   isAutoLoginOnActiveSession   WHO signs in — the app, or a person?
 *   HEADLESS / <PLATFORM>_HEADLESS   when the app does, does anyone watch?
 *
 * The company's answer comes first, because it decides whether a window is
 * needed at all. A person cannot type into a browser that was never drawn, so
 * auto-login OFF pins it visible however the environment is set.
 */
const load = createRequire(import.meta.url)
const headless = load('@trackvid/automation-core/common/headless') as {
  isHeadless: (platform?: string) => boolean
  resolveHeadless: (o: { requiresDisplay?: boolean; platform?: string; label?: string }) => boolean
  setAutoLoginEnabled: (platform: string, enabled: boolean) => void
  clearAutoLoginPolicy: () => void
}

describe('headless resolution', () => {
  beforeEach(() => {
    headless.clearAutoLoginPolicy()
    delete process.env.HEADLESS
    delete process.env.MYNTRA_HEADLESS
    delete process.env.AJIO_HEADLESS
  })

  it('is headless unless something says otherwise', () => {
    expect(headless.isHeadless('myntra')).toBe(true)
  })

  it('follows HEADLESS for an ordinary platform', () => {
    process.env.HEADLESS = 'false'

    expect(headless.isHeadless('ajio')).toBe(false)
  })

  /**
   * Auto-login OFF means a human completes the sign-in. A headless browser is
   * one nobody can type into, so the automation would wait for a login that
   * cannot happen.
   */
  describe('auto-login off pins the window visible', () => {
    it('shows the window even with nothing set', () => {
      headless.setAutoLoginEnabled('ajio', false)

      expect(headless.isHeadless('ajio')).toBe(false)
    })

    it('ignores an environment that asks for headless', () => {
      process.env.HEADLESS = 'true'
      process.env.MYNTRA_HEADLESS = 'true'
      headless.setAutoLoginEnabled('myntra', false)

      expect(headless.isHeadless('myntra')).toBe(false)
    })

    it('applies per platform, not process-wide', () => {
      headless.setAutoLoginEnabled('myntra', false)
      headless.setAutoLoginEnabled('ajio', true)

      expect(headless.isHeadless('myntra')).toBe(false)
      // ajio still follows the environment, which says nothing → headless.
      expect(headless.isHeadless('ajio')).toBe(true)
    })
  })

  it('lets <PLATFORM>_HEADLESS override HEADLESS for one platform only', () => {
    process.env.HEADLESS = 'true'
    process.env.AJIO_HEADLESS = 'false'

    expect(headless.isHeadless('ajio')).toBe(false)
    expect(headless.isHeadless('snapdeal')).toBe(true)

    delete process.env.AJIO_HEADLESS
  })

  /**
   * Myntra reads ONLY its own key.
   *
   * HEADLESS is the machine-wide "show me what the automations are doing".
   * Myntra's window is a working requirement of its sign-in, not something an
   * operator turns on to watch — so the two must not interfere. Switching the
   * machine to visible for a debugging session should not change Myntra, and
   * turning Myntra off must not require hiding every other platform.
   */
  describe('Myntra is independent of HEADLESS', () => {
    it('stays headless when only HEADLESS says visible', () => {
      process.env.HEADLESS = 'false'

      expect(headless.isHeadless('myntra')).toBe(true)
      // …while everything else on the same machine follows it.
      expect(headless.isHeadless('ajio')).toBe(false)
    })

    it('is visible on its own key, with HEADLESS unset', () => {
      process.env.MYNTRA_HEADLESS = 'false'

      expect(headless.isHeadless('myntra')).toBe(false)
      expect(headless.isHeadless('ajio')).toBe(true)
    })

    it('lets its own key say headless while the machine is visible', () => {
      process.env.HEADLESS = 'false'
      process.env.MYNTRA_HEADLESS = 'true'

      expect(headless.isHeadless('myntra')).toBe(true)
      expect(headless.isHeadless('ajio')).toBe(false)
    })
  })

  // Only the exact string "false" opens a window, at either level: a typo must
  // not put a browser on someone's screen, and a server has no screen anyway.
  it('opens a window only for the exact string "false"', () => {
    for (const value of ['true', 'FALSE', '0', 'no', '']) {
      process.env.HEADLESS = value
      expect(headless.isHeadless('ajio')).toBe(true)
    }
  })

  /**
   * `requiresDisplay` is the third route to a visible window, independent of
   * both: Myntra's sign-in is completed by an OS-level click and cannot work
   * headless at all.
   */
  it('keeps a login that cannot run headless headed', () => {
    headless.setAutoLoginEnabled('myntra', true)
    process.env.MYNTRA_HEADLESS = 'true'

    expect(
      headless.resolveHeadless({ requiresDisplay: true, platform: 'myntra', label: 'Myntra' })
    ).toBe(false)
  })
})
