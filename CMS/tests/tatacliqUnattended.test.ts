import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

const require_ = createRequire(import.meta.url)

/**
 * Tata CliQ can be signed in without a person, and the Session update now knows it.
 *
 * It was reported as "needs a person (no-script)" and skipped every night —
 * while the same app was signing into Tata CliQ for Refill Data and account
 * mapping, through the very function the capture path would have called.
 *
 * The gate asked the wrong question. `getLoginForm` is the declarative step
 * list `driveLogin` walks inside an Electron BrowserWindow, which is how the
 * MANUAL route works; the automatic route calls the core's
 * `renewPlatformSession`, and two platforms there drive a browser the core owns
 * rather than a descriptor.
 *
 * What is pinned here is that the two lists differ by EXACTLY Tata CliQ, so the
 * corrected gate cannot have quietly changed the answer for anything else.
 */

interface RenewSession {
  canRenew: (platform: string) => boolean
  renewablePlatforms: () => string[]
}

interface LoginForms {
  platformsWithLoginForm: () => string[]
  getLoginForm: (platform: string) => unknown
}

const { canRenew, renewablePlatforms } = require_(
  '@trackvid/automation-core/common/renewSession'
) as RenewSession

const { platformsWithLoginForm, getLoginForm } = require_(
  '@trackvid/automation-core/common/loginForms'
) as LoginForms

describe('which platforms this app can sign in to on its own', () => {
  it('can renew Tata CliQ, even though it has no form descriptor', () => {
    // Both halves matter. The first is why the nightly run may attempt it; the
    // second is why it used to refuse to.
    expect(canRenew('tatacliq')).toBe(true)
    expect(getLoginForm('tatacliq')).toBeFalsy()
  })

  it('differs from the descriptor list by Tata CliQ and nothing else', () => {
    // The guard on the change. If another platform ever appears here, the gate
    // started answering differently for it too — which is how a login that
    // needs a person gets attempted at 02:00 instead of being reported.
    const forms = new Set(platformsWithLoginForm())

    expect(renewablePlatforms().filter(platform => !forms.has(platform))).toEqual(['tatacliq'])
  })

  it('still knows every other platform both ways', () => {
    for (const platform of [
      'ajio',
      'myntra',
      'snapdeal',
      'meesho',
      'flipkart',
      'nykaa',
      'delhivery',
      'xbees'
    ]) {
      expect(canRenew(platform)).toBe(true)
      expect(getLoginForm(platform)).toBeTruthy()
    }
  })

  it('refuses a platform the core cannot sign in to at all', () => {
    // `no-script` has to stay reachable: it is the honest answer for a
    // marketplace nothing here can log into, and collapsing it would make the
    // run attempt something it cannot do and call the timeout a failure.
    expect(canRenew('amazon')).toBe(false)
    expect(canRenew('')).toBe(false)
  })
})
