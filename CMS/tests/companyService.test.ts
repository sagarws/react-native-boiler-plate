import { describe, expect, it, vi } from 'vitest'
import type * as CompanyService from '@main/services/company.service'

/**
 * Reading a Mongo document that arrives as `unknown`.
 *
 * Two things go wrong quietly here and are worth pinning:
 *
 *   - `String(value)` on a plain object yields "[object Object]", which would
 *     be stored as a username or a credential id and never look obviously
 *     wrong until a lookup silently matched nothing.
 *   - `eComPlatform` is stored inconsistently — "AJIO" and "ajio", and Xbees as
 *     three different names — so an equality check finds a company's
 *     credentials on some rows and not others.
 */

vi.mock('electron', () => ({ safeStorage: { isEncryptionAvailable: () => false } }))
vi.mock('@main/services/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}))
vi.mock('@main/database', () => ({ dataDirectory: () => '/tmp' }))
vi.mock('@main/services/httpClient', () => ({ apiRequest: vi.fn() }))
vi.mock('@main/services/session.store', () => ({ getAccessToken: () => 'token' }))

const load = async (): Promise<typeof CompanyService> => {
  vi.resetModules()

  return import('@main/services/company.service')
}

describe('company document reads', () => {
  it('matches a platform however its name is stored', async () => {
    const { credentialsFor } = await load()
    const store = await import('@main/services/company.store')

    vi.spyOn(store, 'readCompany').mockResolvedValue({
      fetchedAt: 'now',
      company: {
        settings: {
          eCommercePlatformLoginInfo: [
            // Stored uppercase, and Xbees under one of its three spellings.
            { eComPlatform: 'AJIO', info: [{ username: 'a@b.c', password: 'p' }] },
            { eComPlatform: 'xpressbees', info: [{ username: 'x@y.z', password: 'q' }] }
          ]
        }
      }
    })

    expect((await credentialsFor('ajio'))[0]?.username).toBe('a@b.c')
    expect((await credentialsFor('xbees'))[0]?.username).toBe('x@y.z')
  })

  it('never turns a nested object into "[object Object]"', async () => {
    const { credentialsFor } = await load()
    const store = await import('@main/services/company.store')

    vi.spyOn(store, 'readCompany').mockResolvedValue({
      fetchedAt: 'now',
      company: {
        settings: {
          eCommercePlatformLoginInfo: [
            {
              eComPlatform: 'snapdeal',
              info: [
                {
                  // An ObjectId carries its own toString and IS meaningful text.
                  _id: { toString: () => '6a784ade045b94407bb5154d' },
                  username: 'seller@example.com',
                  // A stray object where a string was expected must become "",
                  // not the literal "[object Object]".
                  vendorCode: { unexpected: true },
                  snapdealSession: { jar: { JSESSIONID: 'abc' } }
                }
              ]
            }
          ]
        }
      }
    })

    const [credential] = await credentialsFor('snapdeal')

    expect(credential?.credentialId).toBe('6a784ade045b94407bb5154d')
    expect(credential?.vendorCode).toBe('')
    expect(credential?.session).toEqual({ jar: { JSESSIONID: 'abc' } })
  })

  it('reports no session rather than an empty one when none was captured', async () => {
    const { credentialFor } = await load()
    const store = await import('@main/services/company.store')

    vi.spyOn(store, 'readCompany').mockResolvedValue({
      fetchedAt: 'now',
      company: {
        settings: {
          eCommercePlatformLoginInfo: [
            { eComPlatform: 'meesho', info: [{ username: 'm@x.io', password: 'p' }] }
          ]
        }
      }
    })

    // null, not {} — the caller falls back to signing in, and an empty object
    // would read as "a session exists" and be handed to a flow as cookies.
    expect((await credentialFor('meesho', 'm@x.io'))?.session).toBeNull()
  })
})

/**
 * A refresh must not undo a capture.
 *
 * `refreshCompany` replaces the local copy wholesale, and the local copy is
 * what every automation reads. A capture writes the new session to the server
 * AND patches it in locally, because the next claim must not run on the jar
 * that was just replaced — so a refresh landing in between, with a server
 * document that has not caught up, silently restores the session the capture
 * had just replaced.
 *
 * That is the bug this pins. A Myntra login captured at 06:02:10 was gone by
 * 06:02:57, when a routine refresh installed a document last written at
 * 03:23:52; Auto claim probed the restored jar at 06:03:04, Myntra called it
 * anonymous, and the account's claims were skipped forty seconds after an
 * operator watched the sign-in succeed.
 */
describe('refreshing the company document', () => {
  const remote = (session: Record<string, unknown> | undefined) => ({
    settings: {
      eCommercePlatformLoginInfo: [
        {
          eComPlatform: 'myntra',
          info: [
            {
              username: 'listing@mozafia.com',
              password: 'p',
              ...(session ? { myntraSession: session } : {})
            }
          ]
        }
      ]
    }
  })

  const localWith = (session: Record<string, unknown>) => ({
    fetchedAt: 'now',
    company: remote(session)
  })

  const FRESH = { jar: { 'erp.at': 'new' }, capturedAt: '2026-09-19T06:02:10.790Z' }
  const STALE = { jar: { 'erp.at': 'old' }, capturedAt: '2026-09-19T03:23:52.657Z' }

  it('keeps a session captured here that the document has not caught up with', async () => {
    const { refreshCompany } = await load()
    const store = await import('@main/services/company.store')
    const http = await import('@main/services/httpClient')

    vi.spyOn(store, 'readCompany').mockResolvedValue(localWith(FRESH))
    vi.spyOn(http, 'apiRequest').mockResolvedValue({ success: true, data: remote(STALE) })

    const saved = vi.spyOn(store, 'saveCompany').mockResolvedValue(undefined)

    await refreshCompany()

    const installed = saved.mock.calls[0]?.[0] as ReturnType<typeof remote>
    const account = installed.settings.eCommercePlatformLoginInfo[0]?.info[0] as Record<
      string,
      unknown
    >

    expect(account.myntraSession).toEqual(FRESH)
  })

  it('takes the document’s session when that is the newer one', async () => {
    const { refreshCompany } = await load()
    const store = await import('@main/services/company.store')
    const http = await import('@main/services/httpClient')

    vi.spyOn(store, 'readCompany').mockResolvedValue(localWith(STALE))
    vi.spyOn(http, 'apiRequest').mockResolvedValue({ success: true, data: remote(FRESH) })

    const saved = vi.spyOn(store, 'saveCompany').mockResolvedValue(undefined)

    await refreshCompany()

    const installed = saved.mock.calls[0]?.[0] as ReturnType<typeof remote>
    const account = installed.settings.eCommercePlatformLoginInfo[0]?.info[0] as Record<
      string,
      unknown
    >

    expect(account.myntraSession).toEqual(FRESH)
  })

  /**
   * A credential the server has no session for at all is the same case: this
   * machine captured one, the document does not know about it yet, and
   * installing the document must not blank it.
   */
  it('keeps a local session when the document carries none', async () => {
    const { refreshCompany } = await load()
    const store = await import('@main/services/company.store')
    const http = await import('@main/services/httpClient')

    vi.spyOn(store, 'readCompany').mockResolvedValue(localWith(FRESH))
    vi.spyOn(http, 'apiRequest').mockResolvedValue({ success: true, data: remote(undefined) })

    const saved = vi.spyOn(store, 'saveCompany').mockResolvedValue(undefined)

    await refreshCompany()

    const installed = saved.mock.calls[0]?.[0] as ReturnType<typeof remote>
    const account = installed.settings.eCommercePlatformLoginInfo[0]?.info[0] as Record<
      string,
      unknown
    >

    expect(account.myntraSession).toEqual(FRESH)
  })
})
