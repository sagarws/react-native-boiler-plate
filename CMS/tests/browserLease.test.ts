import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * One browser per DRAIN, not per claim.
 *
 * AJIO's claims have to be filed from inside a logged-in page, so a browser is
 * unavoidable — but the desktop app was opening and closing Chrome for every
 * claim in the queue, signing in each time. The server has never done that
 * (`ensureSession` keeps one page for a whole batch) and neither does the bulk
 * runner.
 *
 * The two properties that make this safe are the last two: a claim run OUTSIDE
 * a drain must behave exactly as it did before, and a dead browser must never
 * be handed to the next claim.
 */

vi.mock('@main/services/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))

const { openClaimLease, closeClaimLease, discardLease, leasedSession, leaseState } = await import(
  '@main/services/browserLease.service'
)

const makeBrowser = () => {
  const browser = { connected: true, close: vi.fn(() => Promise.resolve()) }

  return browser
}

const session = (key: string, browser = makeBrowser(), page: Record<string, unknown> = {}) =>
  leasedSession(key, () => Promise.resolve({ browser, page, context: { sellerId: key } }))

beforeEach(async () => {
  await closeClaimLease()
  vi.clearAllMocks()
})

describe('leasedSession', () => {
  it('opens one browser for a whole drain and closes it at the end', async () => {
    openClaimLease()

    const browser = makeBrowser()
    const create = vi.fn(() => Promise.resolve({ browser, page: {}, context: { sellerId: 'a' } }))

    const first = await leasedSession('ajio:a@x.com', create)
    await first.release()

    const second = await leasedSession('ajio:a@x.com', create)
    await second.release()

    // Signed in once, not twice — and still open between claims.
    expect(create).toHaveBeenCalledTimes(1)
    expect(second.reused).toBe(true)
    expect(browser.close).not.toHaveBeenCalled()

    await closeClaimLease()
    expect(browser.close).toHaveBeenCalledTimes(1)
  })

  it('closes the previous browser when the account changes', async () => {
    openClaimLease()

    const first = makeBrowser()
    const second = makeBrowser()

    await session('ajio:a@x.com', first)
    await session('ajio:b@x.com', second)

    // Two marketplace browsers at once is what the automation lock exists to
    // prevent; holding several here would quietly reintroduce it.
    expect(first.close).toHaveBeenCalledTimes(1)
    expect(leaseState().key).toBe('ajio:b@x.com')
  })

  it('closes per claim when there is no drain, exactly as before', async () => {
    const browser = makeBrowser()
    const one = await session('ajio:a@x.com', browser)

    expect(one.reused).toBe(false)
    expect(browser.close).not.toHaveBeenCalled()

    await one.release()
    expect(browser.close).toHaveBeenCalledTimes(1)
    expect(leaseState()).toEqual({ open: false, key: null })
  })

  it('never hands on a browser that died', async () => {
    openClaimLease()

    const dead = makeBrowser()

    await session('ajio:a@x.com', dead)
    dead.connected = false

    const fresh = makeBrowser()
    const next = await session('ajio:a@x.com', fresh)

    expect(next.reused).toBe(false)
    expect(dead.close).toHaveBeenCalledTimes(1)
  })

  it('never hands on a page that was closed', async () => {
    openClaimLease()

    const browser = makeBrowser()

    await session('ajio:a@x.com', browser, { isClosed: () => true })

    const next = await session('ajio:a@x.com', makeBrowser())

    expect(next.reused).toBe(false)
  })

  it('drops the browser on discard, so a failure does not poison the queue', async () => {
    openClaimLease()

    const browser = makeBrowser()

    await session('ajio:a@x.com', browser)
    await discardLease()

    expect(browser.close).toHaveBeenCalledTimes(1)
    expect(leaseState()).toEqual({ open: true, key: null })

    // The lease is still open, so the next claim starts a fresh browser and
    // keeps it — discarding one bad session must not end the batch's sharing.
    const next = await session('ajio:a@x.com', makeBrowser())

    expect(next.reused).toBe(false)
    expect(leaseState().key).toBe('ajio:a@x.com')
  })
})
