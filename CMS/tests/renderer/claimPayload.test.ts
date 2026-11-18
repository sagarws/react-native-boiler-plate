import { describe, expect, it } from 'vitest'
import { OTHER_INITIAL_CLAIM_DETAILS } from '@shared/types/cmsCreate'
import type { ClaimValues } from '@renderer/pages/claims/create/platforms/common/payload'
import { COMMON_CREATE_FIELDS } from '@renderer/pages/claims/create/platforms/common/payload'
import { PLATFORMS, platformDescriptor } from '@renderer/pages/claims/create/platforms/registry'

/**
 * What each platform actually sends.
 *
 * `/cms/updateCMS` accepts a SUBSET and keeps whatever is stored for anything
 * absent — so a field sent as an empty string is not a no-op, it is an
 * instruction to erase. That asymmetry is the whole reason these builders exist
 * and the reason every case below is about presence rather than value.
 */

const values = (over: Partial<ClaimValues> = {}): ClaimValues =>
  ({
    eCommercePlatform: 'id',
    AWBNumber: '1',
    typeOfClaim: 'x',
    returnProductImage: '',
    additionalFieldTitle: '',
    additionalFieldValue: '',
    otherClaimDetails: { ...OTHER_INITIAL_CLAIM_DETAILS },
    ...over
  })

const build = (key: string, over: Partial<ClaimValues> = {}): Record<string, unknown> =>
  platformDescriptor(key).buildUpdate({
    values: values(over),
    platformLabel: platformDescriptor(key).label
  })

describe('the platform registry', () => {
  it('gives every platform a form, a validator and a create whitelist', () => {
    for (const platform of PLATFORMS) {
      expect(platform.Form, platform.key).toBeTruthy()
      expect(typeof platform.validate, platform.key).toBe('function')
      expect(platform.createFields.size, platform.key).toBeGreaterThan(0)
    }
  })

  it('answers to a platform named either as a key or as its label', () => {
    expect(platformDescriptor('tataCliq').key).toBe('tataCliq')
    expect(platformDescriptor('Tata CliQ').key).toBe('tataCliq')
    expect(platformDescriptor('nykaa').label).toBe('Nykaa Fashion')
    expect(platformDescriptor('Nykaa Fashion').key).toBe('nykaa')
  })

  it("falls back to the default form for a company's own platform, without AJIO's rules", () => {
    // A custom marketplace renders through the common layout, but it has no
    // POB and no `ajio_account_email` slot — posting either would be a field
    // that platform's create branch has never seen.
    const custom = platformDescriptor('Our Own Store')

    expect(custom.Form).toBe(platformDescriptor('ajio').Form)
    expect(custom.sendsPobId).toBe(false)
    expect(custom.accountPath).toBeNull()
  })

  it('sends POB ID on AJIO and nowhere else', () => {
    expect(platformDescriptor('ajio').sendsPobId).toBe(true)

    for (const platform of PLATFORMS.filter((entry) => entry.key !== 'ajio')) {
      expect(platform.sendsPobId, platform.key).toBe(false)
    }
  })

  it('keeps the six-side PDF for the platforms that have no slots of their own', () => {
    // The PDF exists because those platforms collect nine loose photographs.
    // A platform with named slots carries them individually instead.
    expect(platformDescriptor('ajio').requiresSixSidePdf).toBe(true)
    expect(platformDescriptor('shopify').requiresSixSidePdf).toBe(true)
    expect(platformDescriptor('nykaa').requiresSixSidePdf).toBe(true)

    for (const key of ['meesho', 'myntra', 'snapdeal', 'flipkart', 'amazon', 'tataCliq', 'delhivery', 'xbees']) {
      expect(platformDescriptor(key).requiresSixSidePdf, key).toBe(false)
    }
  })

  it('does not auto-pick an account for Nykaa, which files under one regardless', () => {
    expect(platformDescriptor('nykaa').accountPath).toBe('nykaaClaimDetails.username')
    expect(platformDescriptor('nykaa').autoSelectSoleAccount).toBe(false)
  })
})

describe('the create whitelist', () => {
  it("leaves Meesho's own fields out of every other platform's body", () => {
    // Multer rejects the WHOLE request on an unexpected field, so this is not
    // tidiness — a Meesho field on an AJIO claim loses the claim.
    expect(COMMON_CREATE_FIELDS.has('packetId')).toBe(false)
    expect(COMMON_CREATE_FIELDS.has('typeOfClaimName')).toBe(false)
    expect(platformDescriptor('meesho').createFields.has('packetId')).toBe(true)
  })

  it('keeps the videos on Myntra, which renders the same video row as the rest', () => {
    // These were once omitted, and every Myntra claim reached the portal with
    // no CCTV link in its description.
    const myntra = platformDescriptor('myntra').createFields

    for (const field of ['returnVideo', 'returnVideoLink', 'forwardVideo', 'forwardVideoLink']) {
      expect(myntra.has(field), field).toBe(true)
    }
  })

  it("gives Snapdeal its eight photographs and no one else's", () => {
    expect(platformDescriptor('snapdeal').createFields.has('podImage_2')).toBe(true)
    expect(COMMON_CREATE_FIELDS.has('podImage_2')).toBe(false)
  })
})

describe('what each platform adds to an update', () => {
  it('AJIO sends a POB only when the operator has one on the form', () => {
    // A present pobId is stamped `manual` by the server and permanently opts
    // the row out of the dispatch-time re-resolve, so a blank must not be sent.
    expect(build('ajio')).toEqual({})
    expect(build('ajio', { pobId: '  ' })).toEqual({})
    expect(build('ajio', { pobId: ' POB1 ' })).toEqual({ pobId: 'POB1' })
  })

  it('Tata CliQ sends its sub-reason and video URLs even when empty', () => {
    // Eleven of the twelve reasons take no sub-reason, and the portal clears
    // the select when the reason changes — so moving off Wrong Product has to
    // clear what was stored.
    const payload = build('tataCliq', {
      otherClaimDetails: {
        ...OTHER_INITIAL_CLAIM_DETAILS,
        qcReason: '12',
        qcSubReason: '',
        packagingVideoUrl: '',
        unboxingVideoUrl: ''
      }
    })

    expect(payload.otherQcReason).toBe('12')
    expect(payload.otherQcSubReason).toBe('')
    expect(payload.otherPackagingVideoUrl).toBe('')
    expect(payload.otherUnboxingVideoUrl).toBe('')
  })

  it('Tata CliQ does NOT send an empty set of QC images', () => {
    // An empty object asks the server to replace six photographs with none.
    const payload = build('tataCliq', {
      otherClaimDetails: { ...OTHER_INITIAL_CLAIM_DETAILS, qcImages: {} }
    })

    expect('otherQcImages' in payload).toBe(false)
  })

  it('Tata CliQ keys its QC images by slot, so each keeps its meaning', () => {
    const payload = build('tataCliq', {
      otherClaimDetails: {
        ...OTHER_INITIAL_CLAIM_DETAILS,
        qcImages: { productImage: ' a ', packingSlip: '', shippingLabel: 'b' }
      }
    })

    // Trimmed, and the empty slot dropped rather than sent as "".
    expect(payload.otherQcImages).toEqual({ productImage: 'a', shippingLabel: 'b' })
  })

  it('Xbees sends its disputed amount and nothing from the shared bundle', () => {
    // It stores into `otherClaimDetails` like the others, but the endpoint
    // takes only this from it — sending a shipping label it never collects
    // would write an empty one over the stored value.
    const payload = build('xbees', {
      otherClaimDetails: {
        ...OTHER_INITIAL_CLAIM_DETAILS,
        disputeAmount: '900',
        shippingLabelImage: 'label'
      }
    })

    expect(payload).toEqual({ disputeAmount: '900' })
  })

  it('Flipkart, Delhivery and Amazon all stamp the platform on the bundle', () => {
    // The endpoint routes several fields by it, so anything sending one has to
    // say which marketplace it belongs to.
    for (const key of ['flipkart', 'delhivery', 'amazon', 'tataCliq']) {
      expect(build(key).eCommercePlatform, key).toBe(platformDescriptor(key).label)
    }
  })

  it('sends an empty packing list, because clearing one is a real intent', () => {
    const payload = build('flipkart', {
      otherClaimDetails: { ...OTHER_INITIAL_CLAIM_DETAILS, packingImages: [] }
    })

    expect(payload.otherPackingImages).toEqual([])
  })

  it('Meesho only sends a cost that is a sane number', () => {
    expect(build('meesho', { costOfMissingArticle: '250' }).costOfMissingArticle).toBe(250)
    expect('costOfMissingArticle' in build('meesho', { costOfMissingArticle: '' })).toBe(false)
    expect('costOfMissingArticle' in build('meesho', { costOfMissingArticle: 'abc' })).toBe(false)
    expect('costOfMissingArticle' in build('meesho', { costOfMissingArticle: '-4' })).toBe(false)
  })

  it('Myntra prefers a recorded damage video over a pasted link', () => {
    const both = build('myntra', {
      myntraClaimDetails: {
        shippingLabelImage: '',
        packingImages: [],
        damagedProductVideo: 'key/v.mp4',
        damagedProductVideoLink: 'https://example.test/v.mp4'
      }
    })

    expect(both.myntraDamagedProductVideo).toBe('key/v.mp4')
    expect('myntraDamagedProductVideoLink' in both).toBe(false)

    const linkOnly = build('myntra', {
      myntraClaimDetails: {
        shippingLabelImage: '',
        packingImages: [],
        damagedProductVideo: '',
        damagedProductVideoLink: 'https://example.test/v.mp4'
      }
    })

    expect(linkOnly.myntraDamagedProductVideoLink).toBe('https://example.test/v.mp4')
  })

  it('Shopify adds nothing — it has no seller portal to file against', () => {
    expect(build('shopify')).toEqual({})
  })
})
