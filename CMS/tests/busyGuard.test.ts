import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Whether the app may be closed right now.
 *
 * THE RUN ENDS AT A MARKETPLACE, NOT HERE. Quitting part-way through filing a
 * claim can leave a ticket raised on the marketplace with nothing recorded
 * against it on this machine — and the next run, seeing a claim it believes was
 * never filed, raises a second one for the same return.
 *
 * So this exists to be RIGHT ABOUT BOTH ANSWERS. A false "busy" traps somebody
 * in an app they cannot close; a false "idle" is the duplicate ticket.
 */

const state = vi.hoisted(() => ({ holder: null as string | null, scheduled: false }))

vi.mock('@main/services/automationLock', () => ({
  automationHolder: () => state.holder
}))
vi.mock('@main/services/automationScheduler.service', () => ({
  isScheduleRunning: () => state.scheduled
}))

const { busyState } = await import('@main/services/busyGuard')

beforeEach(() => {
  state.holder = null
  state.scheduled = false
})

describe('closing the app', () => {
  it('is allowed when nothing is running', () => {
    expect(busyState()).toEqual({ busy: false, holder: null })
  })

  it('is refused while something holds the browser, and names it', () => {
    // The name goes in the dialog: "Auto claim is still running" tells an
    // operator what to wait for, where "something is running" does not.
    state.holder = 'Auto claim'

    expect(busyState()).toEqual({ busy: true, holder: 'Auto claim' })
  })

  it('is refused BETWEEN the steps of a scheduled task', () => {
    // The lock is free for a moment between two accounts of a Session update,
    // and the run is very much not over. Asking only the lock would call that
    // idle and let the window close mid-sequence.
    state.holder = null
    state.scheduled = true

    expect(busyState().busy).toBe(true)
  })

  it('prefers the lock holder name over the generic one', () => {
    state.holder = 'Snapdeal session capture'
    state.scheduled = true

    expect(busyState().holder).toBe('Snapdeal session capture')
  })
})
