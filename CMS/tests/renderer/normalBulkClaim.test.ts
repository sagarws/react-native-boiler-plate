import { describe, expect, it } from 'vitest'
import { blankClaim } from '@renderer/pages/claims/create/blankClaim'
import {
  matchClaimTypeOption,
  selectableClaimTypes
} from '@renderer/pages/claims/create/claimTypes'
import {
  bareAwb,
  buildCreateFields
} from '@renderer/pages/claims/create/platforms/common/createFields'
import { fillBlank, sixSidePlacement } from '@renderer/pages/claims/create/platforms/common/bulk'
import { shippingAndPackingPlacement } from '@renderer/pages/claims/create/platforms/common/packingBulk'
import type { ClaimValues } from '@renderer/pages/claims/create/platforms/common/payload'
import { COMMON_CREATE_FIELDS } from '@renderer/pages/claims/create/platforms/common/payload'
import type { ECommercePlatformRecord } from '@shared/types/cmsCreate'

/**
 * Normal Bulk Claim files each spreadsheet row through the same pieces the
 * form's Save uses. These are the parts that decide what reaches the backend.
 */

const values = (patch: Partial<ClaimValues> = {}): ClaimValues =>
  ({ ...blankClaim(), ...patch })

describe('buildCreateFields', () => {
  const ajioLike = { createFields: COMMON_CREATE_FIELDS, bundle: null, sendsPobId: true }

  it('sends only whitelisted, non-empty fields', () => {
    const fields = Object.fromEntries(
      buildCreateFields(
        values({ AWBNumber: 'R1', typeOfClaimName: 'Wrong', packetId: 'P1', remark: '' }),
        ajioLike
      )
    )

    expect(fields.AWBNumber).toBe('R1')
    // Not on the default whitelist — multer would refuse the whole request.
    expect(fields.typeOfClaimName).toBeUndefined()
    expect(fields.packetId).toBeUndefined()
    expect(fields.remark).toBeUndefined()
  })

  it('sends a bundle as JSON only to the platform that owns it', () => {
    const claim = values()

    expect(Object.fromEntries(buildCreateFields(claim, ajioLike)).otherClaimDetails).toBeUndefined()

    const other = Object.fromEntries(
      buildCreateFields(claim, { ...ajioLike, bundle: 'other' as const })
    )

    expect(JSON.parse(other.otherClaimDetails as string)).toEqual(claim.otherClaimDetails)
  })

  it('drops the POB ID where the platform has none', () => {
    const fields = Object.fromEntries(
      buildCreateFields(values({ pobId: 'POB1' }), { ...ajioLike, sendsPobId: false })
    )

    expect(fields.pobId).toBeUndefined()
  })

  it('strips the label a lookup suggestion appends to an AWB', () => {
    expect(bareAwb('1234567890 (Some Brand)')).toBe('1234567890 ')
  })
})

describe('claim types', () => {
  const record = {
    _id: 'p',
    name: 'Flipkart',
    typeOfClaims: [
      { _id: '1', name: 'SHORT QUANTITY', description: '', isDisable: true },
      { _id: '2', name: 'Wrong Product', description: 'd', key: 'wrong_product' }
    ]
  } as unknown as ECommercePlatformRecord

  it('offers enabled ones, or all when none is', () => {
    expect(selectableClaimTypes(record).map((c) => c.name)).toEqual(['Wrong Product'])

    const allOff = {
      ...record,
      typeOfClaims: record.typeOfClaims.map((c) => ({ ...c, isDisable: true }))
    } as ECommercePlatformRecord

    expect(selectableClaimTypes(allOff)).toHaveLength(2)
  })

  it('matches a sheet cell however it is spelled', () => {
    const options = record.typeOfClaims

    expect(matchClaimTypeOption(options, 'wrong product')?.key).toBe('wrong_product')
    expect(matchClaimTypeOption(options, 'Short_Quantity')?.name).toBe('SHORT QUANTITY')
    expect(matchClaimTypeOption(options, 'Not a claim')).toBeNull()
  })
})

describe('screenshot placement', () => {
  const urls = ['https://s3/a.jpg', 'https://s3/b.jpg', 'https://s3/c.jpg', 'https://s3/d.jpg']

  it('puts first and last on the return and forward slots, the middle on the six sides', () => {
    const placed = sixSidePlacement(values(), urls)

    expect(placed.values.returnProductImage).toBe('a.jpg')
    expect(placed.values.forwardSentProductImage).toBe('d.jpg')
    expect(placed.sideImages).toEqual(['https://s3/b.jpg', 'https://s3/c.jpg'])
  })

  it('puts the shipping label first and the rest as packing images', () => {
    const placed = shippingAndPackingPlacement(values(), urls)

    expect(placed.values.otherClaimDetails?.shippingLabelImage).toBe('a.jpg')
    expect(placed.values.otherClaimDetails?.packingImages).toEqual(['b.jpg', 'c.jpg', 'd.jpg'])
  })

  it('never overwrites a cell the operator filled', () => {
    expect(fillBlank(values({ forwardAWB: 'F1' }), 'forwardAWB', 'F2').forwardAWB).toBe('F1')
    expect(fillBlank(values(), 'forwardAWB', 'F2').forwardAWB).toBe('F2')
  })
})
