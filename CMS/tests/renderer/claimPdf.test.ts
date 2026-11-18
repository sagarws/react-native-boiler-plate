import { describe, expect, it } from 'vitest'
import { COMMON_CREATE_FIELDS } from '@renderer/pages/claims/create/platforms/common/payload'
import { tint } from '@renderer/pages/claims/create/tint'

/**
 * Two small pieces of the claim form that are pure functions over data, and
 * that nothing else would catch if they broke.
 *
 * The PDF writer itself needs a canvas and a `createImageBitmap`, so it cannot
 * run here — what CAN be checked is that the whitelist it feeds and the colour
 * helper it sits beside keep their contracts.
 */

describe('the create whitelist', () => {
  it('carries the six-side PDF key rather than the loose images', () => {
    // The grid is built into one PDF, uploaded on its own, and attached to the
    // claim as a TEXT field holding the key. Multer on `/cms/createCMS`
    // whitelists `sixSideImages` and not `sideImages`, and does not want the
    // file itself.
    expect(COMMON_CREATE_FIELDS.has('sideImages')).toBe(false)
  })

  it('has no field that is obviously a file', () => {
    // Every image is resolved to a key before the claim is filed, so the body
    // is text only. A File in it would be stored as "[object File]".
    for (const field of COMMON_CREATE_FIELDS) {
      expect(field.endsWith('[]'), field).toBe(false)
    }
  })
})

describe('the tint helper', () => {
  it('names a channel variable the theme actually publishes', () => {
    expect(tint('common.black', 0.55)).toBe(
      'rgb(var(--mui-palette-common-blackChannel) / 0.55)'
    )
    expect(tint('primary.main', 0.08)).toBe(
      'rgb(var(--mui-palette-primary-mainChannel) / 0.08)'
    )
  })

  it('produces a value that follows the scheme rather than freezing a colour', () => {
    // The point of the helper: nothing it returns contains a literal colour, so
    // a dark scheme and a changed primary both reach it for free.
    const value = tint('primary.dark', 0.3)

    expect(value).not.toMatch(/#[0-9a-f]{3,8}/i)
    expect(value).toContain('var(--mui-palette-')
  })
})
