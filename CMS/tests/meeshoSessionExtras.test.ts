import { createRequire } from 'node:module'
import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * The non-cookie half of a captured Meesho session: `supplierId` and the
 * `supplierIdentifier` slug.
 *
 * Both are needed on every panel call — the id in the body, the slug as the
 * `identifier` header — and neither is a cookie. Without them a captured
 * session reads "Active" on the Sessions page and files nothing.
 *
 * THE BUG THESE TESTS NOW PIN DOWN: this used to ask
 * `/api/container/supplier/api/2.0/supplier/config` for `supplier_id`. That
 * response is the remote feature-flag blob and carries no ids at all, so every
 * capture stored null, every run called the session incomplete and signed in
 * again, and the panel answered 403 "Identifier not present or invalid" when a
 * call did get through. The ids live in `prefetch-supply-data`.
 *
 * These tests matter more than usual because `pageScript` is a STRING evaluated
 * in the page. Nothing else type-checks it, and a typo would surface only in a
 * live browser during a capture — which is the worst place to find one.
 */

const require_ = createRequire(import.meta.url)

const descriptor = require_(
  '@trackvid/automation-core/platforms/meesho/common/sessionExtras'
) as { platform: string; required: string[]; pageScript: string }

const { getSessionExtras } = require_('@trackvid/automation-core/common/sessionExtras') as {
  getSessionExtras: (platform: string) => { platform: string } | null
}

const IDENTITY_URL = '/api/container/supplier/prefetch-supply-data'

/** Runs the real pageScript with a stubbed fetch, as the browser would. */
const run = async (
  fetchImpl: unknown,
  href = 'https://supplier.meesho.com/panel/v3/new/fulfillment/e18ek/returns'
): Promise<Record<string, unknown>> => {
  ;(globalThis as { fetch?: unknown }).fetch = fetchImpl
  // The script reads the slug out of the page URL before it asks anything.
  vi.stubGlobal('location', { href })

  return (await eval(descriptor.pageScript)) as Record<string, unknown>
}

const respondWith = (body: unknown, ok = true) => () =>
  Promise.resolve({ ok, status: ok ? 200 : 401, json: () => Promise.resolve(body) })

/** What prefetch-supply-data actually answers, trimmed to the parts read. */
const supplyData = (id: number, slug: string) => ({
  registrationStatus: {
    decodedToken: {
      supplier_identifiers: [slug],
      supplier_identifier_to_id_mapping: { [slug]: id }
    },
    isAuthenticated: true
  },
  supplier: { supplier_id: id, identifier: slug, name: 'A Seller' }
})

afterEach(() => {
  delete (globalThis as { fetch?: unknown }).fetch
  vi.unstubAllGlobals()
})

describe('the meesho session-extras descriptor', () => {
  it('is registered, so the capture actually consults it', () => {
    expect(getSessionExtras('meesho')?.platform).toBe('meesho')
  })

  it('demands the slug as well as the id — a session without it is refused', () => {
    // 403 "Identifier not present or invalid" is what a session missing the
    // slug produces, and it reads exactly like an expired one.
    expect(descriptor.required).toEqual(['supplierId', 'supplierIdentifier'])
  })

  it('reads both ids from prefetch-supply-data', async () => {
    await expect(run(respondWith(supplyData(4647393, 'e18ek')))).resolves.toEqual({
      supplierId: 4647393,
      supplierIdentifier: 'e18ek'
    })
  })

  it('falls back to the token mapping when the supplier block is absent', async () => {
    const body = {
      registrationStatus: {
        decodedToken: { supplier_identifier_to_id_mapping: { e18ek: 4647393 } }
      }
    }

    await expect(run(respondWith(body))).resolves.toMatchObject({ supplierId: 4647393 })
  })

  it('posts to the identity endpoint, with the slug from the page URL', async () => {
    const fetchImpl = vi.fn(respondWith(supplyData(1, 'e18ek')))

    await run(fetchImpl)

    expect(fetchImpl).toHaveBeenCalledWith(
      IDENTITY_URL,
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        body: JSON.stringify({ identifier: 'e18ek' })
      })
    )
  })

  it('still answers when the page URL carries no slug', async () => {
    const fetchImpl = vi.fn(respondWith(supplyData(4647393, 'e18ek')))

    // The mapping covers the whole account, so an unknown slug is not a dead
    // end — which is what lets a session be repaired without a sign-in.
    await expect(
      run(fetchImpl, 'https://supplier.meesho.com/panel/v3/new/root/login')
    ).resolves.toMatchObject({ supplierIdentifier: 'e18ek' })
  })

  it('reports a signed-out page rather than returning an empty session', async () => {
    const result = await run(respondWith({}, false))

    expect(String(result.error)).toMatch(/HTTP 401/)
  })

  it('reports a body with no id, instead of storing a session missing one', async () => {
    // This is the case that makes the whole thing worth having: a session that
    // looks captured and cannot file a claim.
    const result = await run(respondWith({ something_else: true }))

    expect(String(result.error)).toMatch(/without a supplier id/)
  })

  it('never throws out of the page — a rejection comes back as an error', async () => {
    const result = await run(() => Promise.reject(new Error('offline')))

    expect(String(result.error)).toMatch(/offline/)
  })
})
