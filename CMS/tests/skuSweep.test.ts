import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReturnArticle } from '@shared/types/skuLookup'

/**
 * Bulk SKU: read every eligible claim's articles, then let a person confirm.
 *
 * The sweep WRITES NOTHING. That is the property worth pinning above all
 * others: a return with several articles has no automatic right answer, and a
 * sweep that saved as it went would replace SKUs across dozens of claims on the
 * strength of one bad search.
 *
 * What it decides is only what to PRE-SELECT, and the rule has three cases —
 * one article (no decision), a stored SKU that already matches (leave it), and
 * anything else (a person chooses). Plus the flag that makes the whole thing
 * worth running over rows that already have a SKU: one that is on none of the
 * return's articles.
 */

const calls = vi.hoisted(() => ({
  api: [] as { path: string; body: unknown }[],
  opened: [] as string[],
  read: [] as { username: string; awb: string }[],
  closed: [] as string[],
  lock: [] as string[],
  progress: [] as { done: number; total: number; resolved: number; running: boolean }[],
  onProgress: null as
    | ((payload: { done: number; total: number; resolved: number; running: boolean }) => void)
    | null
}))

interface Behaviour {
  claims: {
    cmsId: string
    awbNumber: string
    pobId: string
    username: string
    currentSku: string
  }[]
  /** awb → the articles AJIO answers with, or an Error to throw. */
  articles: Map<string, ReturnArticle[] | Error>
  broken: Set<string>
}

const behaviour = vi.hoisted<Behaviour>(() => ({
  claims: [],
  articles: new Map(),
  broken: new Set()
}))

vi.mock('@main/services/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))
vi.mock('@main/ipc/broadcast', () => ({
  broadcast: (_channel: string, payload: unknown) => {
    const tick = payload as (typeof calls.progress)[number]

    calls.progress.push(tick)
    calls.onProgress?.(tick)
  }
}))
vi.mock('@main/services/session.store', () => ({ getAccessToken: () => 'token' }))
vi.mock('@main/services/automationLock', () => ({
  withAutomationLock: async <T>(name: string, work: () => Promise<T>): Promise<T> => {
    calls.lock.push(name)

    return work()
  }
}))
vi.mock('@main/services/httpClient', () => ({
  apiRequest: (path: string, options: { body?: unknown }) => {
    calls.api.push({ path, body: options.body })

    if (path === '/cms/sku-candidates') {
      return Promise.resolve({
        success: true,
        data: {
          platform: 'ajio',
          limit: 500,
          claims: behaviour.claims.map(claim => ({
            platform: 'Ajio',
            status: 'Pending',
            accountType: 'VMS',
            ...claim
          }))
        }
      })
    }

    return Promise.resolve({ success: true, data: {} })
  }
}))
vi.mock(
  '@main/automations/platforms/ajio/claim-management/api-based-flow/returnArticles',
  () => ({
    openAjioArticleReader: (username: string) => {
      calls.opened.push(username)

      if (behaviour.broken.has(username)) return Promise.reject(new Error('sign-in failed'))

      return Promise.resolve({
        read: (input: { awbNumber: string }) => {
          calls.read.push({ username, awb: input.awbNumber })

          const answer = behaviour.articles.get(input.awbNumber)

          if (answer instanceof Error) return Promise.reject(answer)

          return Promise.resolve({ returnOrderId: 'RT1', orderId: null, articles: answer ?? [] })
        },
        close: () => {
          calls.closed.push(username)

          return Promise.resolve()
        }
      })
    },
    readAjioReturnArticles: vi.fn()
  })
)

const { runSkuSweep, applySkuSelections, skuSweepStatus } = await import(
  '@main/services/skuLookup.service'
)

const reset = (): void => {
  calls.api.length = 0
  calls.opened.length = 0
  calls.read.length = 0
  calls.closed.length = 0
  calls.lock.length = 0
  calls.progress.length = 0
  calls.onProgress = null
  behaviour.claims = []
  behaviour.articles = new Map()
  behaviour.broken = new Set()
}

beforeEach(reset)

/** An article as the core's flattener produces one — only the identifiers matter here. */
const article = (over: Partial<ReturnArticle>): ReturnArticle => ({
  sellerSku: '',
  sterlingSkuId: '',
  itemCode: '',
  eanCode: '',
  scanCode: '',
  productName: '',
  imageUrl: null,
  quantity: null,
  returnItemId: '',
  storable: null,
  ...over
})

const claim = (over: Partial<Behaviour['claims'][number]>): Behaviour['claims'][number] => ({
  cmsId: '1',
  awbNumber: 'AWB-1',
  pobId: 'DV001',
  username: 'a@x.com',
  currentSku: '',
  ...over
})

describe('runSkuSweep', () => {
  it('writes nothing — it produces a review', async () => {
    behaviour.claims = [claim({})]
    behaviour.articles.set('AWB-1', [article({ sellerSku: 'SKU-1' })])

    const result = await runSkuSweep({ platform: 'ajio' })

    expect(result.success && result.data.resolved).toBe(1)
    // The ONLY call is the read. Nothing was stored, because a return with
    // several articles has no automatic right answer and one bad search must
    // not rewrite dozens of claims.
    expect(calls.api.map(entry => entry.path)).toEqual(['/cms/sku-candidates'])
  })

  it('pre-selects the article when a return has only one', async () => {
    behaviour.claims = [claim({})]
    behaviour.articles.set('AWB-1', [article({ sellerSku: 'SKU-1' })])

    const result = await runSkuSweep({ platform: 'ajio' })

    expect(result.success && result.data.rows[0]).toMatchObject({
      suggested: 'SKU-1',
      mismatch: false
    })
  })

  it('leaves the choice open when a return has several and nothing points at one', async () => {
    behaviour.claims = [claim({})]
    behaviour.articles.set('AWB-1', [
      article({ sellerSku: 'SKU-1' }),
      article({ sellerSku: 'SKU-2' })
    ])

    const result = await runSkuSweep({ platform: 'ajio' })

    // Guessing here is exactly how a claim gets filed against the wrong item.
    expect(result.success && result.data.rows[0]?.suggested).toBeNull()
  })

  it('keeps a stored SKU that is already one of the articles', async () => {
    behaviour.claims = [claim({ currentSku: 'SKU-2' })]
    behaviour.articles.set('AWB-1', [
      article({ sellerSku: 'SKU-1' }),
      article({ sellerSku: 'SKU-2' })
    ])

    const result = await runSkuSweep({ platform: 'ajio' })

    // Already right. Re-picking a correct answer only invites someone to change
    // it, and nothing is written when the value equals what the claim says.
    expect(result.success && result.data.rows[0]).toMatchObject({
      suggested: 'SKU-2',
      mismatch: false
    })
  })

  it('flags a stored SKU that is on none of the return’s articles', async () => {
    behaviour.claims = [claim({ currentSku: 'SOMETHING-ELSE' })]
    behaviour.articles.set('AWB-1', [article({ sellerSku: 'SKU-1' })])

    const result = await runSkuSweep({ platform: 'ajio' })

    // The interesting failure, and the reason rows that already have a SKU are
    // swept at all: the claim points at an item that is not on the return.
    expect(result.success && result.data.rows[0]).toMatchObject({
      mismatch: true,
      suggested: 'SKU-1'
    })
  })

  it('matches a stored SKU against every identifier the claim would', async () => {
    // AJIO returns the seller's own SKU on a different field depending on the
    // account. Calling a Sterling id "wrong" because it is not in sellerSkuId
    // would flag half a company's claims as broken.
    behaviour.claims = [claim({ currentSku: '469172786006' })]
    behaviour.articles.set('AWB-1', [
      article({ sterlingSkuId: '469172786006', eanCode: '8907979291632' })
    ])

    const result = await runSkuSweep({ platform: 'ajio' })

    expect(result.success && result.data.rows[0]?.mismatch).toBe(false)
  })

  it('opens each seller account once and closes it at the end', async () => {
    behaviour.claims = [
      claim({ cmsId: '1', awbNumber: 'AWB-1', username: 'a@x.com' }),
      claim({ cmsId: '2', awbNumber: 'AWB-2', username: 'b@x.com' }),
      claim({ cmsId: '3', awbNumber: 'AWB-3', username: 'a@x.com' })
    ]

    for (const awb of ['AWB-1', 'AWB-2', 'AWB-3']) {
      behaviour.articles.set(awb, [article({ sellerSku: `SKU-${awb}` })])
    }

    await runSkuSweep({ platform: 'ajio' })

    // Two sign-ins for three rows, not three — and the interleaved order was
    // regrouped so one account's rows run together.
    expect(calls.opened).toEqual(['a@x.com', 'b@x.com'])
    expect(calls.read.map(entry => entry.awb)).toEqual(['AWB-1', 'AWB-3', 'AWB-2'])
    expect([...calls.closed].sort()).toEqual(['a@x.com', 'b@x.com'])
  })

  it('records a row it could not read and carries on', async () => {
    behaviour.claims = [
      claim({ cmsId: '1', awbNumber: 'AWB-1' }),
      claim({ cmsId: '2', awbNumber: 'AWB-2' })
    ]
    behaviour.articles.set('AWB-1', new Error('No return found for AWB AWB-1 under POB DV001'))
    behaviour.articles.set('AWB-2', [article({ sellerSku: 'SKU-2' })])

    const result = await runSkuSweep({ platform: 'ajio' })

    if (!result.success) throw new Error('expected the sweep to finish')

    expect(result.data).toMatchObject({ resolved: 1, failed: 1 })
    expect(result.data.rows[0]?.error).toContain('No return found')
    // One unreadable return must not end the sweep — the rest of the batch is
    // the work.
    expect(result.data.rows[1]?.suggested).toBe('SKU-2')
  })

  it('has the review stored before it announces the run is over', async () => {
    behaviour.claims = [claim({})]
    behaviour.articles.set('AWB-1', [article({ sellerSku: 'SKU-1' })])

    // The window learns the sweep finished from the terminal tick and answers
    // it by asking for the review. Publishing first would answer that question
    // with the PREVIOUS run's rows, or with none — which is exactly what left a
    // finished sweep showing its totals, no table, and a dead Save button.
    let atTerminalTick: number | null = null

    calls.onProgress = payload => {
      if (payload.running) return
      const status = skuSweepStatus()

      atTerminalTick = status.success ? (status.data.result?.rows.length ?? 0) : 0
    }

    await runSkuSweep({ platform: 'ajio' })

    expect(atTerminalTick).toBe(1)
  })

  it('announces the AWB it is about to read, then ends the run', async () => {
    behaviour.claims = [claim({})]
    behaviour.articles.set('AWB-1', [article({ sellerSku: 'SKU-1' })])

    await runSkuSweep({ platform: 'ajio' })

    expect(calls.progress[0]).toMatchObject({ done: 0, total: 1, running: true })
    expect(calls.progress.at(-1)).toMatchObject({ done: 1, resolved: 1, running: false })
  })

  it('holds the automation lock for the whole sweep', async () => {
    behaviour.claims = [claim({})]
    behaviour.articles.set('AWB-1', [article({ sellerSku: 'SKU-1' })])

    await runSkuSweep({ platform: 'ajio' })

    expect(calls.lock).toEqual(['sku-sweep'])
  })

  it('refuses every platform but AJIO', async () => {
    const result = await runSkuSweep({ platform: 'meesho' })

    expect(result.success).toBe(false)
    // Refused before the round trip: only AJIO has an endpoint that answers
    // what a return AWB holds.
    expect(calls.api).toEqual([])
  })
})

describe('applySkuSelections', () => {
  it('saves each confirmed SKU and reports what did not stick', async () => {
    const result = await applySkuSelections({
      selections: [
        { cmsId: '1', awbNumber: 'AWB-1', sellerSku: 'SKU-1' },
        // Skipped: nothing to store.
        { cmsId: '2', awbNumber: 'AWB-2', sellerSku: '' },
        { cmsId: '3', awbNumber: 'AWB-3', sellerSku: 'SKU-3' }
      ]
    })

    expect(result.success && result.data.saved).toBe(2)
    expect(calls.api.map(entry => entry.body)).toEqual([
      { cmsId: '1', sellerSku: 'SKU-1' },
      { cmsId: '3', sellerSku: 'SKU-3' }
    ])
  })
})
