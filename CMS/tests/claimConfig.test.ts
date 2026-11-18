import { describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'
import type { ClaimDocument } from '@main/automations/common/types'
import { requireClaimConfig } from '@main/automations/common/claimConfig'

/**
 * The sequences read the backend's built entry, not the raw document.
 *
 * `fileMyntraClaim` reads `configEntry.awbNumber`; the document carries
 * `AWBNumber`. Handing it the document produced
 * `Step 2 (Fetch claim for "undefined") failed: fetchNewClaim: searchId is
 * required` — a message about a marketplace API, three layers away from the
 * actual mistake.
 */
const doc = (over: Partial<ClaimDocument> = {}): ClaimDocument =>
  ({ _id: 'cms-1', AWBNumber: 'MYER1', eCommercePlatform: 'Myntra', ...over })

describe('requireClaimConfig', () => {
  it('returns the built entry, with the field names the sequence reads', () => {
    const entry = requireClaimConfig('myntra', doc({ config: { awbNumber: 'MYER1', issueCategory: 'Stained Returns' } }))

    expect(entry.awbNumber).toBe('MYER1')
    expect(entry.issueCategory).toBe('Stained Returns')
  })

  // Some sequences still read identifiers off the document itself.
  it('keeps the document reachable, with the entry winning', () => {
    const entry = requireClaimConfig('myntra', doc({ ticketNumber: 'TK-9', config: { awbNumber: 'MYER1' } }))

    expect(entry.ticketNumber).toBe('TK-9')
    expect(entry.AWBNumber).toBe('MYER1')
  })

  // Failing here names the row. Passing a half-empty object instead would fail
  // several marketplace calls later, somewhere that reads like a different bug.
  it('throws rather than proceeding without one', () => {
    expect(() => requireClaimConfig('myntra', doc())).toThrow(/returned no myntra claim config/)
    expect(() => requireClaimConfig('myntra', doc({ config: null }))).toThrow()
    expect(() => requireClaimConfig('myntra', doc({ config: {} }))).toThrow()
  })
})

/**
 * DISABLE_SUBMIT stops the one irreversible call.
 *
 * Everything before it — session reuse, login, the config from the backend,
 * downloading each piece of evidence and uploading it to the marketplace — runs
 * for real. Only the call that raises a dispute nobody can un-raise is skipped.
 */
describe('claim submit guard', () => {
  const load = createRequire(import.meta.url)
  const guard = load('@trackvid/automation-core/common/claimSubmitGuard') as {
    isClaimSubmitDisabled: () => boolean
    assertClaimSubmitEnabled: (platform: string, action?: string) => void
  }

  const withEnv = (value: string | undefined, run: () => void): void => {
    const before = process.env.DISABLE_SUBMIT

    if (value === undefined) delete process.env.DISABLE_SUBMIT
    else process.env.DISABLE_SUBMIT = value

    try {
      run()
    } finally {
      if (before === undefined) delete process.env.DISABLE_SUBMIT
      else process.env.DISABLE_SUBMIT = before
    }
  }

  // A typo must file the claim exactly as today, never silently stop a
  // production machine from working.
  it('fails safe — only the exact string "true" disables submission', () => {
    withEnv('true', () => expect(guard.isClaimSubmitDisabled()).toBe(true))
    withEnv('TRUE', () => expect(guard.isClaimSubmitDisabled()).toBe(true))
    withEnv('yes', () => expect(guard.isClaimSubmitDisabled()).toBe(false))
    withEnv('', () => expect(guard.isClaimSubmitDisabled()).toBe(false))
    withEnv(undefined, () => expect(guard.isClaimSubmitDisabled()).toBe(false))
  })

  // The code is what tells a dry run apart from a real portal failure.
  it('throws a tagged error so a skip is never mistaken for a failure', () => {
    withEnv('true', () => {
      expect(() => guard.assertClaimSubmitEnabled('Myntra', 'claim submit')).toThrow(
        /CLAIM_SUBMIT_DISABLED/
      )

      try {
        guard.assertClaimSubmitEnabled('Myntra')
      } catch (error) {
        expect((error as { code?: string }).code).toBe('CLAIM_SUBMIT_DISABLED')
      }
    })
  })

  it('does nothing at all when it is off', () => {
    withEnv(undefined, () => {
      expect(() => guard.assertClaimSubmitEnabled('Myntra')).not.toThrow()
    })
  })
})
