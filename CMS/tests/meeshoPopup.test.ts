import { createRequire } from 'node:module'
import { describe, expect, it, vi } from 'vitest'

/**
 * Closing whatever promo Meesho puts in front of the supplier panel.
 *
 * The popup blocks every click behind it, so an automation that cannot dismiss
 * one stops at its first step. Both existing handlers matched ONE build's
 * markup — `Overlay__mtdbh40.Modal__1jp7csq1` in the claim tree,
 * `div[role="dialog"][aria-modal="true"]` in the master import — and Meesho
 * shipped a third with `growth-` utility classes, no role, no aria-modal, and a
 * close control that is an <img> inside a plain <div>. Neither saw it.
 *
 * The DOM matching itself runs in the page and needs a browser; what is pinned
 * down here is the part that decides what happens next — retry, remove, give
 * up — and the contract that matters most: it never throws, because a promo
 * nobody could close must not be the reason a run ends before the step that
 * would have reported something useful.
 */

const require_ = createRequire(import.meta.url)

const { dismissMeeshoPopup } = require_(
  '@trackvid/automation-core/platforms/meesho/common/dismissPopup'
) as {
  dismissMeeshoPopup: (
    page: { evaluate: (fn: unknown) => Promise<unknown> },
    options?: { attempts?: number; settleMs?: number; log?: object }
  ) => Promise<{ found: boolean; closed: boolean }>
}

const quiet = { log: () => undefined, warn: () => undefined, info: () => undefined }

/** A page whose `evaluate` returns the next canned answer each time. */
const pageReturning = (answers: unknown[]) => {
  const queue = [...answers]

  return {
    evaluate: vi.fn(() => Promise.resolve(queue.length > 1 ? queue.shift() : queue[0]))
  }
}

describe('dismissMeeshoPopup', () => {
  it('reports a clean page without touching it', async () => {
    const page = pageReturning([{ found: false, closed: false, how: 'none' }])

    await expect(dismissMeeshoPopup(page, { log: quiet })).resolves.toEqual({
      found: false,
      closed: true
    })
  })

  it('stops as soon as the popup is gone', async () => {
    // dismiss → still-open check says no.
    const page = pageReturning([{ found: true, closed: true, how: 'close-control' }, false])

    await expect(dismissMeeshoPopup(page, { log: quiet, settleMs: 0 })).resolves.toEqual({
      found: true,
      closed: true
    })
  })

  it('tries again when a second promo is queued behind the first', async () => {
    const page = {
      evaluate: vi
        .fn()
        // first: closed, but something is still on screen
        .mockResolvedValueOnce({ found: true, closed: true, how: 'close-control' })
        .mockResolvedValueOnce(true)
        // second: closed, and the page is clear
        .mockResolvedValueOnce({ found: true, closed: true, how: 'close-control' })
        .mockResolvedValueOnce(false)
    }

    await expect(dismissMeeshoPopup(page, { log: quiet, settleMs: 0 })).resolves.toEqual({
      found: true,
      closed: true
    })
    expect(page.evaluate).toHaveBeenCalledTimes(4)
  })

  it('gives up after its attempts rather than looping for ever', async () => {
    // Closes something every time, and something is always still there.
    let call = 0
    const page = {
      evaluate: vi.fn(() => {
        call += 1

        return Promise.resolve(
          call % 2 === 1 ? { found: true, closed: true, how: 'close-control' } : true
        )
      })
    }

    await expect(
      dismissMeeshoPopup(page, { log: quiet, settleMs: 0, attempts: 2 })
    ).resolves.toEqual({ found: true, closed: false })
  })

  it('never throws when the page itself fails', async () => {
    // A navigation mid-check, a detached frame — real, and not worth ending a
    // run over.
    const page = { evaluate: vi.fn(() => Promise.reject(new Error('Execution context destroyed'))) }

    await expect(dismissMeeshoPopup(page, { log: quiet })).resolves.toEqual({
      found: false,
      closed: false
    })
  })
})
