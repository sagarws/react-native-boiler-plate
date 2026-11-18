import { describe, expect, it } from 'vitest'
import { domesticsOf } from '@main/services/company.service'

/**
 * Delhivery's "Domestic" accounts: read off the credential after a session
 * update, offered per login on the claim form, accepted on the bulk sheet.
 */

describe('domesticsOf', () => {
  it('reads the stored list and drops entries missing an id or a name', () => {
    expect(
      domesticsOf({
        domestics: [
          { id: 'cms::client::a', name: 'STYLEVERSE B2C', serviceType: 'DOMESTIC', addedAt: '2026-10-16T00:00:00.000Z' },
          { id: 'cms::client::b', name: '' },
          { name: 'NO ID' },
          'not an object'
        ]
      })
    ).toEqual([
      { id: 'cms::client::a', name: 'STYLEVERSE B2C', serviceType: 'DOMESTIC', addedAt: '2026-10-16T00:00:00.000Z' }
    ])
  })

  it('is empty for a login never synced', () => {
    expect(domesticsOf({})).toEqual([])
  })
})
