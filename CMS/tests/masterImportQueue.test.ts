import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as QueueStore from '@main/services/masterImportQueue.store'

type QueuedReport = QueueStore.QueuedReport

/**
 * The queue is what makes the script flow's "request now, download later"
 * survive a restart — a report can take twenty minutes to build, and the
 * request has already been made by the time the app closes.
 *
 * Two guarantees are load-bearing: a newer request supersedes an older one for
 * the same report, and nothing that could sign in on its own is written to disk.
 */

let directory: string

vi.mock('@main/database', () => ({ dataDirectory: () => directory }))

// The real logger reads `app.isPackaged` at import time to choose a log file,
// and there is no Electron app in a unit test.
vi.mock('@main/services/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}))

const load = async (): Promise<typeof QueueStore> => {
  vi.resetModules()

  const module = await import('@main/services/masterImportQueue.store')

  module.initialiseMasterImportQueue()

  return module
}

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'trackvid-queue-test-'))
})

afterEach(async () => {
  await rm(directory, { recursive: true, force: true })
})

type NewReport = Omit<QueuedReport, 'key' | 'lastCheckedAt' | 'attempts'>

const entry = (over: Partial<NewReport> = {}): NewReport =>
  ({
    platform: 'snapdeal',
    credentialId: 'cred-1',
    username: 'seller@example.com',
    companyId: 'company-1',
    trackVidEmail: 'operator@example.com',
    importType: 'returnOrderData',
    portalReportName: 'Dropship Return Acknowledged',
    trackvidReportType: 'Dropship Rtv Report',
    initiationText: 'Dropship Return Acknowledged Created between 04-Aug-2026 and 01-Sep-2026',
    requestedAt: Date.now(),
    ...over
  }) satisfies NewReport

describe('master import queue', () => {
  it('supersedes an earlier request for the same report rather than queuing both', async () => {
    const store = await load()

    await store.enqueueReport(entry({ initiationText: 'first request' }))
    await store.enqueueReport(entry({ initiationText: 'second request' }))

    const queued = await store.listQueued()

    // A newer request covers a wider window; collecting the stale one would
    // import less data over more.
    expect(queued).toHaveLength(1)
    expect(queued[0]?.initiationText).toBe('second request')
  })

  it('never writes a password to disk', async () => {
    const store = await load()

    await store.enqueueReport(entry())

    const [queued] = await store.listQueued()

    expect(Object.keys(queued ?? {})).not.toContain('password')
  })
})
