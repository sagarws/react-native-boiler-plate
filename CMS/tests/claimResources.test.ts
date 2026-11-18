import { describe, expect, it } from 'vitest'
import { claimResourceBuilder } from '@main/automations/registry'
import { supportingFiles, urls } from '@main/automations/common/claimResources'
import type { ClaimDocument } from '@main/automations/common/types'

/**
 * Each platform's evidence zip, from a `/cms/find-by-awb` response shaped the
 * way TrackVid-BE builds it (`getPlatformConfig` + the resolved document URLs).
 *
 * The names ARE the feature: an operator filing by hand matches each file to a
 * slot on the marketplace's form by its name.
 */

const S3 = (key: string): string => `https://s3.ap-south-1.amazonaws.com/trackvid/${key}`

const build = (platform: string, doc: Partial<ClaimDocument>, config: Record<string, unknown>) =>
  claimResourceBuilder(platform)({ AWBNumber: 'AWB1', ...doc, config }, config)

const names = (platform: string, doc: Partial<ClaimDocument>, config: Record<string, unknown>): string[] =>
  build(platform, doc, config).files.map(file => file.name)

describe('claim resource names follow each claim form', () => {
  it('snapdeal uses the portal slot keys', () => {
    expect(
      names('Snapdeal', {}, {
        outerPackagingImage: [S3('o1.jpg')],
        innerPackagingImage: [S3('i1.jpg'), S3('i2.jpg')],
        attachProductImage: [S3('p1.jpg')],
        proofOfDeliveryImage: [S3('d1.png'), S3('d2.png')],
        unpackingVideo: S3('v.mp4')
      })
    ).toEqual([
      'outer_packaging_packslip_image1',
      'inner_packaging_image1',
      'inner_packaging_image2',
      'product_image1',
      'POD_slip_image1',
      'POD_slip_image2',
      'video'
    ])
  })

  it('xbees maps TrackVid sides onto the portal proof slots', () => {
    expect(
      names('xbees', {}, {
        packagePhotos: { Top: S3('t.jpg'), Right: S3('r.jpg'), Bottom: S3('b.jpg'), Left: '' },
        unboxingVideo: S3('u.mp4'),
        packagingVideo: ''
      })
    ).toEqual(['PhotoProof1_Front', 'PhotoProof2_Back', 'PhotoProof3_RightSide', 'UnboxingVideoProof1'])
  })

  it('delhivery counts unboxing images and videos separately', () => {
    expect(
      names('delhivery', {}, {
        shippingLabel: S3('label.png'),
        unboxingDoc: [S3('a.jpg'), S3('b.jpg'), S3('v.mp4')]
      })
    ).toEqual(['Shipping_Label', 'Unbox_Image_1', 'Unbox_Image_2', 'Unbox_Video_1'])
  })

  it('meesho, myntra and flipkart use the tags their claim flows upload under', () => {
    expect(
      names('meesho', {}, {
        barcodeImage: S3('bc.jpg'),
        productImage: [S3('p1.jpg'), S3('p2.jpg')],
        reverseWaybill: S3('w.jpg'),
        unpackingVideo: S3('v.mp4')
      })
    ).toEqual(['barcode', 'product_1', 'product_2', 'waybill_1', 'video'])

    expect(
      names('myntra', {}, {
        shippingLabelImage: S3('s.jpg'),
        productPackingImages: [S3('a.jpg')],
        damagedVideo: S3('d.mp4')
      })
    ).toEqual(['shipping_label', 'packing_1', 'damaged_video'])

    expect(
      names('flipkart', {}, { shippingLabel: S3('s.jpg'), evidenceImages: [S3('a.jpg'), S3('b.jpg')] })
    ).toEqual(['shipping-label', 'evidence_1', 'evidence_2'])
  })

  it('ajio attaches the side-images PDF from the document, not the raw key in config', () => {
    const resources = build('Ajio', { AWBNumber: 'R2454', sixSideImages: S3('six.pdf'), pobid: 'DV1' }, {
      sixSideImages: { fileKey: 'six.pdf' },
      pobid: 'DV1'
    })

    expect(resources.files).toEqual([
      { name: 'R2454 - Side Images', field: 'Attachment (six side images)', url: S3('six.pdf') }
    ])
    expect(resources.fields).toContainEqual(['POB ID', 'DV1'])
  })

  it('nykaa has no upload slots, so its evidence travels as supporting files', () => {
    const doc = { returnVideoLink: S3('r.mp4'), podProof: S3('pod.jpg') }

    expect(names('nykaa', doc, { emailBody: '<p>Hi</p>' })).toEqual([])
    expect(supportingFiles(doc as ClaimDocument).map(f => f.name)).toEqual(['pod_proof', 'return_video'])
  })

  it('a platform with no form of its own gets everything under TrackVid names', () => {
    expect(names('Tata CliQ', { sixSideImages: S3('s.pdf'), forwardVideoLink: S3('f.mp4') }, {})).toEqual([
      'six_side_images',
      'forward_video'
    ])
  })
})

describe('reading the backend shapes', () => {
  it('accepts a string, { url } objects and arrays, and drops non-links', () => {
    expect(urls([S3('a.jpg'), { url: S3('b.jpg') }, '', null, 'not a link'])).toEqual([S3('a.jpg'), S3('b.jpg')])
    expect(urls({ fileKey: 'k' })).toEqual([])
  })

  it('turns the HTML template into pasteable text with links kept', () => {
    const { description } = build('snapdeal', {}, {
      description: '<p>Dear Team,</p><p>Video: <a href="https://x.test/v.mp4">link</a></p>'
    })

    expect(description).toBe('Dear Team,\nVideo: https://x.test/v.mp4')
  })
})
