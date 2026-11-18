import { describe, expect, it } from 'vitest'
import { dataUrlToBlob } from '@renderer/pages/claims/create/imageToPdf'

/**
 * How the six-side PDF unwraps an image the main process read.
 *
 * THE CASE THIS PINS. Create Ticket on an auto-filled claim failed with "None
 * of the 5 six-side images could be read", while the same data filed fine from
 * TrackVid-FE. The main process read every image correctly and returned it as a
 * data URL; the renderer then called `fetch(dataUrl)` — and the window's CSP is
 * `connect-src 'self'`, which refuses a `data:` fetch. Every image, every time.
 *
 * The fix decodes the string instead of fetching it. This pins the decoder;
 * tests/rendererCspDataFetch.test.ts pins the CSP that makes it necessary.
 */

/** The smallest valid JPEG header bytes — enough to prove a byte-exact decode. */
const JPEG_BYTES = [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0xff, 0xd9]

const asDataUrl = (bytes: number[], type = 'image/jpeg'): string =>
  `data:${type};base64,${btoa(String.fromCharCode(...bytes))}`

describe('dataUrlToBlob', () => {
  it('decodes a base64 image byte for byte, keeping its type', async () => {
    const blob = dataUrlToBlob(asDataUrl(JPEG_BYTES))

    expect(blob.type).toBe('image/jpeg')
    expect([...new Uint8Array(await blob.arrayBuffer())]).toEqual(JPEG_BYTES)
  })

  it('keeps bytes above 0x7f intact — every photograph has them', async () => {
    const high = Array.from({ length: 256 }, (_, i) => i)
    const blob = dataUrlToBlob(asDataUrl(high, 'image/png'))

    expect([...new Uint8Array(await blob.arrayBuffer())]).toEqual(high)
  })

  it('reads the type when the header carries parameters', () => {
    // What the main process builds when the file service sends a charset.
    const url = `data:image/jpeg;charset=binary;base64,${btoa(String.fromCharCode(...JPEG_BYTES))}`

    expect(dataUrlToBlob(url).type).toBe('image/jpeg')
  })

  it('decodes a percent-encoded (non-base64) data URL', async () => {
    const blob = dataUrlToBlob('data:text/plain,hello%20world')

    expect(await blob.text()).toBe('hello world')
  })

  it('refuses a string that is not a data URL', () => {
    expect(() => dataUrlToBlob('https://file.trackvid.in/order/view/abc.jpg')).toThrow()
  })
})
