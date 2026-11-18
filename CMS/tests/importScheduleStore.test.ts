import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as Store from '@main/services/importScheduleStore'

/**
 * The schedule record decides whether a run is owed, so two of its guarantees
 * are load-bearing:
 *
 *   - a write MERGES. `failedAttempts` is written on its own after a failure,
 *     and if that replaced the record it would wipe `baselineAt` — which
 *     `isRunDue` needs, and whose loss would make a fresh install fire
 *     immediately.
 *   - the failure counter survives a restart, or the scheduler would retry
 *     forever across restarts rather than giving up at the cap.
 */

let directory: string

vi.mock('@main/database', () => ({ dataDirectory: () => directory }))

const load = async (): Promise<typeof Store> => {
  vi.resetModules()

  const module = await import('@main/services/importScheduleStore')

  module.initialiseImportScheduleStore()

  return module
}

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'trackvid-schedule-test-'))
})

afterEach(async () => {
  await rm(directory, { recursive: true, force: true })
})

describe('import schedule record', () => {
  it('merges a write rather than replacing the record', async () => {
    const store = await load()

    await store.writeScheduleRecord({ baselineAt: 1000, lastRunAt: 2000 })
    await store.writeScheduleRecord({ failedAttempts: 2 })

    const record = await store.readScheduleRecord()

    // The baseline must survive a failure-count write: isRunDue needs it, and
    // losing it makes the next tick think a run is owed immediately.
    expect(record.baselineAt).toBe(1000)
    expect(record.lastRunAt).toBe(2000)
    expect(record.failedAttempts).toBe(2)
  })

  it('keeps the failure count across a restart', async () => {
    const first = await load()

    await first.writeScheduleRecord({ baselineAt: 1000, failedAttempts: 2 })

    // A fresh process reading the same directory.
    const second = await load()
    const record = await second.readScheduleRecord()

    expect(record.failedAttempts).toBe(2)
  })

  it('tracks each platform independently', async () => {
    const store = await load()

    // ajio ran at 02:00; myntra is scheduled for 06:00 and has not.
    await store.writeScheduleRecord({ baselineAt: 1000 })
    await store.writeScheduleRecord({ platforms: { ajio: { lastRunAt: 2000, failedAttempts: 0 } } })
    await store.writeScheduleRecord({
      platforms: { ajio: { lastRunAt: 2000, failedAttempts: 0 }, meesho: { failedAttempts: 2 } }
    })

    const record = await store.readScheduleRecord()

    // Recording ajio must not tell the scheduler myntra has run — with one
    // shared lastRunAt it would, and myntra would be skipped until tomorrow.
    expect(record.platforms?.ajio?.lastRunAt).toBe(2000)
    expect(record.platforms?.myntra).toBeUndefined()
    expect(record.platforms?.meesho?.failedAttempts).toBe(2)
    expect(record.baselineAt).toBe(1000)
  })

  it('clears the failure count when a run is recorded', async () => {
    const store = await load()

    await store.writeScheduleRecord({ baselineAt: 1000, failedAttempts: 2 })
    // What recordRun() writes.
    await store.writeScheduleRecord({ lastRunAt: 5000, failedAttempts: 0 })

    const record = await store.readScheduleRecord()

    expect(record.failedAttempts).toBe(0)
    expect(record.lastRunAt).toBe(5000)
  })
})
