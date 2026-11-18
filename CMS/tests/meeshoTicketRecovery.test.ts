import { createRequire } from 'node:module'
import { describe, expect, it, vi } from 'vitest'

/**
 * A Meesho submit that answers 500 may have filed the ticket anyway.
 *
 * The reported failure:
 *
 *   Create ticket failed: HTTP 500
 *   {"error":"Request failed with status code 500","options":{"backendData":{"error":""}}}
 *
 * Meesho's gateway says nothing about what happened behind it. The handler in
 * `createTicket` already asks whether that means a closed window or an unknown
 * sub-order — and when it is neither, the 500 was thrown as itself. But
 * "neither" includes the case where the ticket exists and only the response was
 * lost, and reporting THAT as a failure is how a second ticket gets raised for
 * the same return: the operator sees Failed and files again.
 *
 * The desktop's salvage step asked Meesho within a second of the failure and
 * was told there was no ticket. So the waiting is the behaviour under test.
 */

const require_ = createRequire(import.meta.url)

const { recoverTicket, VERIFY_DELAYS_MS } = require_(
  '@trackvid/automation-core/platforms/meesho/claim-management/api-based-flow/fileClaim'
) as {
  recoverTicket: (
    search: (sub: string) => Promise<unknown[]>,
    sub: string,
    options?: { delays?: number[]; log?: unknown }
  ) => Promise<{ ticketId: unknown; meeshoStatus: string | null; cmsStatus: string | null } | null>
  VERIFY_DELAYS_MS: number[]
}

const quiet = { log: { warn: () => undefined } }
const now = { delays: [0, 0, 0], ...quiet }

describe('looking for the ticket after a 500', () => {
  it('finds one that appears on a later read', async () => {
    // The list showed nothing a second after the failure and the ticket was
    // real — which is exactly why one read is not enough.
    let reads = 0
    const search = vi.fn(() => {
      reads += 1

      return Promise.resolve(reads < 3 ? [] : [{ ticket_id: 789744526971, status: 'Pending' }])
    })

    const found = await recoverTicket(search, '325890127312313984_1', now)

    expect(reads).toBe(3)
    expect(found?.ticketId).toBe(789744526971)
  })

  it('brings back the status, not just the id', async () => {
    // The row needs both: a ticket with no status reads as filed-but-unknown,
    // and the operator cannot tell it from a row nobody has looked at.
    const found = await recoverTicket(
      () => Promise.resolve([{ ticket_id: 1, status: 'Pending' }]),
      'sub',
      now
    )

    expect(found?.meeshoStatus).toBe('Pending')
    // Mapped to what the Claims page shows.
    expect(found?.cmsStatus).toBe('In Review')
  })

  it('stops at the first read that answers', async () => {
    const search = vi.fn(() => Promise.resolve([{ ticket_id: 5, status: 'Pending' }]))

    await recoverTicket(search, 'sub', now)

    expect(search).toHaveBeenCalledTimes(1)
  })

  it('answers null when the ticket never appears, so the failure stands', async () => {
    // The original 500 is the truth in that case, and the row is safe to retry.
    const search = vi.fn(() => Promise.resolve([]))

    expect(await recoverTicket(search, 'sub', now)).toBeNull()
    expect(search).toHaveBeenCalledTimes(3)
  })

  it('treats a failing search as no evidence and keeps trying', async () => {
    // A search that errored says nothing about whether a ticket exists;
    // concluding "none" from it would report a filed claim as unfiled.
    let reads = 0
    const search = vi.fn(() => {
      reads += 1

      return reads === 1
        ? Promise.reject(new Error('network'))
        : Promise.resolve([{ ticket_id: 9, status: 'Pending' }])
    })

    expect((await recoverTicket(search, 'sub', now))?.ticketId).toBe(9)
  })

  it('gives up rather than hanging when every search fails', async () => {
    const search = vi.fn(() => Promise.reject(new Error('network')))

    expect(await recoverTicket(search, 'sub', now)).toBeNull()
    expect(search).toHaveBeenCalledTimes(3)
  })

  it('ignores a ticket record with no id', async () => {
    expect(
      await recoverTicket(() => Promise.resolve([{ status: 'Pending' }]), 'sub', now)
    ).toBeNull()
  })

  it('waits between reads by default, and not on the first', () => {
    // The first read is immediate — a claim that failed for an ordinary reason
    // must not cost eleven seconds before it is reported.
    expect(VERIFY_DELAYS_MS[0]).toBe(0)
    expect(VERIFY_DELAYS_MS.slice(1).every(delay => delay > 0)).toBe(true)
  })
})
