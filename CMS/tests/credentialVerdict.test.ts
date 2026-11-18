import { describe, expect, it } from 'vitest'
import { isCredentialRefusal } from '@main/services/credentialVerdict.service'

/**
 * When a failed sign-in means the PASSWORD is wrong.
 *
 * THE CASE THAT FOUND THIS. The Login update signed in to three Snapdeal
 * accounts, was told `Invalid Username or Password` by the portal each time,
 * and the Login page went on showing all three as Verified — nothing on the
 * capture path wrote the flag. Every automation kept using passwords the
 * marketplace had already refused.
 *
 * THE ASYMMETRY IS THE WHOLE TEST. Missing a real refusal leaves things as they
 * were — bad, but visible, and the next run asks again. Treating a timeout or a
 * captcha as a refusal takes a WORKING login out of every automation until
 * somebody notices, and nothing in the app would ever put it back on its own.
 * So the second kind of mistake is the expensive one.
 */

describe('the marketplace refusing a password', () => {
  it('recognises the prefix every platform login throws with', () => {
    expect(
      isCredentialRefusal('INVALID_CREDENTIALS: Snapdeal rejected the login — Invalid Username or Password')
    ).toBe(true)
    expect(isCredentialRefusal('anything', 'INVALID_CREDENTIALS')).toBe(true)
  })

  it('recognises a portal that said it in its own words', () => {
    // Not every path carries the prefix — some report what the page said.
    expect(isCredentialRefusal('Invalid Username or Password , please try again')).toBe(true)
    expect(isCredentialRefusal('Incorrect password')).toBe(true)
    expect(isCredentialRefusal('The password is invalid')).toBe(true)
    expect(isCredentialRefusal('invalid email or password')).toBe(true)
  })
})

describe('a failure that says nothing about the password', () => {
  it('leaves the credential alone', () => {
    // Each of these would take a working login out of every automation.
    expect(isCredentialRefusal('Navigation timeout of 30000 ms exceeded')).toBe(false)
    expect(isCredentialRefusal('LOGIN_FAILED: Seller portal shell did not render')).toBe(false)
    expect(isCredentialRefusal('Probe rejected session (HTTP 502)')).toBe(false)
    expect(isCredentialRefusal('OTP_REQUIRED: Snapdeal asked for a code')).toBe(false)
    expect(isCredentialRefusal('net::ERR_CONNECTION_RESET')).toBe(false)
    expect(isCredentialRefusal('captcha shown')).toBe(false)
  })

  it('does not read a dead SESSION as a dead password', () => {
    // The commonest message in the logs, and the one that would do the most
    // damage: an expired cookie jar is not a wrong password.
    expect(
      isCredentialRefusal('the marketplace rejected the saved login — it is dead despite its expiry date')
    ).toBe(false)
  })
})

/**
 * EACH PLATFORM'S OWN VOCABULARY, asked of the platform.
 *
 * AJIO has spent months accumulating what its SSO actually says — the locked
 * account toast, `PASSWORD_RESET_REQUIRED`, "the password you entered is
 * incorrect" — in `platforms/ajio/common/loginErrors.js`, each pattern
 * anchored for a documented reason. Keeping a second opinion in the desktop
 * app would mean every new phrasing has to be learned twice, and the copy that
 * was forgotten is the one that quietly stops working.
 */
describe("a platform that classifies its own failures", () => {
  it("treats AJIO's locked-account toast as a credential refusal", () => {
    // The exact toast: .uap-toast--error .uap-toast__body. No retry fixes it —
    // the seller has to reset the password — so it must stop the automations
    // rather than be retried nightly for ever.
    expect(
      isCredentialRefusal(
        'AJIO rejected credentials for a@b.com: Your account is locked. Please reset your password to enable login.',
        undefined,
        'ajio'
      )
    ).toBe(true)
  })

  it("treats AJIO's machine codes as refusals too", () => {
    // Surfaced in the same toast as a bare token, which none of the prose
    // patterns would match.
    expect(isCredentialRefusal('PASSWORD_RESET_REQUIRED', undefined, 'ajio')).toBe(true)
  })

  it('still leaves an AJIO timeout alone', () => {
    // AJIO's own classifier errs toward under-matching for this reason: a
    // missed lockout costs one wasted run, a false positive disables a working
    // credential until somebody re-verifies it by hand.
    expect(
      isCredentialRefusal('Something went wrong. Please try again.', undefined, 'ajio')
    ).toBe(false)
  })
})
