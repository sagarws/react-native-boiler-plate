import { createRequire } from 'node:module'
import { describe, expect, it, vi } from 'vitest'

/**
 * The account a claim was just mapped to has to reach the runner.
 *
 * When a row arrives with no seller account, the processor asks each login
 * which one holds the AWB and records the answer on the server. The runner
 * then reads the account off the claim document it was handed — fetched before
 * any of that happened. Without this stamp, a claim whose account had just
 * been found failed with "this claim names no account", which is the one thing
 * that could not have been true.
 */

const require_ = createRequire(import.meta.url)

vi.mock('@main/services/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))
vi.mock('@main/services/company.service', () => ({ credentialsFor: () => Promise.resolve([]) }))

const { stampClaimAccount } = await import('@main/automations/common/claimAccount')

const { claimAccountUsername } = require_('@trackvid/automation-core/common/claimAccount') as {
  claimAccountUsername: (platform: string, doc: unknown) => string | null
}

describe('stamping a mapped account onto the claim', () => {
  it('writes Tata CliQ where the runner reads it', () => {
    const doc = { AWBNumber: 'CLQR1002690665' } as Record<string, unknown>

    stampClaimAccount('tatacliq', doc, 'ppmp.tataunistore@wrogn.com')

    // Through the same map every runner reads by.
    expect(claimAccountUsername('tatacliq', doc)).toBe('ppmp.tataunistore@wrogn.com')
    expect((doc.otherClaimDetails as { username?: string }).username).toBe(
      'ppmp.tataunistore@wrogn.com'
    )
  })

  it('keeps the rest of the bundle it writes into', () => {
    // The document carries the QC form in the same object — stamping must not
    // be the thing that loses six photographs.
    const doc = { otherClaimDetails: { qcReason: '10', parentSelection: 'Wrong Product' } }

    stampClaimAccount('Tata CliQ', doc, 'ops@x.com')

    expect(doc.otherClaimDetails).toMatchObject({
      qcReason: '10',
      parentSelection: 'Wrong Product',
      username: 'ops@x.com'
    })
  })

  it('writes a top-level field where the platform keeps one there', () => {
    const doc = {} as Record<string, unknown>

    stampClaimAccount('ajio', doc, 'online1@wrogn.com')

    expect(doc.ajio_account_email).toBe('online1@wrogn.com')
  })

  it('never overwrites an account the row already names', () => {
    // A mapped answer and a stored one can differ, and the stored one is what
    // the claim is recorded against. Changing it here would file the dispute
    // from a seller nobody chose.
    const doc = { otherClaimDetails: { username: 'chosen@x.com' } }

    stampClaimAccount('tatacliq', doc, 'other@x.com')

    expect(doc.otherClaimDetails.username).toBe('chosen@x.com')
  })

  it('does nothing for a platform the account map does not know', () => {
    const doc = {} as Record<string, unknown>

    stampClaimAccount('some-new-marketplace', doc, 'someone@x.com')

    expect(Object.keys(doc)).toEqual([])
  })

  it('does nothing when there is no username to stamp', () => {
    // A mapping that found nobody returns "", and writing that would replace
    // "no account" with an empty account — the same state, now indistinguishable
    // from one an operator cleared.
    const doc = {} as Record<string, unknown>

    stampClaimAccount('tatacliq', doc, '')

    expect(Object.keys(doc)).toEqual([])
  })

  it('writes Nykaa where its rows keep one, even though it needs none', () => {
    // Nykaa files every claim from the company's single login, so this is
    // never reached in practice — but the map has a field for it and the
    // stamp follows the map rather than a second opinion about which
    // platforms count.
    const doc = {} as Record<string, unknown>

    stampClaimAccount('nykaa', doc, 'ops@x.com')

    expect((doc.nykaaClaimDetails as { username?: string }).username).toBe('ops@x.com')
  })
})
