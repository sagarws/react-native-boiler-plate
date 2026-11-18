import { createRequire } from 'node:module'
import { describe, expect, it, vi } from 'vitest'

/**
 * Putting a stored cookie jar back into a browser.
 *
 * The two platforms whose jar is whole cookie RECORDS — AJIO behind Akamai,
 * Tata CliQ behind Cloudflare — depend on this, and every rule it enforces is
 * a bug that has already cost a session. They are pinned here because each one
 * failed the same way: quietly. A rejected cookie leaves a jar that still looks
 * healthy, and the session dies one request later for no visible reason.
 */

const require_ = createRequire(import.meta.url)

const { hydrateCookies } = require_('@trackvid/automation-core/common/cookieHarvest') as {
  hydrateCookies: (
    page: unknown,
    jar: unknown[],
    options?: { label?: string; logger?: unknown }
  ) => Promise<number>
}

/** A page whose CDP session records what it was asked to set. */
const cdpPage = () => {
  const sent: { cookies: Record<string, unknown>[] }[] = []

  return {
    sent,
    createCDPSession: () =>
      Promise.resolve({
        send: (method: string, params: { cookies: Record<string, unknown>[] }) => {
          expect(method).toBe('Network.setCookies')
          sent.push(params)

          return Promise.resolve()
        },
        detach: () => Promise.resolve()
      })
  }
}

const quiet = { logger: { warn: () => undefined, log: () => undefined } }

describe('hydrateCookies', () => {
  it("keeps Cloudflare's clearance cookie by leaving partitionKey behind", async () => {
    // The reported failure, verbatim:
    //   cookie "cf_clearance" rejected: Protocol error (Network.deleteCookies):
    //   Failed to deserialize params.partitionKey.topLevelSite
    // Newer Chrome hands `partitionKey` back as an object, and passing it on
    // fails to deserialise — losing the one cookie that stops the next request
    // being a challenge page.
    const page = cdpPage()
    const restored = await hydrateCookies(
      page,
      [
        {
          name: 'cf_clearance',
          value: 'abc',
          domain: '.tatacliq.com',
          path: '/',
          secure: true,
          httpOnly: true,
          partitionKey: { topLevelSite: undefined, hasCrossSiteAncestor: false }
        }
      ],
      quiet
    )

    expect(restored).toBe(1)

    const cookie = page.sent[0]?.cookies[0] ?? {}

    expect(cookie.name).toBe('cf_clearance')
    expect(cookie).not.toHaveProperty('partitionKey')
  })

  it('drops expires: -1 rather than dating the cookie to 1969', async () => {
    // -1 means "session cookie". Handed back, Chrome reads it as a Unix
    // timestamp and rejects the cookie as expired the instant it is set —
    // which is how AJIO's bff_session was lost on every reuse.
    const page = cdpPage()

    await hydrateCookies(
      page,
      [{ name: 'bff_session', value: 'x', domain: '.ajio.com', expires: -1 }],
      quiet
    )

    expect(page.sent[0]?.cookies[0]).not.toHaveProperty('expires')
  })

  it('keeps a real expiry', async () => {
    const page = cdpPage()
    const expires = 1893456000

    await hydrateCookies(page, [{ name: 'a', value: 'b', domain: 'x.com', expires }], quiet)

    expect(page.sent[0]?.cookies[0]?.expires).toBe(expires)
  })

  it('omits a sameSite the protocol would reject for the whole batch', async () => {
    const page = cdpPage()

    await hydrateCookies(
      page,
      [
        { name: 'a', value: '1', domain: 'x.com', sameSite: '' },
        { name: 'b', value: '2', domain: 'x.com', sameSite: 'Lax' }
      ],
      quiet
    )

    const [first, second] = page.sent[0]?.cookies ?? []

    expect(first).not.toHaveProperty('sameSite')
    expect(second?.sameSite).toBe('Lax')
  })

  it('sends one batch, not one call per cookie', async () => {
    // HttpOnly cookies can only be set through CDP, and a per-cookie loop is
    // what made a single bad record look like a per-cookie problem.
    const page = cdpPage()

    await hydrateCookies(
      page,
      [
        { name: 'a', value: '1', domain: 'x.com' },
        { name: 'b', value: '2', domain: 'x.com' }
      ],
      quiet
    )

    expect(page.sent).toHaveLength(1)
    expect(page.sent[0]?.cookies).toHaveLength(2)
  })

  it('falls back to page.setCookie with the SANITISED record', async () => {
    // The old fallback passed the raw stored cookie, reproducing the very
    // failures the whitelist exists to prevent — on the one path where a
    // session was already in trouble.
    const setCookie = vi.fn().mockResolvedValue(undefined)
    const page = {
      createCDPSession: () => Promise.reject(new Error('no CDP here')),
      setCookie
    }

    const restored = await hydrateCookies(
      page,
      [{ name: 'cf_clearance', value: 'abc', domain: '.tatacliq.com', expires: -1, partitionKey: {} }],
      quiet
    )

    expect(restored).toBe(1)
    expect(setCookie.mock.calls[0]?.[0]).not.toHaveProperty('partitionKey')
    expect(setCookie.mock.calls[0]?.[0]).not.toHaveProperty('expires')
  })

  it('counts what actually landed when one cookie is refused', async () => {
    const setCookie = vi
      .fn()
      .mockRejectedValueOnce(new Error('rejected'))
      .mockResolvedValueOnce(undefined)
    const page = {
      createCDPSession: () => Promise.reject(new Error('no CDP here')),
      setCookie
    }

    // Two sent, one refused: the old fallback reported the whole jar as set.
    expect(
      await hydrateCookies(
        page,
        [
          { name: 'a', value: '1', domain: 'x.com' },
          { name: 'b', value: '2', domain: 'x.com' }
        ],
        quiet
      )
    ).toBe(1)
  })

  it('reports nothing set for an empty jar rather than pretending', async () => {
    expect(await hydrateCookies(cdpPage(), [], quiet)).toBe(0)
  })
})
