import { describe, expect, it } from 'vitest'

/**
 * How a stored six-side image is turned back into bytes.
 *
 * THE CASE THIS PINS. Creating a claim from auto-filled data failed every time
 * with "None of the 5 six-side images could be read", while the SAME data filed
 * fine from the admin panel. The images were visible in the grid throughout —
 * which is the whole trap: an `<img>` renders a stored URL without CORS, and
 * `fetch` of that same URL is a cross-origin, unauthenticated request whose
 * body the page may not read.
 *
 * The FE never hits this because it does not fetch the URL at all. It takes the
 * LAST PATH SEGMENT as an S3 key and asks the orders API for it — see
 * `fetchOrderImageBlob` in TrackVid-FE's `src/helper/image-to-pdf.ts`:
 *
 *     const s3Key = input.split("/").pop() || input
 *     axios.get(`${ORDERS_BASE_URL}/order/view/${s3Key}`, { responseType: 'blob' })
 *
 * This is that rule, written down. If it drifts from the FE again, the symptom
 * is the one above: every image unreadable, with nothing wrong with any image.
 */

/** The key extraction `readRemoteImage` performs. */
const imageKey = (given: string): string => {
  const path = given.split('?')[0] ?? given
  const alreadyServed = /\/order\/view\/(.+)$/.exec(path)
  const underBucket = /^https?:\/\/[^/]+\/[^/]+\/(.+)$/.exec(path)

  return alreadyServed?.[1] ?? underBucket?.[1] ?? path.split('/').pop() ?? path
}

describe('an image already served by the file service', () => {
  it('keeps the key that follows /order/view/', () => {
    /*
     * THE SHAPE THAT ACTUALLY ARRIVES, and the one a single "after the bucket"
     * rule gets wrong: it yields `view/abc123.jpg`, and the request becomes
     * /order/view/view/abc123.jpg.
     *
     * It is also the shape that proves the strings are not raw S3 urls: that
     * bucket answers 403 to anyone, so an S3 url would show as a BROKEN IMAGE
     * in the grid. The images render, therefore they are served by this host.
     */
    expect(imageKey('https://file.trackvid.in/order/view/abc123.jpg')).toBe('abc123.jpg')
  })

  it('keeps a nested key whole', () => {
    expect(imageKey('https://file.trackvid.in/order/view/screenshots/2026/abc.jpg')).toBe(
      'screenshots/2026/abc.jpg'
    )
  })
})

describe('a stored image given as a full URL', () => {
  it('is reduced to its S3 key', () => {
    expect(imageKey('https://trackvid-media.s3.ap-south-1.amazonaws.com/orders/abc123.jpg')).toBe(
      'abc123.jpg'
    )
  })

  it('drops a signed query string, which is not part of the key', () => {
    // Left on, the orders API is asked for "abc123.jpg?X-Amz-Signature=…" and
    // answers 404 — an error that reads like a missing image rather than a
    // malformed request.
    expect(imageKey('https://host/orders/abc123.jpg?X-Amz-Signature=deadbeef&Expires=1')).toBe(
      'abc123.jpg'
    )
  })
})

describe('a key with slashes in it', () => {
  it('keeps them, because the key is everything after the bucket', () => {
    /*
     * THE FE IS WRONG HERE and this is deliberately not a copy of it.
     * `split('/').pop()` would yield "xyz.jpg", which S3 does not hold — and
     * `/order/view` reports a key it cannot find as a 500, so the symptom is a
     * service that looks broken rather than a key that was mangled on the way
     * out. The route is declared `/view/:key(*)`, which matches slashes.
     */
    expect(imageKey('https://s3.ap-south-1.amazonaws.com/trackvid/screenshots/2026/xyz.jpg')).toBe(
      'screenshots/2026/xyz.jpg'
    )
  })
})

describe('a stored image given as a bare key', () => {
  it('is left alone', () => {
    // Both shapes arrive from /order/screenshot, which is why the FE's
    // `|| input` fallback exists.
    expect(imageKey('abc123.jpg')).toBe('abc123.jpg')
  })
})
