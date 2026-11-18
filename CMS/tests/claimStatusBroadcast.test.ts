import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * A status change must be PERSISTED before it is announced.
 *
 * It used to be announced from inside the store mutation, before the records
 * were written. Anything that reacted by re-reading the queue therefore raced
 * the write it was reacting to and could get the state from before the change —
 * and since nothing fired again, a finished claim sat on screen as "running"
 * for the rest of the session.
 *
 * The ordering is the fix; the panel using the pushed claim directly is the
 * belt to this pair of braces.
 */

const seen = vi.hoisted(() => ({ order: [] as string[], records: [] as unknown[] }))

vi.mock('@main/services/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))
vi.mock('@main/ipc/broadcast', () => ({
  broadcast: () => {
    // What a listener would see if it re-read the queue at this instant.
    seen.order.push('broadcast')
  }
}))
vi.mock('@main/database', () => ({ dataDirectory: () => '/tmp/trackvid-test' }))
vi.mock('@main/database/jsonStore', () => ({
  JsonCollection: class {
    read(): Promise<unknown[]> {
      return Promise.resolve(seen.records)
    }

    async mutate<R>(
      change: (records: unknown[]) => { records: unknown[]; result: R }
    ): Promise<R> {
      const { records, result } = change([...seen.records])

      // The write is asynchronous, exactly as the real store's is.
      await Promise.resolve()
      seen.records = records
      seen.order.push('persisted')

      return result
    }
  }
}))

const queue = await import('@main/services/claimQueue.service')

beforeEach(() => {
  seen.order = []
  seen.records = [
    {
      cmsId: 'claim-1',
      platform: 'flipkart',
      awbNumber: 'FMPC6363846560',
      companyId: 'c1',
      dispatchedAt: '2026-09-08T00:00:00.000Z',
      receivedAt: '2026-09-08T00:00:00.000Z',
      updatedAt: '2026-09-08T00:00:00.000Z',
      status: 'running'
    }
  ]
  queue.initialiseClaimQueue()
})

describe('setStatus', () => {
  it('writes before it announces', async () => {
    await queue.setStatus('claim-1', 'succeeded', { ticketId: 'TK-1' })

    expect(seen.order).toEqual(['persisted', 'broadcast'])
  })

  it('leaves the stored record terminal, so a re-read agrees with the push', async () => {
    await queue.setStatus('claim-1', 'succeeded', { ticketId: 'TK-1' })

    const [stored] = (await queue.listClaims()) as { status: string; ticketId?: string }[]

    expect(stored?.status).toBe('succeeded')
    expect(stored?.ticketId).toBe('TK-1')
  })

  it('says so, and announces nothing, when the claim is not in the queue', async () => {
    await expect(queue.setStatus('missing', 'failed')).resolves.toBe(false)
    expect(seen.order).not.toContain('broadcast')
  })
})
