import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Throwing away job history, one kind at a time.
 *
 * WHY PER KIND. The page is filtered — "Ajio bulk claim 13", "Refill Data 2" —
 * and an operator clearing the list in front of them means that list. A single
 * "clear everything" makes somebody destroy the record of runs they still need
 * in order to be rid of the noise from one, and a bulk claim's archive is the
 * only account of what a run did once its window is closed.
 *
 * So the rule worth pinning is NEGATIVE: clearing one kind must leave every
 * other kind alone.
 */

const cleared = vi.hoisted(() => ({ calls: [] as string[] }))

const archive = (name: string, fn: string, reader: string, extra: string[] = []) => {
  const module: Record<string, unknown> = {
    [reader]: () => Promise.resolve([]),
    [fn]: () => {
      cleared.calls.push(name)

      return Promise.resolve(1)
    }
  }

  for (const key of extra) module[key] = vi.fn()

  return module
}

vi.mock('@main/services/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))
vi.mock('@main/services/bulkSpfArchive.store', () =>
  archive('ajio-bulk-claim', 'clearBulkJobArchives', 'readJobArchives', ['initialiseBulkJobArchive'])
)
vi.mock('@main/services/reClaimArchive.store', () =>
  archive('myntra-re-claim', 'clearReClaimJobs', 'readReClaimJobs', ['initialiseReClaimArchive'])
)
vi.mock('@main/services/accountMapArchive.store', () =>
  archive('account-map', 'clearAccountMapJobs', 'readAccountMapJobs')
)
vi.mock('@main/services/refillArchive.store', () =>
  archive('refill-data', 'clearRefillJobs', 'readRefillJobs', ['initialiseRefillArchive'])
)
vi.mock('@main/services/masterBackupArchive.store', () =>
  archive('ajio-master-backup', 'clearBackupJobs', 'readBackupJobs', ['initialiseBackupArchive'])
)
vi.mock('@main/services/scheduledRunArchive.store', () => ({
  ...archive('scheduled-run', 'clearScheduledRuns', 'readScheduledRuns'),
  readScheduledRun: () => Promise.resolve(null)
}))
vi.mock('@main/services/bulkSpfJob.service', () => ({
  listBulkJobs: () => Promise.resolve({ success: false, error: { message: 'offline' } }),
  bulkJobDetail: vi.fn()
}))

const { clearJobs } = await import('@main/services/jobs.service')

beforeEach(() => {
  cleared.calls = []
})

describe('clearJobs', () => {
  it('clears the kind asked for and nothing else', async () => {
    const result = await clearJobs({ kind: 'refill-data' })

    expect(result.success && result.data.cleared).toBe(1)
    expect(cleared.calls).toEqual(['refill-data'])
  })

  it('clears every kind when that is what was asked for', async () => {
    // Starting a machine over is a real thing to want — it just has to be
    // asked for by name rather than being the only option.
    const result = await clearJobs({ kind: 'all' })

    expect(result.success && result.data.cleared).toBe(6)
    expect(cleared.calls.sort()).toEqual([
      'account-map',
      'ajio-bulk-claim',
      'ajio-master-backup',
      'myntra-re-claim',
      'refill-data',
      'scheduled-run'
    ])
  })

  it('refuses a name it does not know, without clearing anything', async () => {
    // A typo or a stale renderer must not fall through to "all" — that is the
    // one mistake here that cannot be undone.
    const result = await clearJobs({ kind: 'everything-please' })

    expect(result.success).toBe(false)
    expect(cleared.calls).toEqual([])
  })

  it('refuses a missing name rather than treating it as all', async () => {
    expect((await clearJobs({})).success).toBe(false)
    expect((await clearJobs({ kind: 42 })).success).toBe(false)
    expect(cleared.calls).toEqual([])
  })
})
