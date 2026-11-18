import { describe, expect, it } from 'vitest'
import { placeholderSixSidePdf } from '@renderer/pages/claims/create/platforms/common/placeholderSixSidePdf'
import { PLATFORMS } from '@renderer/pages/claims/create/platforms/registry'

describe('six-side placeholder PDF', () => {
  it('is used by Nykaa and by no other platform', () => {
    const using = PLATFORMS.filter((entry) => entry.sixSidePlaceholderPdf).map((entry) => entry.key)

    expect(using).toEqual(['nykaa'])
  })

  it('is only set on a platform that files a six-side PDF at all', () => {
    for (const platform of PLATFORMS.filter((entry) => entry.sixSidePlaceholderPdf)) {
      expect(platform.requiresSixSidePdf, platform.key).toBe(true)
    }
  })

  it('files a one-page PDF under the name the real one uses', async () => {
    const file = placeholderSixSidePdf()
    const text = new TextDecoder('latin1').decode(await file.arrayBuffer())

    expect(file.name).toBe('sixSideImages.pdf')
    expect(file.type).toBe('application/pdf')
    expect(text.startsWith('%PDF-')).toBe(true)
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true)
    expect(text).toContain('/Count 1')
  })
})
