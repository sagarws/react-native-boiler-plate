import { describe, expect, it } from 'vitest'
import {
  AutomationStopped,
  runStoppable,
  stoppableSleep,
  stopRequested,
  throwIfStopped
} from '@main/services/automationStop'

/**
 * Switching Automations off reaches the innermost loop.
 *
 * The AJIO report sync, switched off on page 1, read every remaining page of
 * every month in the background because the stop predicate was only checked
 * where a runner happened to pass it along. Each scheduled run now carries its
 * predicate in context, so any depth can ask.
 */

const tick = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0))

describe('the stop signal', () => {
  it('is never set outside a scheduled run — buttons are stopped by their operator', () => {
    expect(stopRequested()).toBe(false)
    expect(() => throwIfStopped('a button')).not.toThrow()
  })

  it('reaches code awaited several calls deep', async () => {
    let off = false
    const pages: number[] = []

    const readPage = async (page: number): Promise<void> => {
      await tick()
      throwIfStopped(`page ${page}`)
      pages.push(page)
    }

    const run = runStoppable(
      () => off,
      async () => {
        for (let page = 1; page <= 100; page += 1) {
          if (page === 4) off = true
          await readPage(page)
        }
      }
    )

    await expect(run).rejects.toBeInstanceOf(AutomationStopped)
    expect(pages).toEqual([1, 2, 3])
  })

  it('ends a long wait within a second of the switch', async () => {
    let off = false
    const started = Date.now()

    setTimeout(() => {
      off = true
    }, 200)

    await expect(
      runStoppable(() => off, () => stoppableSleep(10 * 60_000, 'waiting for a report'))
    ).rejects.toThrow(/Automations switched off \(waiting for a report\)/)
    expect(Date.now() - started).toBeLessThan(2000)
  })

  it('does not leak into work started after the run', async () => {
    await runStoppable(() => true, () => Promise.resolve())

    expect(stopRequested()).toBe(false)
  })
})
