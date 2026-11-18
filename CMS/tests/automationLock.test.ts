import { describe, expect, it, vi } from 'vitest'

/**
 * One automation drives the browser at a time.
 *
 * Two runners at once compete for the screen, for the marketplace's rate
 * limits, and for the same stored session — one re-authenticates while the
 * other is mid-claim, and the second one's next call comes back 401 for no
 * reason it can report. These tests pin the three properties that prevent it:
 * exclusion, ordering, and release-on-failure.
 */

vi.mock('@main/services/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))

const { withAutomationLock, isAutomationBusy, automationHolder } = await import(
  '@main/services/automationLock'
)

const tick = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0))

describe('withAutomationLock', () => {
  it('runs one at a time, in the order they arrived', async () => {
    const order: string[] = []

    const job = (name: string): Promise<void> =>
      withAutomationLock(name, async () => {
        order.push(`${name}:start`)
        await tick()
        order.push(`${name}:end`)
      })

    await Promise.all([job('a'), job('b'), job('c')])

    expect(order).toEqual(['a:start', 'a:end', 'b:start', 'b:end', 'c:start', 'c:end'])
  })

  it('releases the lock when the work throws, so the next caller still runs', async () => {
    await expect(
      withAutomationLock('boom', () => Promise.reject(new Error('failed')))
    ).rejects.toThrow('failed')

    expect(isAutomationBusy()).toBe(false)
    await expect(withAutomationLock('after', () => Promise.resolve('ran'))).resolves.toBe('ran')
  })

  it('names the current holder while it runs, so a waiter can say what it is waiting for', async () => {
    let seen: string | null = 'not-set'

    await withAutomationLock('bulk-spf', async () => {
      seen = automationHolder()
      await tick()
    })

    expect(seen).toBe('bulk-spf')
    expect(automationHolder()).toBeNull()
  })
})
