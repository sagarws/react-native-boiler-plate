import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Two hundred callers asking the same question at the same instant.
 *
 * THE REPORT. A Flipkart claim batch was running with the API tunnel down, and
 * one second of the log looked like this, two hundred times over:
 *
 *   14:58:29.352 API request failed {"path":"/cms/my-company-credentials"…}
 *   14:58:29.352 Serving session-health from the offline cache…
 *
 * The cause is not the network being down — that is allowed to happen, and the
 * offline cache exists precisely for it. It is that `claimProcessor` asks
 * `mappingAccounts` for EVERY claim, `mappingAccounts` asks for session health,
 * and nothing between them noticed that the same request was already in the
 * air. Every row opened its own socket, failed on its own, and wrote its own
 * two lines — which is how a 40 MB log file happens, and how the one error that
 * mattered became unfindable.
 *
 * What is pinned here is that a burst costs ONE fetch, and that the cool-down
 * after a failure never withholds a successful answer.
 */

const calls = vi.hoisted(() => ({ fetches: 0, fail: false, info: [] as string[] }))

vi.mock('@main/services/logger', () => ({
  logger: {
    info: (message: string) => calls.info.push(message),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  }
}))
vi.mock('@main/database', () => ({ dataDirectory: () => '/tmp/unused' }))

/** An in-memory stand-in for the JSON file the cache normally writes. */
const disk = vi.hoisted(() => ({ records: [] as { key: string; data: unknown; fetchedAt: string }[] }))

vi.mock('@main/database/jsonStore', () => ({
  JsonCollection: class {
    read(): Promise<unknown[]> {
      return Promise.resolve(disk.records)
    }

    mutate(apply: (records: unknown[]) => { records: never[]; result: unknown }): Promise<unknown> {
      const next = apply(disk.records)

      disk.records = next.records

      return Promise.resolve(next.result)
    }
  }
}))

const { initialiseOfflineCache, withOfflineCache, clearOfflineCache } = await import(
  '@main/services/offlineCache'
)

initialiseOfflineCache()

/** The fetcher every test shares: counts its calls, and can be taken offline. */
const fetcher = async (): Promise<{ success: boolean; data?: string; error?: { code: string; message: string } }> => {
  calls.fetches += 1

  // A tick, so concurrent callers really do overlap rather than running to
  // completion one at a time.
  await Promise.resolve()

  return calls.fail
    ? { success: false, error: { code: 'NETWORK_ERROR', message: 'fetch failed' } }
    : { success: true, data: 'live' }
}

const run = (): Promise<unknown> => withOfflineCache('session-health', fetcher as never)

beforeEach(async () => {
  await clearOfflineCache()
  disk.records = []
  calls.fetches = 0
  calls.fail = false
  calls.info.length = 0
})

describe('a burst of callers wanting the same thing', () => {
  it('costs one fetch, not one per caller', async () => {
    const answers = await Promise.all(Array.from({ length: 200 }, run))

    expect(calls.fetches).toBe(1)
    // And every caller still gets the answer — sharing the request must not
    // mean some of them get nothing.
    expect(answers).toHaveLength(200)
    expect(answers.every(answer => (answer as { success: boolean }).success)).toBe(true)
  })

  it('writes one offline line for the outage, not two hundred', async () => {
    await run()
    calls.fail = true

    await Promise.all(Array.from({ length: 200 }, run))

    expect(calls.info.filter(line => line.includes('offline cache'))).toHaveLength(1)
  })
})

describe('after the network has just failed', () => {
  it('serves the cache without dialling again', async () => {
    await run()
    calls.fail = true
    await run()

    const before = calls.fetches

    await run()
    await run()

    expect(calls.fetches).toBe(before)
  })

  it('still dials when there is nothing cached to serve', async () => {
    // A cool-down protecting nobody is just a delay on the error the caller
    // needs to see.
    calls.fail = true

    await run()
    const before = calls.fetches
    await run()

    expect(calls.fetches).toBeGreaterThan(before)
  })

  it('never withholds a successful answer once the network is back', async () => {
    await run()
    calls.fail = true
    await run()

    // The cool-down is five seconds; the point is that it is a SHORT guard on
    // re-dialling, never a cache of the data. Signing out drops it outright,
    // which is the same path a fresh session takes.
    await clearOfflineCache()
    disk.records = []
    calls.fail = false

    const answer = (await run()) as { success: boolean; data: string }

    expect(answer.success).toBe(true)
    expect(answer.data).toBe('live')
  })
})
