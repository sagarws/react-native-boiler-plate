import { describe, expect, it, vi } from 'vitest'
import { claimAttemptLimit, MAX_CLAIM_ATTEMPTS } from '@shared/constants/claims'

/**
 * The claim retry cap, owned by the core's common/constants.js.
 *
 * "unlimited" lifts it; a whole number sets it; anything else is read as the
 * old cap of 3 rather than as no cap — a typo must not let an unattended run
 * retry a broken claim for ever.
 */

describe('claimAttemptLimit', () => {
  it('reads "unlimited" as no cap, in any case', () => {
    expect(claimAttemptLimit('unlimited')).toBeNull()
    expect(claimAttemptLimit(' Unlimited ')).toBeNull()
  })

  it('reads a positive whole number as the cap', () => {
    expect(claimAttemptLimit(3)).toBe(3)
    expect(claimAttemptLimit(10)).toBe(10)
    expect(claimAttemptLimit('5')).toBe(5)
  })

  it('falls back to 3 for anything else', () => {
    for (const raw of [0, -1, 2.5, Number.NaN, 'unlimted', '', null, undefined, true]) {
      expect(claimAttemptLimit(raw)).toBe(3)
    }
  })

  it('is what the build inlined', () => {
    // vitest.config.ts inlines 3, so the rest of the suite runs with a cap.
    expect(MAX_CLAIM_ATTEMPTS).toBe(3)
  })
})

const listCms = vi.hoisted(() => vi.fn())

vi.mock('@main/services/cmsList.service', () => ({ listCms }))
vi.mock('@main/services/httpClient', () => ({ apiRequest: vi.fn() }))
vi.mock('@main/services/session.store', () => ({ getAccessToken: () => null }))
vi.mock('@main/services/statusSync.store', () => ({
  recentlySynced: vi.fn(),
  statusKey: vi.fn(),
  statusSyncWindowMs: vi.fn()
}))
vi.mock('@main/services/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))

const { fileableClaims, pendingClaims } = await import('@main/services/pendingClaims.service')

const page = (ids: string[]) => ({
  success: true,
  data: { rows: ids.map(id => ({ id })), total: ids.length }
})

describe('fileableClaims', () => {
  it('files Pending only — never Failed to Proceed — across every platform', async () => {
    listCms.mockReset().mockImplementation(({ status }: { status: string }) =>
      Promise.resolve(status === 'Pending' ? page(['p1', 'p2']) : page(['f1']))
    )

    const rows = await fileableClaims()

    expect(rows.map(row => row.id)).toEqual(['p1', 'p2'])
    expect((listCms.mock.calls as [{ status: string }][]).map(([q]) => q.status)).not.toContain(
      'Failed to Proceed'
    )
    for (const [query] of listCms.mock.calls) expect(query).not.toHaveProperty('platform')
  })

  it('leaves Refill Data on Pending alone', async () => {
    listCms.mockReset().mockResolvedValue(page(['p1']))

    await pendingClaims()

    const calls = listCms.mock.calls as [{ status: string }][]

    expect(calls.map(([query]) => query.status)).toEqual(['Pending'])
  })
})
