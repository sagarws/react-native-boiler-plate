import placeholderDataUrl from '@renderer/public/six-side-placeholder.pdf?inline'

/**
 * TEMPORARY. The one-page PDF filed in place of real six-side images, on any
 * platform whose descriptor sets `sixSidePlaceholderPdf`.
 *
 * Why it exists: the backend's createCMS refuses these platforms without a
 * `sixSideImages` key, and building the real PDF needs every VMS screenshot to
 * download — one missing image stopped the whole claim at "Could not load
 * image". Nykaa takes no attachment (the key only becomes a link in the ticket
 * body), so a fixed page keeps claims moving until that is settled properly.
 *
 * INLINED, NOT FETCHED: the packaged renderer loads from file:// under a
 * `connect-src 'self'` CSP, so a fetch that works in dev can fail in the
 * installer. `?inline` bakes the bytes into the bundle instead.
 */
export const placeholderSixSidePdf = (): File => {
  const base64 = placeholderDataUrl.slice(placeholderDataUrl.indexOf(',') + 1)
  const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))

  return new File([bytes], 'sixSideImages.pdf', { type: 'application/pdf' })
}
