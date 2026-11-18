import { createRequire } from 'node:module'
import { describe, expect, it, vi } from 'vitest'

/**
 * Which marketplace login a claim's AWB belongs to.
 *
 * A row from a scan or a feed carries an AWB and nothing else, and only the
 * marketplace can say whose it is. So the engine asks each account in turn
 * until one answers yes — and the three things it must get right are all about
 * what happens when they DON'T:
 *
 *   1. A broken account must not silence the ones behind it. If the first
 *      credential's session is dead and the AWB belongs to the third, stopping
 *      at the error loses the answer.
 *   2. "Nobody owns this" and "nobody could be asked" must not read alike. The
 *      first is a master-data problem, the second is a session problem, and
 *      they are fixed in opposite places.
 *   3. The sweep has to get cheaper as it goes, or it never finishes: AJIO is
 *      one request per place of business per claim, and a company can hold
 *      sixty POBs.
 *
 * Shared with Automated-Scripts, so a change made for one runner is pinned for
 * both.
 */

const require_ = createRequire(import.meta.url)

interface Answer {
  found: boolean
  scope?: { pobId?: string } | null
  details?: Record<string, unknown> | null
}

interface Account {
  username: string
}

interface Engine {
  mapAwbToAccount: (input: {
    awb: string
    accounts: Account[]
    probe: (account: Account, awb: string) => Promise<Answer>
    keyOf?: (account: Account) => string
    recent?: unknown
    logger?: unknown
  }) => Promise<{
    matched: Account | null
    key: string | null
    scope: { pobId?: string } | null
    details: Record<string, unknown> | null
    attempts: { key: string; found: boolean; error: string | null }[]
    errors: { key: string; error: string }[]
  }>
  describeMiss: (awb: string, result: { attempts: unknown[]; errors: { key: string }[] }) => string
  accountMappingFor: (platform: string) => { flow: string; scope: string | null; accountField: string } | null
  MAPPABLE_PLATFORMS: string[]
  RecentFirst: new () => { order: <T>(items: T[], keyOf: (item: T) => string) => T[]; remember: (key: string) => void }
}

const engine = (): Engine => require_('@trackvid/automation-core/common/accountMapping') as Engine

const accounts = (...names: string[]): Account[] => names.map(username => ({ username }))
const keyOf = (account: Account): string => account.username

describe('mapAwbToAccount', () => {
  it('stops at the first account that owns the AWB', async () => {
    const { mapAwbToAccount } = engine()
    const asked: string[] = []

    const result = await mapAwbToAccount({
      awb: 'AWB-1',
      accounts: accounts('a@x.com', 'b@x.com', 'c@x.com'),
      keyOf,
      probe: account => {
        asked.push(account.username)

        return Promise.resolve({ found: account.username === 'b@x.com' })
      }
    })

    expect(result.key).toBe('b@x.com')
    // c was never asked: every question costs a marketplace round trip, and on
    // AJIO one per place of business.
    expect(asked).toEqual(['a@x.com', 'b@x.com'])
  })

  it('carries the scope and details a hit resolved', async () => {
    const { mapAwbToAccount } = engine()

    const result = await mapAwbToAccount({
      awb: 'AWB-1',
      accounts: accounts('a@x.com'),
      keyOf,
      probe: () =>
        Promise.resolve({
          found: true,
          scope: { pobId: 'DV00332648' },
          details: { subOrderNumber: '326241959666635776_1' }
        })
    })

    // Both matter to the write: AJIO's claim aborts without a POB, and Meesho's
    // form is filled by the sub-order number. An account alone would leave the
    // row as unfileable as it was found.
    expect(result.scope).toEqual({ pobId: 'DV00332648' })
    expect(result.details).toEqual({ subOrderNumber: '326241959666635776_1' })
  })

  it('keeps asking after an account that could not be reached', async () => {
    const { mapAwbToAccount } = engine()

    const result = await mapAwbToAccount({
      awb: 'AWB-1',
      accounts: accounts('dead@x.com', 'live@x.com'),
      keyOf,
      probe: account =>
        account.username === 'dead@x.com'
          ? Promise.reject(new Error('session expired'))
          : Promise.resolve({ found: true })
    })

    // The whole point: one dead session must not hide the account that owns it.
    expect(result.key).toBe('live@x.com')
    expect(result.errors).toEqual([{ key: 'dead@x.com', error: 'session expired' }])
  })

  it('reports no match without claiming the accounts all answered', async () => {
    const { mapAwbToAccount, describeMiss } = engine()

    const result = await mapAwbToAccount({
      awb: 'AWB-9',
      accounts: accounts('a@x.com', 'b@x.com'),
      keyOf,
      probe: account =>
        account.username === 'b@x.com'
          ? Promise.reject(new Error('HTTP 401'))
          : Promise.resolve({ found: false })
    })

    expect(result.matched).toBeNull()

    // "Not found on any account" would send someone to re-import master data.
    // Half the accounts never answered, and the fix is their sessions.
    const said = describeMiss('AWB-9', result)

    expect(said).toContain('1 could not be reached')
    expect(said).toContain('b@x.com')
  })

  it('says plainly when every account genuinely answered no', async () => {
    const { mapAwbToAccount, describeMiss } = engine()

    const result = await mapAwbToAccount({
      awb: 'AWB-9',
      accounts: accounts('a@x.com', 'b@x.com'),
      keyOf,
      probe: () => Promise.resolve({ found: false })
    })

    expect(describeMiss('AWB-9', result)).toBe(
      'AWB-9 was not found on any of the 2 account(s) checked'
    )
  })

  it('never throws, whatever the probes do', async () => {
    const { mapAwbToAccount } = engine()

    await expect(
      mapAwbToAccount({
        awb: 'AWB-1',
        accounts: accounts('a@x.com', 'b@x.com'),
        keyOf,
        probe: () => Promise.reject(new Error('boom'))
      })
    ).resolves.toMatchObject({ matched: null })
  })
})

describe('RecentFirst', () => {
  it('leaves the given order alone until something has answered', () => {
    const { RecentFirst } = engine()
    const recent = new RecentFirst()

    expect(recent.order(['a', 'b', 'c'], id => id)).toEqual(['a', 'b', 'c'])
  })

  it('puts the last thing that answered first', () => {
    const { RecentFirst } = engine()
    const recent = new RecentFirst()

    recent.remember('c')

    expect(recent.order(['a', 'b', 'c'], id => id)).toEqual(['c', 'a', 'b'])
  })

  it('collapses the sweep across a batch of claims', async () => {
    const { mapAwbToAccount, RecentFirst } = engine()
    const recent = new RecentFirst()
    const asked: string[] = []
    const owner = 'c@x.com'

    const probe = (account: Account): Promise<Answer> => {
      asked.push(account.username)

      return Promise.resolve({ found: account.username === owner })
    }

    // Claims arrive in batches from one seller, which is the assumption this
    // rests on and the reason it is worth having.
    for (const awb of ['AWB-1', 'AWB-2', 'AWB-3']) {
      await mapAwbToAccount({
        awb,
        accounts: accounts('a@x.com', 'b@x.com', owner),
        keyOf,
        recent,
        probe
      })
    }

    // Three the first time, then one each. Without this the same batch is nine.
    expect(asked).toEqual(['a@x.com', 'b@x.com', owner, owner, owner])
  })

  it('re-orders without dropping or duplicating anything', () => {
    const { RecentFirst } = engine()
    const recent = new RecentFirst()

    recent.remember('b')
    recent.remember('b')
    recent.remember('e')

    const ordered = recent.order(['a', 'b', 'c', 'd'], id => id)

    expect([...ordered].sort()).toEqual(['a', 'b', 'c', 'd'])
    expect(ordered[0]).toBe('b')
  })
})

describe('the platform registry', () => {
  it('knows AJIO resolves a place of business as well as an account', () => {
    const { accountMappingFor } = engine()

    // AJIO's claim aborts without `configEntry.pobid`, so an account alone is
    // half an answer — the probe returns both and the write stores both.
    expect(accountMappingFor('Ajio')).toMatchObject({ scope: 'pob', accountField: 'ajio_account_email' })
    expect(accountMappingFor('meesho')?.scope).toBeNull()
  })

  it('drives every platform but Meesho over HTTP, always', () => {
    const { accountMappingFor, MAPPABLE_PLATFORMS } = engine()
    const others = MAPPABLE_PLATFORMS.filter(key => key !== 'meesho')

    expect(others.map(key => accountMappingFor(key)?.flow)).toEqual(others.map(() => 'api'))
  })

  it('lets Meesho be switched between its two flows without a restart', () => {
    const { accountMappingFor } = engine()
    const constants = require_('@trackvid/automation-core/common/constants') as {
      MEESHO_API_BASE_ACCOUNT_MAPPING: boolean
    }
    const original = constants.MEESHO_API_BASE_ACCOUNT_MAPPING

    try {
      // Meesho is the one platform with two ways to be asked, and which one is
      // a FLAG rather than a fact: `fetchReturnClaims` takes a free-text query
      // where every other Meesho endpoint wants a sub-order number, so it can
      // answer for an unmapped row — but the Returns screen always works.
      constants.MEESHO_API_BASE_ACCOUNT_MAPPING = true
      expect(accountMappingFor('meesho')?.flow).toBe('api')

      // Read on each access, so turning it off takes effect where it is read
      // rather than at the next restart.
      constants.MEESHO_API_BASE_ACCOUNT_MAPPING = false
      expect(accountMappingFor('meesho')?.flow).toBe('script')
    } finally {
      constants.MEESHO_API_BASE_ACCOUNT_MAPPING = original
    }
  })

  it('refuses the platform that has no per-claim account', () => {
    const { accountMappingFor } = engine()

    expect(accountMappingFor('nykaa')).toBeNull()
    expect(accountMappingFor('')).toBeNull()
  })

  it('resolves Tata CliQ however it is spelled', () => {
    const { accountMappingFor } = engine()

    // This asserted `null` for 'tata cliq' while Tata CliQ had no probe. Now
    // it has one, and the spelling is the point: the desktop passes the tab
    // label, TrackVid stores either form, and the registry keys a third.
    for (const spelling of ['tatacliq', 'tata cliq', 'Tata CliQ']) {
      expect(accountMappingFor(spelling)?.scope).toBe('slave')
    }
  })

  it('takes its account fields from the one map the runners already share', () => {
    const { accountMappingFor } = engine()
    const { ACCOUNT_FIELDS } = require_('@trackvid/automation-core/common/claimAccount') as {
      ACCOUNT_FIELDS: Record<string, string[]>
    }

    // Not a second copy: a mapping written to a field no runner reads would
    // leave the row looking mapped and still be unfileable.
    for (const platform of ['ajio', 'meesho', 'flipkart', 'xbees']) {
      expect(accountMappingFor(platform)?.accountField).toBe(ACCOUNT_FIELDS[platform]?.[0])
    }
  })
})

describe('the Meesho returns probe', () => {
  it('searches the URL that pressing Enter in the box produces', () => {
    const { searchUrl } = require_(
      '@trackvid/automation-core/platforms/meesho/account-mapping/script-based-flow/probeAwb'
    ) as { searchUrl: (awb: string) => string }

    // The deep link is tried before the keystrokes — one navigation instead of
    // a navigation plus a race with the grid.
    expect(searchUrl(' VL0085289175482 ')).toBe(
      'https://supplier.meesho.com/panel/v3/new/fulfillment/pcbev/returns/search-returns?q=VL0085289175482'
    )
  })
})

describe('the Xbees count probe', () => {
  const load = (): { probeXbeesAwb: (ctx: unknown, awb: string) => Promise<Answer> } => {
    delete require_.cache[
      require_.resolve('@trackvid/automation-core/platforms/xbees/account-mapping/api-based-flow/probeAwb')
    ]

    return require_(
      '@trackvid/automation-core/platforms/xbees/account-mapping/api-based-flow/probeAwb'
    ) as { probeXbeesAwb: (ctx: unknown, awb: string) => Promise<Answer> }
  }

  const withPost = async (body: unknown, run: (probe: ReturnType<typeof load>) => Promise<void>) => {
    const flowPath = require_.resolve(
      '@trackvid/automation-core/platforms/xbees/claim-management/api-based-flow/claimApiFlow'
    )
    const flow = require_(flowPath) as { xbeesPost: unknown }
    const original = flow.xbeesPost

    flow.xbeesPost = vi.fn().mockResolvedValue(body)

    try {
      await run(load())
    } finally {
      flow.xbeesPost = original
    }
  }

  it('reads the count off the envelope Xbees actually returns', async () => {
    // Verified response: the payload is `ReturnCount` at the top level, NOT
    // inside `ReturnResult` like every other call on that host — so xbeesPost
    // hands the envelope back whole.
    await withPost(
      {
        ReturnCode: 100,
        ReturnMessage: 'Success',
        ReturnCount: { Total: 1, Open: 1, Closed: 0, Draft: 0, Accepted: 0, Rejected: 0 }
      },
      async probe => {
        const answer = await probe.probeXbeesAwb({}, '24186920279829')

        expect(answer.found).toBe(true)
        expect(answer.details).toEqual({
          counts: { Total: 1, Open: 1, Closed: 0, Draft: 0, Accepted: 0, Rejected: 0 }
        })
      }
    )
  })

  it('treats a zero total as another account’s shipment', async () => {
    await withPost({ ReturnCode: 100, ReturnCount: { Total: 0, Open: 0 } }, async probe => {
      expect((await probe.probeXbeesAwb({}, '24186920279829')).found).toBe(false)
    })
  })

  it('does not read an envelope it cannot recognise as a yes', async () => {
    // A shape change at Xbees must read as "no", never as a confident hit that
    // would write the wrong seller onto the row.
    await withPost({ ReturnCode: 100, Something: 'else' }, async probe => {
      const answer = await probe.probeXbeesAwb({}, '24186920279829')

      expect(answer.found).toBe(false)
      expect(answer.details).toBeNull()
    })
  })
})

/**
 * The two "search by AWB" endpoints, and the shapes they answer in.
 *
 * Meesho and Snapdeal answer the same question for the same run, and share not
 * one field name — so the captured contract lives in one file. These pin it
 * against the real responses, because the next change to that file will be
 * because a field moved, and a shape nobody checks is one that drifts.
 */
describe('awbGlobleSearch', () => {
  const search = require_('@trackvid/automation-core/common/awbGlobleSearch') as {
    findSearchRow: (
      platform: string,
      body: unknown,
      query: string
    ) => Record<string, unknown> | null
    searchRows: (platform: string, body: unknown) => unknown[]
    SEARCHABLE_PLATFORMS: string[]
  }

  // Verbatim from the captures, trimmed to the fields that are read.
  const MEESHO_BODY = {
    total_pages: 1,
    data: [
      {
        order_num: '326241959666635776',
        sub_order_num: '326241959666635776_1',
        type: 'RTO',
        shipment_status: 'In Transit',
        carrier_name: 'Valmo',
        awb: 'VL0085289175482',
        product: { name: 'dola silk handloom …', sku: 'subhi5667fanta', quantity: 1 }
      }
    ]
  }

  const SNAPDEAL_BODY = {
    returnType: {
      delivered: ['Courier_Return'],
      returnsList: [
        {
          name: 'VT NX Women Viscose Solid Straight Kurti With Pants ( Lemon Yellow )',
          supc: 'SDL797402349',
          sku: '9034-Lemon-XL',
          subOrderId: '74234371173',
          awbNumber: 'SF3919427089SDM',
          statusOfItem: 'DELIVERED',
          courier: 'Shadowfax',
          sdReferenceNumber: 'SLP5101875478'
        }
      ]
    }
  }

  it('reads Meesho’s sub-order number off its own row', () => {
    expect(search.findSearchRow('meesho', MEESHO_BODY, 'VL0085289175482')).toMatchObject({
      subOrderNumber: '326241959666635776_1',
      orderNumber: '326241959666635776',
      sellerSku: 'subhi5667fanta',
      carrier: 'Valmo'
    })
  })

  it('reads Snapdeal’s sub-order id, which it spells differently', () => {
    // `subOrderId` there, `sub_order_num` on Meesho — the same fact under two
    // names, which is the reason this file exists.
    expect(search.findSearchRow('snapdeal', SNAPDEAL_BODY, 'SF3919427089SDM')).toMatchObject({
      subOrderNumber: '74234371173',
      sellerSku: '9034-Lemon-XL',
      status: 'DELIVERED',
      reference: 'SLP5101875478'
    })
  })

  it('finds Snapdeal’s rows two levels down, under `returnsList`', () => {
    // The spelling and the depth have both been got wrong before; a wrong path
    // reads as "this seller has no such return".
    expect(search.searchRows('snapdeal', SNAPDEAL_BODY)).toHaveLength(1)
    expect(search.searchRows('snapdeal', { returnsList: [{}] })).toHaveLength(1)
    expect(search.searchRows('snapdeal', {})).toEqual([])
  })

  it('matches Meesho on any of the three identifiers it searches', () => {
    // `text_global` is free text: an operator scanning a packet can end up with
    // the AWB, the sub-order or the order number in that column.
    for (const query of ['VL0085289175482', '326241959666635776_1', '326241959666635776']) {
      expect(search.findSearchRow('meesho', MEESHO_BODY, query)).not.toBeNull()
    }
  })

  it('matches Snapdeal on the AWB only', () => {
    // Its search is TYPED (`searchType=AWBNUMBER`), so nothing else can have
    // been the query — matching on more would accept a row for a reason the
    // request never asked about.
    expect(search.findSearchRow('snapdeal', SNAPDEAL_BODY, '74234371173')).toBeNull()
    expect(search.findSearchRow('snapdeal', SNAPDEAL_BODY, 'SF3919427089SDM')).not.toBeNull()
  })

  it('refuses a neighbour either search happened to return', () => {
    // Never row[0]: these are searches, and taking the first would map a claim
    // against whichever sorted first.
    expect(search.findSearchRow('meesho', MEESHO_BODY, 'VL9999999999999')).toBeNull()
    expect(search.findSearchRow('snapdeal', SNAPDEAL_BODY, 'SF0000000000SDM')).toBeNull()
  })

  it('ignores case and surrounding space', () => {
    expect(search.findSearchRow('meesho', MEESHO_BODY, ' vl0085289175482 ')).not.toBeNull()
    expect(search.findSearchRow('snapdeal', SNAPDEAL_BODY, ' sf3919427089sdm ')).not.toBeNull()
  })

  it('never matches on a blank', () => {
    expect(search.findSearchRow('meesho', { data: [{ awb: '' }] }, '')).toBeNull()
    expect(
      search.findSearchRow('snapdeal', { returnType: { returnsList: [{ awbNumber: '' }] } }, '')
    ).toBeNull()
  })

  it('answers nothing for a platform with no AWB search', () => {
    expect(search.SEARCHABLE_PLATFORMS.sort()).toEqual(['meesho', 'snapdeal'])
    expect(search.findSearchRow('ajio', MEESHO_BODY, 'x')).toBeNull()
    expect(search.searchRows('flipkart', MEESHO_BODY)).toEqual([])
  })
})
