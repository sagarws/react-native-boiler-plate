import { describe, expect, it, vi } from 'vitest'
import {
  SIGN_IN_REFUSED,
  refuseSignInUnlessAllowed,
  signInAllowed,
  withSignIn,
  withoutSignIn
} from '@main/services/signInPolicy'
import { marketplaceDidNotAnswer } from '@main/services/refill.service'

vi.mock('@main/services/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

/**
 * Which work is allowed to sign in to a marketplace.
 *
 * WHY REFILL IS NOT. It asks marketplaces for the blanks on hundreds of rows.
 * Meeting a dead session, it used to sign in by script — a real browser, a real
 * login, per account — in the middle of that sweep. Re-capturing logins is the
 * Login update's job: it runs first for exactly that reason, and now stops the
 * schedule when it cannot. A refill doing it again turns a run of API calls
 * into a night of browser sessions.
 *
 * WHAT IT DOES NOT CHANGE: a session that is ALIVE is reused, exactly as
 * before. The policy is read only where a DEAD session would have triggered a
 * sign-in, so refusing to sign in cannot stop a working session being used.
 */

describe('the sign-in policy', () => {
  it('refuses sign-in by default — only session capture signs in, and it does not ask', () => {
    expect(signInAllowed()).toBe(false)
  })

  it('allows it only for the duration of work that opts in', async () => {
    await withSignIn(() => {
      expect(signInAllowed()).toBe(true)

      return Promise.resolve()
    })

    expect(signInAllowed()).toBe(false)
  })

  it('restores the flag when the work throws', async () => {
    // Otherwise one failed opt-in would leave every later automation free to
    // sign in — exactly the fault the default exists to prevent.
    await expect(withSignIn(() => Promise.reject(new Error('boom')))).rejects.toThrow('boom')

    expect(signInAllowed()).toBe(false)
  })

  it('restores the previous value, so nesting cannot leave it raised', async () => {
    await withSignIn(async () => {
      await withoutSignIn(() => Promise.resolve())

      // The inner refusal ending must restore the outer opt-in, not the default.
      expect(signInAllowed()).toBe(true)
    })

    expect(signInAllowed()).toBe(false)
  })

  it('the gate in front of a direct login throws by default, and passes inside an opt-in', async () => {
    expect(() => refuseSignInUnlessAllowed('myntra', 'a@x.com', 'no login is saved')).toThrow(
      /does not sign in — no login is saved/
    )

    await withSignIn(() => {
      expect(() => refuseSignInUnlessAllowed('myntra', 'a@x.com', 'x')).not.toThrow()

      return Promise.resolve()
    })
  })
})

describe('a row whose sign-in was refused', () => {
  it('costs the row no refill attempt', () => {
    // The marketplace was never asked, so the row learned nothing. Charging it
    // would retire the row after three nights for a question nobody put.
    expect(
      marketplaceDidNotAnswer(`${SIGN_IN_REFUSED} — the marketplace rejected the saved login`)
    ).toBe(true)
  })
})
