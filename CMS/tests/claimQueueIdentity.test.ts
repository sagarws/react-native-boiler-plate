import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * The AWB is what is unique, not the cmsId.
 *
 * A dispute is about a parcel, and the marketplace accepts one per parcel. The
 * same AWB can arrive under a NEW cmsId after an edit or a re-import, so keying
 * on the id would leave this machine holding two records for one parcel and
 * filing it twice.
 */

const dir = mkdtempSync(join(tmpdir(), 'claim-queue-'))

vi.mock('@main/database', () => ({ dataDirectory: () => dir }))
vi.mock('@main/services/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}))
// setStatus now tells the renderer when a claim moves. That needs a live
// BrowserWindow, which a unit test has no business owning.
vi.mock('@main/ipc/broadcast', () => ({ broadcast: vi.fn() }))

const { initialiseClaimQueue, listClaims, recordDispatch, setStatus } = await import(
  '@main/services/claimQueue.service'
)

const dispatch = (over: Record<string, unknown> = {}) => ({
  cmsId: 'cms-1',
  companyId: 'co-1',
  platform: 'ajio',
  awbNumber: 'AWB-100',
  dispatchedAt: new Date().toISOString(),
  ...over
})

describe('recordDispatch', () => {
  beforeEach(() => {
    rmSync(join(dir, 'claim-queue.json'), { force: true })
    initialiseClaimQueue()
  })

  it('stores a claim it has not seen', async () => {
    expect(await recordDispatch(dispatch())).toBe(true)
    expect(await listClaims()).toHaveLength(1)
  })

  it('replaces an earlier claim for the same AWB, newest winning', async () => {
    await recordDispatch(dispatch())
    expect(await recordDispatch(dispatch({ cmsId: 'cms-2' }))).toBe(true)

    const queue = await listClaims()

    expect(queue).toHaveLength(1)
    expect(queue[0]?.cmsId).toBe('cms-2')
  })

  // Swapping the record underneath a runner would corrupt its bookkeeping, and
  // a second run is exactly what AWB uniqueness exists to prevent.
  it('refuses to replace a claim that is mid-run', async () => {
    await recordDispatch(dispatch())
    await setStatus('cms-1', 'running')

    expect(await recordDispatch(dispatch({ cmsId: 'cms-2' }))).toBe(false)

    const queue = await listClaims()

    expect(queue).toHaveLength(1)
    expect(queue[0]?.cmsId).toBe('cms-1')
    expect(queue[0]?.status).toBe('running')
  })

  it('replaces a finished claim, so a re-dispatch can be worked again', async () => {
    await recordDispatch(dispatch())
    await setStatus('cms-1', 'failed', { error: 'first attempt failed' })

    expect(await recordDispatch(dispatch({ cmsId: 'cms-2' }))).toBe(true)

    const queue = await listClaims()

    expect(queue).toHaveLength(1)
    expect(queue[0]?.status).toBe('received')
    expect(queue[0]?.error).toBeUndefined()
  })

  // AWB formats are not globally unique across marketplaces.
  it('keeps the same AWB on two platforms apart', async () => {
    await recordDispatch(dispatch())
    await recordDispatch(dispatch({ cmsId: 'cms-2', platform: 'myntra' }))

    expect(await listClaims()).toHaveLength(2)
  })

  it('falls back to the cmsId when a dispatch carries no AWB', async () => {
    await recordDispatch(dispatch({ cmsId: 'a', awbNumber: undefined }))
    await recordDispatch(dispatch({ cmsId: 'b', awbNumber: undefined }))

    expect(await listClaims()).toHaveLength(2)
  })

  it('ignores a dispatch with no cmsId at all', async () => {
    expect(await recordDispatch(dispatch({ cmsId: '' }))).toBe(false)
    expect(await listClaims()).toHaveLength(0)
  })
})

/**
 * A claim picked from the app's own list is adopted, not refused.
 *
 * The Claims page shows EVERY claim the company has, from the backend — but
 * only ones the socket dispatched were in the local queue, so selecting a row
 * and pressing Create Ticket answered "not queued on this machine". True, and
 * useless: the operator is looking at the row and asking for it to be filed.
 *
 * Adopting it means it gets everything a dispatched claim gets — liveness,
 * recovery after a crash, AWB de-duplication, the status callbacks.
 */
describe('adopting a claim from the list', () => {
  beforeEach(() => {
    rmSync(join(dir, 'claim-queue.json'), { force: true })
    initialiseClaimQueue()
  })

  it('queues a claim that was never dispatched here', async () => {
    expect(await recordDispatch(dispatch({ cmsId: 'picked', awbNumber: 'AWB-9' }))).toBe(true)

    const queue = await listClaims()

    expect(queue).toHaveLength(1)
    expect(queue[0]?.cmsId).toBe('picked')
    expect(queue[0]?.status).toBe('received')
  })

  // The AWB is unique in this process, so adopting must not start a second run
  // for a parcel already being worked.
  it('declines when that AWB is already running', async () => {
    await recordDispatch(dispatch({ cmsId: 'first', awbNumber: 'AWB-9' }))
    await setStatus('first', 'running')

    expect(await recordDispatch(dispatch({ cmsId: 'picked', awbNumber: 'AWB-9' }))).toBe(false)
    expect((await listClaims())[0]?.cmsId).toBe('first')
  })
})
