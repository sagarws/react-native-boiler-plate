import { describe, expect, it } from 'vitest'
import { platformSheets } from '@renderer/pages/claims/create/bulk/normalBulk'
import { platformDescriptor } from '@renderer/pages/claims/create/platforms/registry'

/**
 * Delhivery's Domestic field: each login's synced list on the form, every
 * login's names accepted on the bulk sheet.
 */

describe('the Delhivery Domestic field', () => {
  const field = platformDescriptor('Delhivery').headerFields.find(
    (entry) => entry.path === 'otherClaimDetails.domestic'
  )
  const catalogue = { delhiveryDomestics: { 'shashidhara.ct@tigc.in': ['STYLEVERSE B2C'] } }

  it("offers the picked login's own list", () => {
    expect(field?.optionsForAccount?.(catalogue, ' Shashidhara.CT@tigc.in ')).toEqual(['STYLEVERSE B2C'])
  })

  it('falls back to EXPRESS / SURFACE for a login with no list yet', () => {
    expect(field?.optionsForAccount?.(catalogue, 'other@x.in')).toBeNull()
    expect(field?.options).toEqual(['EXPRESS', 'SURFACE'])
  })

  it('accepts every login’s names on the bulk sheet, beside the static pair', () => {
    const [sheet] = platformSheets(
      [{ _id: 'd', name: 'Delhivery', typeOfClaims: [] }],
      () => ['shashidhara.ct@tigc.in'],
      catalogue
    )
    const column = sheet?.columns.find((entry) => entry.path === 'otherClaimDetails.domestic')

    expect(column?.options).toEqual(['STYLEVERSE B2C', 'EXPRESS', 'SURFACE'])
  })
})
