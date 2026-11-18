import { beforeEach, describe, expect, it, vi } from 'vitest'
import type * as SignInPolicy from '@main/services/signInPolicy'

/**
 * Getting to a signed-in AJIO page.
 *
 * Three things on this machine need one — filing a claim, mapping an account,
 * picking a SKU — and each used to open its own. Two of the three signed in and
 * never SAVED the session, which is invisible in isolation and obvious in use:
 * every press of the SKU icon showed the AJIO login form while a perfectly good
 * record sat in the company document unused.
 *
 * It cannot be reused unless it is saved, and `reuseSessionRecord` is strict
 * about what it will take — a `userId`, a NON-EMPTY `pobIds`, and an HttpOnly
 * `bff_session` cookie. Skip the save and the next call signs in again. Forever.
 */

const calls = vi.hoisted(() => ({
  launched: 0,
  reuseAttempts: 0,
  logins: 0,
  published: [] as { username: string; extras: Record<string, unknown> }[],
  livePobFetches: 0,
  closed: 0
}))

interface Behaviour {
  /** What the stored record probes to: null means the reuse failed. */
  reuseResult: { userId: string; pobIds: string[] } | null
  stored: unknown
  storedPobIds: { id: string; addedAt: string | null; lastUsed: string | null }[]
  livePobIds: string[]
  sellerId: string | null
  /** The app refuses sign-in by default (signInPolicy); these tests are about the sign-in itself. */
  allowSignIn: boolean
}

const behaviour = vi.hoisted<Behaviour>(() => ({
  reuseResult: null,
  stored: { jar: [{ name: 'bff_session' }] },
  storedPobIds: [],
  livePobIds: ['LIVE-1'],
  sellerId: 'seller-1',
  allowSignIn: true
}))

vi.mock('@main/services/signInPolicy', async importOriginal => ({
  ...(await importOriginal<typeof SignInPolicy>()),
  refuseSignInUnlessAllowed: (_platform: string, _username: string, detail: string) => {
    if (!behaviour.allowSignIn) throw new Error(`the saved login is expired and this run does not sign in — ${detail}`)
  }
}))

vi.mock('@main/services/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))
vi.mock('@main/automations/common/prepareCore', () => ({
  prepareCoreWithBrowser: () => Promise.resolve()
}))
vi.mock('@main/services/sessionReuse.service', () => ({
  storedSession: () => Promise.resolve(behaviour.stored)
}))
vi.mock('@main/services/platformSession.service', () => ({
  publishSession: (_platform: string, username: string, _jar: unknown, extras: Record<string, unknown>) => {
    calls.published.push({ username, extras })

    return Promise.resolve({ success: true, data: {} })
  }
}))
vi.mock('@main/services/company.service', () => ({
  credentialFor: () => Promise.resolve({ pobIds: behaviour.storedPobIds }),
  orderedPobIds: (pobs: { id: string }[]) => pobs.map(pob => pob.id)
}))
vi.mock('@main/automations/common/coreLoader', () => ({
  loadCore: (subpath: string) => {
    if (subpath === 'common/browserRuntime') {
      return {
        loadPuppeteer: () => ({
          launch: () => {
            calls.launched += 1

            return Promise.resolve({
              newPage: () => Promise.resolve({ goto: () => Promise.resolve(null) }),
              close: () => {
                calls.closed += 1

                return Promise.resolve()
              }
            })
          }
        }),
        resolveExecutablePath: () => undefined
      }
    }

    if (subpath === 'common/headless') return { isHeadless: () => true }

    if (subpath === 'platforms/ajio/common/loginPage') {
      return {
        loginAjioPage: () => {
          calls.logins += 1

          return Promise.resolve({ ok: true })
        }
      }
    }

    if (subpath === 'platforms/ajio/common/sessionStore') {
      return {
        reuseSessionRecord: () => {
          calls.reuseAttempts += 1

          return Promise.resolve(behaviour.reuseResult)
        },
        harvestCookies: () => Promise.resolve([{ name: 'bff_session', value: 'x', domain: '.ajio.com' }])
      }
    }

    if (subpath === 'platforms/ajio/master-import/api-based-flow/apiReportFlow') {
      return {
        getPobIds: () => {
          calls.livePobFetches += 1

          return Promise.resolve({
            pobIds: behaviour.livePobIds,
            stores: behaviour.livePobIds.map(id => ({ id }))
          })
        }
      }
    }

    return {
      getUserId: () => Promise.resolve(behaviour.sellerId)
    }
  }
}))

const { openSignedInAjioPage } = await import(
  '@main/automations/platforms/ajio/common/signedInPage'
)

const reset = (): void => {
  calls.launched = 0
  calls.reuseAttempts = 0
  calls.logins = 0
  calls.published.length = 0
  calls.livePobFetches = 0
  calls.closed = 0
  behaviour.reuseResult = null
  behaviour.stored = { jar: [{ name: 'bff_session' }] }
  behaviour.storedPobIds = [{ id: 'DV001', addedAt: null, lastUsed: null }]
  behaviour.livePobIds = ['LIVE-1']
  behaviour.sellerId = 'seller-1'
  behaviour.allowSignIn = true
}

beforeEach(reset)

const open = () => openSignedInAjioPage({ username: 'info@tigc.in', password: 'pw' })

describe('openSignedInAjioPage', () => {
  it('saves the session after a fresh sign-in', async () => {
    // THE BUG THIS EXISTS FOR. Without the save, the record stays whatever it
    // was, `reuseSessionRecord` keeps rejecting it, and every call signs in
    // again while the operator watches the AJIO login form.
    await open()

    expect(calls.logins).toBe(1)
    expect(calls.published).toEqual([
      {
        username: 'info@tigc.in',
        extras: { userId: 'seller-1', pobIds: ['DV001'], stores: [] }
      }
    ])
  })

  it('does not sign in, or re-save, when the stored session still works', async () => {
    behaviour.reuseResult = { userId: 'seller-1', pobIds: ['DV001'] }

    const opened = await open()

    expect(opened.reused).toBe(true)
    expect(calls.logins).toBe(0)
    // Re-saving a session that was just proved good would replace a working
    // record with a re-harvest of itself, for nothing.
    expect(calls.published).toEqual([])
  })

  it('saves the POBs from settings without asking AJIO for them', async () => {
    behaviour.storedPobIds = [
      { id: 'DV002', addedAt: null, lastUsed: '2026-09-09T10:00:00.000Z' },
      { id: 'DV001', addedAt: null, lastUsed: null }
    ]

    const opened = await open()

    // Monitor's Sync POBs already wrote this list and the app holds a copy;
    // re-fetching it is a paged API sweep to rebuild what is already in memory.
    expect(calls.livePobFetches).toBe(0)
    expect(calls.published[0]?.extras.pobIds).toEqual(['DV002', 'DV001'])
    expect(opened.pobIds).toEqual(['DV002', 'DV001'])
  })

  it('asks AJIO only when the credential has never been synced', async () => {
    behaviour.storedPobIds = []

    await open()

    // A save with no POBs is a record `reuseSessionRecord` will always refuse,
    // so on a never-synced account the sweep is worth its one cost.
    expect(calls.livePobFetches).toBe(1)
    expect(calls.published[0]?.extras.pobIds).toEqual(['LIVE-1'])
  })

  it('still hands back a usable page when the session could not be saved', async () => {
    behaviour.storedPobIds = []
    behaviour.livePobIds = []

    const opened = await open()

    // Best effort: an unsaved session costs the NEXT call a login. Failing this
    // one over it would cost the work in hand.
    expect(calls.published).toEqual([])
    expect(opened.sellerId).toBe('seller-1')
  })

  it('does not sign in when the saved session fails its check — and closes the browser', async () => {
    behaviour.allowSignIn = false

    await expect(open()).rejects.toThrow(/does not sign in/)
    expect(calls.logins).toBe(0)
    expect(calls.closed).toBe(1)
  })

  it('closes the browser it launched if it cannot finish', async () => {
    behaviour.stored = null
    // No seller id: the session is dead in a way the probe did not catch.
    behaviour.sellerId = null

    await expect(open()).rejects.toThrow(/seller id/)
    // Nothing upstream is holding it yet, so leaking it would leak a Chrome.
    expect(calls.closed).toBe(1)
  })
})
