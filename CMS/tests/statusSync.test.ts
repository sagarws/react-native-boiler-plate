import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Asking a marketplace about the same claim once every few days, not nightly.
 *
 * WHAT IS AT STAKE. The status pass swept 580 claims on Myntra and 821 on
 * Nykaa every run to learn that almost none had changed. Skipping work is
 * cheap to get wrong in one direction and expensive in the other: a row
 * wrongly asked costs one request, a row wrongly SKIPPED costs a status change
 * nobody ever sees. Every test here pins that asymmetry.
 */

const DAY = 24 * 60 * 60 * 1000

const store = vi.hoisted(() => ({ records: [] as { key: string; syncedAt: string }[] }))

vi.mock('@main/services/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))
vi.mock('@main/database', () => ({ dataDirectory: () => '/tmp' }))
vi.mock('@main/automations/common/coreLoader', () => ({
  loadCore: () => ({ CLAIM_STATUS_SYNC_DAYS: 4 })
}))
vi.mock('@main/database/jsonStore', () => ({
  JsonCollection: class {
    read(): Promise<{ key: string; syncedAt: string }[]> {
      return Promise.resolve(store.records)
    }

    mutate<R>(mutate: (records: { key: string; syncedAt: string }[]) => {
      records: { key: string; syncedAt: string }[]
      result: R
    }): Promise<R> {
      const next = mutate(store.records)

      store.records = next.records

      return Promise.resolve(next.result)
    }

    clear(): Promise<void> {
      store.records = []

      return Promise.resolve()
    }
  }
}))

const { initialiseStatusSync, recentlySynced, rememberStatusSynced, forgetStatusSync, statusKey } =
  await import('@main/services/statusSync.store')

const NOW = Date.parse('2026-10-02T12:00:00.000Z')

beforeEach(() => {
  store.records = []
  initialiseStatusSync()
})

describe('leaving recently answered claims alone', () => {
  it('skips a claim answered inside the window', async () => {
    await rememberStatusSynced([{ awb: 'AWB-1' }], NOW - 2 * DAY)

    expect([...(await recentlySynced(NOW))]).toEqual(['AWB-1'])
  })

  it('asks again once the window has passed', async () => {
    await rememberStatusSynced([{ awb: 'AWB-1' }], NOW - 5 * DAY)

    expect((await recentlySynced(NOW)).size).toBe(0)
  })

  it('asks about a claim it has never heard of', async () => {
    // Every row written before this store existed is in this state. Treating
    // unknown as "done" would freeze the whole back catalogue, unasked.
    expect((await recentlySynced(NOW)).has('AWB-NEVER-SEEN')).toBe(false)
  })

  it('asks again when the stored date cannot be read', async () => {
    store.records = [{ key: 'AWB-1', syncedAt: 'not a date' }]

    // Asking costs one request; not asking costs a status change nobody sees.
    expect((await recentlySynced(NOW)).size).toBe(0)
  })
})

describe('recording what was answered', () => {
  it('keeps the newest answer when a claim is asked again', async () => {
    await rememberStatusSynced([{ awb: 'AWB-1' }], NOW - 5 * DAY)
    await rememberStatusSynced([{ awb: 'AWB-1' }], NOW)

    expect(store.records).toHaveLength(1)
    expect([...(await recentlySynced(NOW))]).toEqual(['AWB-1'])
  })

  it('upserts by AWB and keeps every other record', async () => {
    // One row per AWB, so `status-record` reads as "last checked" for each.
    store.records = [{ key: 'OLD-1', syncedAt: new Date(NOW - 30 * DAY).toISOString() }]

    await rememberStatusSynced([{ awb: ' awb-1 ', cmsId: 'c1', platform: 'ajio' }], NOW)
    await rememberStatusSynced([{ awb: 'AWB-1' }], NOW)

    expect(store.records.map(record => record.key).sort()).toEqual(['AWB-1', 'OLD-1'])
    // A later stamp without the claim id keeps the one already held.
    expect(store.records.find(record => record.key === 'AWB-1')).toMatchObject({
      awb: 'AWB-1',
      cmsId: 'c1',
      platform: 'ajio'
    })
  })

  it('matches an AWB whatever its case or padding', async () => {
    await rememberStatusSynced([{ awb: 'sdlr123 ' }], NOW)

    expect((await recentlySynced(NOW)).has(statusKey(' SDLR123'))).toBe(true)
  })

  it('writes nothing when nothing was answered', async () => {
    await rememberStatusSynced([], NOW)

    expect(store.records).toEqual([])
  })

  it('asks about everything again once cleared', async () => {
    await rememberStatusSynced([{ awb: 'AWB-1' }], NOW)
    await forgetStatusSync()

    expect((await recentlySynced(NOW)).size).toBe(0)
  })
})

/**
 * THE FORCE-CLOSE CASE, which is the whole reason the stamp is written row by
 * row rather than once at the end of a platform.
 *
 * A sweep of 580 claims takes most of an hour. Writing at the end meant an app
 * closed at row 32 lost all 32 Ã¢â‚¬â€ and a machine restarted often enough would
 * never get past the front of the list, re-asking the same opening rows every
 * night for ever.
 */
describe('surviving an app that is closed mid-sweep', () => {
  it('keeps the rows answered before the close, and only those', async () => {
    // 32 of 580 answered, then the lights go out.
    for (let index = 0; index < 32; index += 1) {
      await rememberStatusSynced([{ awb: `AWB-${index}` }], NOW)
    }

    const fresh = await recentlySynced(NOW)

    expect(fresh.size).toBe(32)
    expect(fresh.has('AWB-31')).toBe(true)
    // Row 32 was never answered, so the next run starts exactly there.
    expect(fresh.has('AWB-32')).toBe(false)
  })

  it('does not re-stamp a row on the next run, so the window is measured from the real answer', async () => {
    await rememberStatusSynced([{ awb: 'AWB-1' }], NOW - 3 * DAY)

    // The next run leaves it alone rather than asking and re-stamping, which
    // would let a nightly sweep keep a row permanently "fresh" and never
    // actually check it again.
    expect((await recentlySynced(NOW)).has('AWB-1')).toBe(true)
    expect((await recentlySynced(NOW + 2 * DAY)).has('AWB-1')).toBe(false)
  })
})
