import { describe, expect, it, vi } from 'vitest'

/**
 * Every marketplace resolves to its own artwork, however the company spells it.
 *
 * WHY THIS IS WORTH A TEST. A logo that does not resolve does not break
 * anything — it falls back to a coloured badge of initials, which is a real
 * state for a company's own platform and looks entirely deliberate. So a
 * misspelt key, a renamed file or a missing alias is invisible: the app keeps
 * working and one marketplace quietly stops having a logo.
 */

// The component imports PNGs, which vitest cannot parse. Only the resolver is
// under test, so the assets stand in as their own filenames.
vi.mock('@renderer/assets/marketplaces/ajio.png', () => ({ default: 'ajio.png' }))
vi.mock('@renderer/assets/marketplaces/amazon.png', () => ({ default: 'amazon.png' }))
vi.mock('@renderer/assets/marketplaces/delhivery.png', () => ({ default: 'delhivery.png' }))
vi.mock('@renderer/assets/marketplaces/flipkart.png', () => ({ default: 'flipkart.png' }))
vi.mock('@renderer/assets/marketplaces/increff.png', () => ({ default: 'increff.png' }))
vi.mock('@renderer/assets/marketplaces/meesho.png', () => ({ default: 'meesho.png' }))
vi.mock('@renderer/assets/marketplaces/myntra.png', () => ({ default: 'myntra.png' }))
vi.mock('@renderer/assets/marketplaces/nykaa-fashion.png', () => ({ default: 'nykaa.png' }))
vi.mock('@renderer/assets/marketplaces/other.png', () => ({ default: 'other.png' }))
vi.mock('@renderer/assets/marketplaces/snapdeal.png', () => ({ default: 'snapdeal.png' }))
vi.mock('@renderer/assets/marketplaces/tata-cliq.png', () => ({ default: 'tata-cliq.png' }))
vi.mock('@renderer/assets/marketplaces/xbees.png', () => ({ default: 'xbees.png' }))

const { platformLogo } = await import('@renderer/components/ui/PlatformLogo')

describe('resolving a marketplace logo', () => {
  it('finds one for every platform the app runs', () => {
    for (const name of [
      'Ajio',
      'Amazon',
      'Delhivery',
      'Flipkart',
      'Meesho',
      'Myntra',
      'Snapdeal',
      'Xbees'
    ]) {
      expect(platformLogo(name), name).not.toBeNull()
    }
  })

  it('ignores case and the punctuation between words', () => {
    // A company names its platforms however it likes, and the same marketplace
    // arrives spelled three ways across the claim rows, the tabs and the
    // company document.
    for (const spelling of ['Tata CliQ', 'tata cliq', 'tatacliq', 'TATA-CLIQ']) {
      expect(platformLogo(spelling), spelling).toBe('tata-cliq.png')
    }
  })

  it('knows the names whose logo file is not simply their slug', () => {
    expect(platformLogo('Nykaa')).toBe('nykaa.png')
    expect(platformLogo('Nykaa Fashion')).toBe('nykaa.png')
    expect(platformLogo('Amazon FBA')).toBe('amazon.png')
    expect(platformLogo('Myntra PPMP')).toBe('myntra.png')
  })

  it("answers null for a company's own platform, which ships no artwork", () => {
    // Not a failure: the badge of initials is how a custom marketplace is
    // meant to be drawn.
    expect(platformLogo('Our Own Store')).toBeNull()
    expect(platformLogo('Sagar')).toBeNull()
    expect(platformLogo('')).toBeNull()
    expect(platformLogo(null)).toBeNull()
  })
})
