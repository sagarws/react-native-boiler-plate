import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Who owns a claim — and the state where nobody does.
 *
 * A Tata CliQ claim sat on "Queued" with 0 attempts and no error. The dispatch
 * had handed it to this machine and marked the row Queued on that basis; this
 * app then read `desktopExecution` for itself, found nothing stored, called it
 * server-run, and declined. The server has no Tata CliQ runner at all, so the
 * claim was owned by nobody and nothing said so.
 *
 * Two rules come out of that, and these pin both.
 */

interface RoutingResponse {
  success: boolean
  data?: { desktopExecution: Record<string, Record<string, boolean>> }
  error?: { code: string; message: string }
}

const routing = vi.hoisted<{ response: RoutingResponse }>(() => ({
  response: { success: true, data: { desktopExecution: {} } }
}))

vi.mock('@main/services/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))
vi.mock('@main/services/httpClient', () => ({
  apiRequest: () => Promise.resolve(routing.response)
}))
vi.mock('@main/services/session.store', () => ({ getAccessToken: () => 'token' }))

const { runsHere, clearRoutingCache } = await import('@main/services/automationRouting.service')

beforeEach(() => {
  routing.response = { success: true, data: { desktopExecution: {} } }
  clearRoutingCache?.()
})

describe('runsHere', () => {
  it('says the server owns a platform nobody has configured', async () => {
    // The default for everything the server has always run.
    expect(await runsHere('flipkart', 'claim')).toBe(false)
    expect(await runsHere('meesho', 'claim')).toBe(false)
  })

  it('says THIS machine owns a platform the server cannot run', async () => {
    // Tata CliQ's portal is behind Cloudflare and every call comes from inside
    // a logged-in page; there is no server runner to fall back to. Reading
    // "not set" as "not here" is what left the claim with no owner.
    expect(await runsHere('tatacliq', 'claim')).toBe(true)
    // Spelling is not the question being asked.
    expect(await runsHere('Tata CliQ', 'claim')).toBe(true)
  })

  it('still obeys a company that turned it off explicitly', async () => {
    routing.response = {
      success: true,
      data: { desktopExecution: { tatacliq: { claim: false } } }
    }

    // Both sides refuse together, which is a decision rather than a gap: the
    // dispatch will not send it either.
    expect(await runsHere('tatacliq', 'claim')).toBe(false)
  })

  it('obeys a company that turned another platform ON', async () => {
    routing.response = {
      success: true,
      data: { desktopExecution: { flipkart: { claim: true } } }
    }

    expect(await runsHere('flipkart', 'claim')).toBe(true)
  })

  it('treats an unreadable routing response as server-run', async () => {
    // A real failure shape — `withOfflineCache` reads the message to decide
    // whether this is an offline blip worth serving a cached answer for.
    routing.response = {
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'routing unavailable' }
    }

    // Unchanged, and deliberately: not knowing must not start filing claims
    // the server may also be filing.
    expect(await runsHere('flipkart', 'claim')).toBe(false)
  })

  it('does not hand master import to the desktop by that rule', async () => {
    // The desktop-only default is about CLAIMS. Tata CliQ has no master import
    // at all, and answering "yes, here" for one would be an invention.
    expect(await runsHere('tatacliq', 'masterImport')).toBe(false)
  })
})
