import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { QueueEntryInput } from '@shared/vms/queue'

/**
 * The VMS queue: Argos' queue_order_video semantics on a JsonCollection, plus
 * the feedId scoping the CMS adds.
 */

const state = vi.hoisted(() => ({ broadcasts: [] as Array<{ channel: string; payload: unknown }> }))

vi.mock('electron', () => ({ app: { getPath: () => '/nonexistent' } }))
vi.mock('@main/services/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))
vi.mock('@main/ipc/broadcast', () => ({
  broadcast: (channel: string, payload: unknown) => state.broadcasts.push({ channel, payload })
}))

const { JsonCollection } = await import('@main/database/jsonStore')
const store = await import('@main/vms/queue.store')
const { queueOps, MAX_RETRIES } = store

const input = (trackingId: string): QueueEntryInput => ({
  file: { path: `/u/${trackingId}.webm`, name: `${trackingId}.webm`, mimetype: 'video/webm' },
  files: [{ path: `/u/${trackingId}-1.jpg`, name: 's1.jpg', mimetype: 'image/jpeg' }],
  trackingId,
  size: 10,
  length: 4,
  orderType: 'Forward',
  orderCondition: null,
  start_time: 1700000000000,
  keepOld: false,
  needRefund: true,
  eCommercePlatform: 'Meesho'
})

let directory = ''

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'vms-queue-'))
  state.broadcasts = []
  store.useQueueCollection(new JsonCollection({ name: store.QUEUE_COLLECTION, directory }))
})

afterEach(async () => {
  store.useQueueCollection(null)
  await rm(directory, { recursive: true, force: true })
})

describe('queue rows', () => {
  it('stores Argos columns plus feedId, and announces counts', async () => {
    const uuid = await store.enqueue(input('AWB1'), 'feed-a')
    const [row] = await store.listPending()

    expect(row).toMatchObject({
      id: 1,
      uuid,
      trackingId: 'AWB1',
      status: 'unsynced',
      orderCondition: null,
      start_time: '1700000000000',
      keepOld: false,
      needRefund: true,
      eCommercePlatform: 'Meesho',
      errorMessage: '',
      retryCount: 0,
      restartCount: 0,
      feedId: 'feed-a'
    })
    expect(JSON.parse(row!.file)).toEqual({ path: '/u/AWB1.webm', name: 'AWB1.webm', mimetype: 'video/webm' })
    expect(JSON.parse(row!.files)).toHaveLength(1)
    expect(state.broadcasts.at(-1)).toEqual({
      channel: 'vms:queue-counts-changed',
      payload: { unsynced: 1, syncing: 0, synced: 0, failed: 0 }
    })
    const onDisk = JSON.parse(await readFile(join(directory, `${store.QUEUE_COLLECTION}.json`), 'utf8')) as unknown[]
    expect(onDisk).toHaveLength(1)
  })

  it('hands the driver only the held feed’s rows, oldest first', async () => {
    await store.enqueue(input('B1'), 'feed-b')
    const a1 = await store.enqueue(input('A1'), 'feed-a')
    await store.enqueue(input('A2'), 'feed-a')

    expect((await store.nextUnsynced('feed-a'))?.uuid).toBe(a1)
    expect((await store.nextUnsynced('feed-c'))).toBeNull()
    expect(await store.listPending('feed-b')).toHaveLength(1)
  })

  it('walks unsynced → syncing → synced', async () => {
    const uuid = await store.enqueue(input('A1'), 'feed-a')
    await store.markSyncing(uuid)
    expect(await store.counts()).toEqual({ unsynced: 0, syncing: 1, synced: 0, failed: 0 })
    expect(await store.nextUnsynced('feed-a')).toBeNull()
    await store.markSynced(uuid)
    expect(await store.counts()).toEqual({ unsynced: 0, syncing: 0, synced: 1, failed: 0 })
  })

  it('counts retries, ticks restartCount at the cap, then skips the row', async () => {
    const uuid = await store.enqueue(input('A1'), 'feed-a')
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
      await store.markSyncing(uuid)
      await store.markUnsynced(uuid)
    }
    const [row] = await store.listPending()
    expect(row).toMatchObject({ retryCount: MAX_RETRIES, restartCount: 1, status: 'unsynced' })
    // Argos' poison rule: the head of the queue is no longer this row.
    expect(await store.nextUnsynced('feed-a')).toBeNull()
    await store.markFailed(uuid, 'Upload rejected')
    expect((await store.listFailed())[0]).toMatchObject({ status: 'failed', errorMessage: 'Upload rejected' })
  })

  it('retries a failed row with a fresh budget and deletes only failed rows', async () => {
    const failed = await store.enqueue(input('A1'), 'feed-a')
    const pending = await store.enqueue(input('A2'), 'feed-a')
    await store.markFailed(failed, 'x')

    expect(await store.deleteFailed(pending)).toBe(false)
    await store.retryFailed(failed)
    expect((await store.listPending()).find((row) => row.uuid === failed)).toMatchObject({
      retryCount: 0,
      restartCount: 0,
      errorMessage: ''
    })
    await store.markFailed(failed, 'again')
    expect(await store.deleteFailed(failed)).toBe(true)
    expect(await store.counts()).toEqual({ unsynced: 1, syncing: 0, synced: 0, failed: 0 })
  })

  it('requeue puts a syncing row back without spending a retry', async () => {
    const uuid = await store.enqueue(input('A1'), 'feed-a')
    await store.markSyncing(uuid)
    await store.requeue(uuid)
    expect((await store.listPending())[0]).toMatchObject({ status: 'unsynced', retryCount: 0 })
  })

  it('revives rows left syncing by a previous run when the file is opened', async () => {
    const uuid = await store.enqueue(input('A1'), 'feed-a')
    await store.markSyncing(uuid)
    // A new process: a fresh collection over the same file.
    store.useQueueCollection(new JsonCollection({ name: store.QUEUE_COLLECTION, directory }))
    expect(await store.counts()).toEqual({ unsynced: 1, syncing: 0, synced: 0, failed: 0 })
  })

  it('lists the paths a pending row still needs', async () => {
    await store.enqueue(input('A1'), 'feed-a')
    expect([...(await store.referencedPaths())].sort()).toEqual(['/u/A1-1.jpg', '/u/A1.webm'])
  })
})

describe('queueOps.pruneSynced', () => {
  it('keeps the newest synced rows and every unsent row', () => {
    let rows = queueOps.insert([], input('keep'), 'f', 'u-keep')
    for (let i = 0; i < store.MAX_SYNCED_ROWS + 2; i += 1) {
      rows = queueOps.insert(rows, input(`s${i}`), 'f', `u${i}`)
      rows = queueOps.setStatus(rows, `u${i}`, 'synced')
    }
    expect(queueOps.counts(rows)).toEqual({ unsynced: 1, syncing: 0, synced: store.MAX_SYNCED_ROWS, failed: 0 })
    expect(rows.some((row) => row.uuid === 'u0')).toBe(false)
    expect(rows.some((row) => row.uuid === 'u-keep')).toBe(true)
  })
})
