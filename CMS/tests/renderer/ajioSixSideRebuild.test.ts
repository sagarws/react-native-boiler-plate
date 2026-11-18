import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CmsRow } from '@shared/types/cmsList'

/**
 * Bulk Update → "Six side images" on the AJIO tab.
 *
 * The rule worth pinning is WHICH screenshots become sides: the same ones the
 * manual form would put in its grid. Drift here and a rebuilt claim carries the
 * Return Product photo as a side, or loses the forward shots the form uses.
 * The second half pins that only `sixSideImages` is written, because
 * `/cms/updateCMS` treats every field it is sent as an edit.
 */

const mocks = vi.hoisted(() => ({
  getOrderScreenshots: vi.fn(),
  uploadCmsImage: vi.fn(),
  updateCMS: vi.fn(),
  createPdfFromImages_old: vi.fn()
}))

vi.mock('@renderer/pages/claims/create/api', () => ({
  getOrderScreenshots: mocks.getOrderScreenshots,
  uploadCmsImage: mocks.uploadCmsImage,
  updateCMS: mocks.updateCMS
}))
vi.mock('@renderer/pages/claims/create/imageToPdf', () => ({
  createPdfFromImages_old: mocks.createPdfFromImages_old
}))

const { buildForcedSixSidePdf, isSixSideOnlyFailure, pickSideImages, rebuildSixSidePdf } = await import(
  '@renderer/pages/claims/create/platforms/ajio/sixSideRebuild'
)

const shots = (awb: string, n: number): string[] =>
  Array.from({ length: n }, (_, i) => `https://s3/${awb}-${i}.jpg`)

const row = (over: Partial<CmsRow> = {}): CmsRow =>
  ({ id: 'cms1', platform: 'Ajio', returnAwb: 'R1', forwardAwb: 'F1', ...over }) as CmsRow

describe('pickSideImages', () => {
  it('drops the first and last return shot, as the manual form does', () => {
    const r = shots('R', 5)

    expect(pickSideImages(r, [])).toEqual(r.slice(1, -1))
  })

  it('fills from the forward shots after the return middle, without repeats', () => {
    const r = shots('R', 4)
    const f = [...shots('F', 2), r[1] as string]

    expect(pickSideImages(r, f)).toEqual([r[1], r[2], ...shots('F', 2)])
  })

  it('never uses the return first/last even when forward repeats them', () => {
    const r = shots('R', 2)

    expect(pickSideImages(r, [r[0] as string, r[1] as string, 'x'])).toEqual(['x'])
  })

  it('caps at nine', () => {
    expect(pickSideImages(shots('R', 12), shots('F', 5))).toHaveLength(9)
  })
})

describe('rebuildSixSidePdf', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.createPdfFromImages_old.mockResolvedValue(new Blob(['%PDF-1.4']))
    mocks.uploadCmsImage.mockResolvedValue({ data: { data: { key: 'pdf-key.pdf' } } })
    mocks.updateCMS.mockResolvedValue({ data: { isSuccess: true } })
  })

  it('writes only cmsId and sixSideImages', async () => {
    mocks.getOrderScreenshots.mockImplementation((awb: string) =>
      Promise.resolve({ data: { data: awb === 'R1' ? shots('R', 5) : [] } })
    )

    await expect(rebuildSixSidePdf(row())).resolves.toEqual({ id: 'cms1', ok: true })
    expect(mocks.updateCMS).toHaveBeenCalledWith({ cmsId: 'cms1', sixSideImages: 'pdf-key.pdf' })
  })

  it('treats a missing forward VMS record as no images, not a failure', async () => {
    mocks.getOrderScreenshots.mockImplementation((awb: string) =>
      awb === 'F1'
        ? Promise.reject(new Error('not found'))
        : Promise.resolve({ data: { data: shots('R', 5) } })
    )

    await expect(rebuildSixSidePdf(row())).resolves.toMatchObject({ ok: true })
  })

  it('skips a claim with fewer than three sides and writes nothing', async () => {
    mocks.getOrderScreenshots.mockResolvedValue({ data: { data: shots('R', 3) } })

    const result = await rebuildSixSidePdf(row({ forwardAwb: '' }))

    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/Fewer than 3/)
    expect(mocks.uploadCmsImage).not.toHaveBeenCalled()
    expect(mocks.updateCMS).not.toHaveBeenCalled()
  })

  it('refuses a non-AJIO row', async () => {
    await expect(rebuildSixSidePdf(row({ platform: 'Nykaa' }))).resolves.toMatchObject({ ok: false })
    expect(mocks.getOrderScreenshots).not.toHaveBeenCalled()
  })

  it('reports an upload failure as the row reason', async () => {
    mocks.getOrderScreenshots.mockResolvedValue({ data: { data: shots('R', 6) } })
    mocks.updateCMS.mockRejectedValue(new Error('CMS not found'))

    await expect(rebuildSixSidePdf(row())).resolves.toEqual({ id: 'cms1', ok: false, reason: 'CMS not found' })
  })
})

describe('isSixSideOnlyFailure (Force create eligibility)', () => {
  it('accepts a row whose only complaint is the six-side count', () => {
    expect(isSixSideOnlyFailure(['Ajio: Six-side Images (need at least 3)'])).toBe(true)
  })

  it('refuses a row also missing its Return Product Image', () => {
    expect(
      isSixSideOnlyFailure(['Ajio: Return Product Image', 'Ajio: Six-side Images (need at least 3)'])
    ).toBe(false)
  })

  it('refuses no complaints and other complaints', () => {
    expect(isSixSideOnlyFailure([])).toBe(false)
    expect(isSixSideOnlyFailure(['Nykaa: SKU ID'])).toBe(false)
  })
})

describe('buildForcedSixSidePdf', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.createPdfFromImages_old.mockResolvedValue(new Blob(['%PDF-1.4']))
    mocks.uploadCmsImage.mockResolvedValue({ data: { data: { key: 'forced.pdf' } } })
  })

  it('packs every screenshot after the Return Product Image, however few', async () => {
    const r = shots('R', 3)

    mocks.getOrderScreenshots.mockResolvedValue({ data: { data: r } })

    await expect(buildForcedSixSidePdf('R1')).resolves.toBe('forced.pdf')
    expect(mocks.getOrderScreenshots).toHaveBeenCalledWith('R1', 'Return')
    expect(mocks.createPdfFromImages_old).toHaveBeenCalledWith(r.slice(1))
  })

  it('uses the single screenshot when that is all there is', async () => {
    const r = shots('R', 1)

    mocks.getOrderScreenshots.mockResolvedValue({ data: { data: r } })

    await buildForcedSixSidePdf('R1')
    expect(mocks.createPdfFromImages_old).toHaveBeenCalledWith(r)
  })

  it('refuses an AWB with no screenshots, uploading nothing', async () => {
    mocks.getOrderScreenshots.mockResolvedValue({ data: { data: [] } })

    await expect(buildForcedSixSidePdf('R1')).rejects.toThrow(/No VMS screenshots/)
    expect(mocks.uploadCmsImage).not.toHaveBeenCalled()
  })

  it('fails when the upload returns no key', async () => {
    mocks.getOrderScreenshots.mockResolvedValue({ data: { data: shots('R', 2) } })
    mocks.uploadCmsImage.mockResolvedValue({ data: { data: {} } })

    await expect(buildForcedSixSidePdf('R1')).rejects.toThrow(/no key/)
  })
})
