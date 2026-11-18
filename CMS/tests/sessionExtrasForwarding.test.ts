import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

/**
 * The non-cookie fields a scripted sign-in discovers must survive it.
 *
 * `loginMeeshoApi` fetches `supplierId` from the supplier boot config as part of
 * signing in — and `normalise` threw it away, because its allow-list of extras
 * predated Meesho. The session was then stored as cookies alone, the claim
 * found it incomplete, and a SECOND browser opened purely to fetch the same
 * value again. An operator watched Meesho sign in twice for one claim.
 *
 * Dropping a field here never fails loudly. It produces a session that looks
 * captured and cannot be used, which is why this is worth a test.
 */

const require_ = createRequire(import.meta.url)

const { normalise } = require_('@trackvid/automation-core/common/renewSession') as {
  normalise: (platform: string, result: unknown) => { extra: Record<string, unknown> | null }
}

const renew = require_('@trackvid/automation-core/common/renewSession') as Record<string, unknown>

describe('renewSession', () => {
  it('exposes the platforms it can sign in for', () => {
    const platforms = (renew.renewablePlatforms as () => string[])()

    expect(platforms).toEqual(
      expect.arrayContaining(['meesho', 'nykaa', 'ajio', 'flipkart', 'myntra', 'snapdeal'])
    )
  })
})

describe('normalise', () => {
  it('keeps the supplierId a Meesho login just discovered', () => {
    const result = normalise('meesho', {
      jar: { sid: 'x' },
      supplierId: 420945,
      supplierIdentifier: 'SUP-1'
    })

    expect(result.extra).toMatchObject({ supplierId: 420945, supplierIdentifier: 'SUP-1' })
  })

  it('keeps the portalId a Nykaa login just discovered', () => {
    // Same bug, same cost: the claim context refuses a Nykaa record without it.
    const result = normalise('nykaa', { jar: { sid: 'x' }, portalId: 'edbsn123', userId: '77' })

    expect(result.extra).toMatchObject({ portalId: 'edbsn123', userId: '77' })
  })

  it('still carries what it always did', () => {
    const result = normalise('flipkart', { jar: { sid: 'x' }, csrfToken: 'tok' })

    expect(result.extra).toMatchObject({ csrfToken: 'tok' })
  })

  it('leaves token platforms alone', () => {
    const result = normalise('delhivery', { jar: {}, accessToken: 'a', refreshToken: 'r' })

    expect(result.extra).toBeNull()
  })
})
