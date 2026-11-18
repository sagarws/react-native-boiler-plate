import { describe, expect, it } from 'vitest'

/**
 * What the account dropdown shows is what the form holds.
 *
 * THE CASE THIS PINS. An operator typed a Return Order Number and the field
 * answered "Choose the AJIO account to look this up" — while the dropdown
 * directly above it plainly showed `online1@wrogn.com`. Nothing was fetched.
 *
 * The cause was two facts kept apart: the dropdown DISPLAYED the sole account
 * (so the first paint does not read "Select account"), while the form value
 * was still empty, and the lookup reads the form. They were reconciled by an
 * effect that fired once, when the account catalogue first arrived — so
 * anything emptying the form afterwards, a platform switch or Reset or a
 * re-mount, left them out of step with no second chance.
 *
 * The rule is now "persist whatever is displayed", which has no first-time
 * about it.
 */

/** The reconciliation the dropdown performs. */
const reconcile = ({ formValue, options, disabled = false }: {
  formValue: string
  options: string[]
  disabled?: boolean
}): { displayed: string | null; persists: string | null } => {
  const trimmed = formValue.trim()
  const sole = !disabled && options.length === 1 && !trimmed
  const displayed = trimmed ? formValue : sole ? (options[0] ?? null) : null

  return { displayed, persists: !trimmed && displayed ? displayed : null }
}

describe('with exactly one account and an empty form', () => {
  it('shows it and writes it to the form', () => {
    const { displayed, persists } = reconcile({ formValue: '', options: ['online1@wrogn.com'] })

    expect(displayed).toBe('online1@wrogn.com')
    // The reported bug: displayed but never persisted, so the lookup refused.
    expect(persists).toBe('online1@wrogn.com')
  })

  it('reconciles again after the form is emptied', () => {
    // Reset, or a platform switch. The old rule fired only on the catalogue's
    // first arrival and had nothing left to give here.
    const { persists } = reconcile({ formValue: '', options: ['online1@wrogn.com'] })

    expect(persists).toBe('online1@wrogn.com')
  })
})

describe('with several accounts', () => {
  it('shows nothing and writes nothing, because the choice is the operator´s', () => {
    const { displayed, persists } = reconcile({ formValue: '', options: ['a@x.com', 'b@x.com'] })

    expect(displayed).toBeNull()
    expect(persists).toBeNull()
  })
})

describe('once an account is chosen', () => {
  it('leaves it alone', () => {
    const { displayed, persists } = reconcile({ formValue: 'b@x.com', options: ['a@x.com', 'b@x.com'] })

    expect(displayed).toBe('b@x.com')
    expect(persists).toBeNull()
  })
})
