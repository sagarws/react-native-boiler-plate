import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Why the six-side PDF decodes data URLs itself (see `dataUrlToBlob` in
 * renderer/pages/claims/create/imageToPdf.ts).
 *
 * The renderer's CSP is `connect-src 'self'`, which refuses `fetch(dataUrl)`.
 * That refusal made every auto-filled claim fail at Create Ticket with "None of
 * the N six-side images could be read". If someone later allows `data:` in
 * connect-src, this fails — and that is the moment to decide on purpose.
 * Both the meta tag and the header main.ts sets are checked: Chromium enforces
 * both, so the stricter one wins.
 */

const connectSrc = (policy: string): string =>
  /connect-src([^;]*)/.exec(policy)?.[1]?.trim() ?? '(falls back to default-src)'

describe('the renderer CSP', () => {
  it('does not allow data: in connect-src in index.html', () => {
    const html = readFileSync(join(__dirname, '..', 'electron/renderer/index.html'), 'utf8')
    const policy = /Content-Security-Policy"\s+content="([^"]+)"/.exec(html)?.[1] ?? ''

    expect(policy).not.toBe('')
    expect(connectSrc(policy)).not.toContain('data:')
  })

  it('does not allow data: in connect-src in the header main.ts sets', () => {
    const main = readFileSync(join(__dirname, '..', 'electron/main/main.ts'), 'utf8')
    const policy = /`(default-src[^`]+)`/.exec(main)?.[1] ?? ''

    expect(policy).not.toBe('')
    expect(connectSrc(policy)).not.toContain('data:')
  })
})
