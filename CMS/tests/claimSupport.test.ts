import { describe, expect, it, vi } from 'vitest'

/**
 * Why "Create Ticket" is disabled.
 *
 * Four different situations used to share one message — "runs on the server,
 * turn on desktop execution in Monitor" — and only the last of them was true.
 * The other three sent an operator to change a setting that was already
 * correct, or to wait for something that had already failed.
 *
 * The distinction that matters most is an empty routing list: it means
 * "the company routed nothing here" AND "we could not reach TrackVid to find
 * out", and those need opposite actions from the person reading it.
 */

vi.mock('@main/services/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))

const routing = vi.hoisted((): { result: unknown } => ({ result: null }))

vi.mock('@main/services/httpClient', () => ({
  apiRequest: vi.fn(() => Promise.resolve(routing.result))
}))
vi.mock('@main/services/session.store', () => ({
  getAccessToken: () => 'token',
  getSession: () => ({ user: {} })
}))
vi.mock('@main/services/offlineCache', () => ({
  withOfflineCache: async (_key: string, run: () => Promise<unknown>) => run()
}))
// Flipkart has both flows; ajio only the API one — which is the case that
// matters, because a company on the script path for ajio must NOT be told the
// desktop can file it.
vi.mock('@main/automations/registry', () => {
  type Flow = 'api' | 'script'

  const runners: Record<string, Partial<Record<Flow, () => undefined>>> = {
    // One flow only — the common case, and the one that regressed.
    ajio: { api: () => undefined },
    // Both, so a real choice exists and must be obeyed.
    flipkart: { api: () => undefined, script: () => undefined }
  }

  return {
    CLAIM_RUNNERS: runners,
    claimRunner: (platform: string, flow: Flow) => runners[platform.toLowerCase()]?.[flow] ?? null,
    resolveClaimRunner: (platform: string, chosen: Flow) => {
      const flows = runners[platform.toLowerCase()]

      if (!flows) return null

      const wanted = flows[chosen]

      if (wanted) return { runner: wanted, flow: chosen, substituted: false }

      const available = (Object.keys(flows) as Flow[]).filter(flow => flows[flow])

      if (available.length !== 1) return null

      const only = available[0] as Flow

      return { runner: flows[only], flow: only, substituted: true }
    }
  }
})

const { supportedPlatforms } = await import('@main/services/claimProcessor.service')
const { clearRoutingCache } = await import('@main/services/automationRouting.service')

const withRouting = async (result: unknown): ReturnType<typeof supportedPlatforms> => {
  routing.result = result
  clearRoutingCache()

  return supportedPlatforms()
}

describe('supportedPlatforms', () => {
  it('separates "not routed here" from "could not find out"', async () => {
    const unreachable = await withRouting({
      success: false,
      error: { code: 'NETWORK_ERROR', message: 'offline' }
    })

    expect(unreachable.routingKnown).toBe(false)
    expect(unreachable.supported).toEqual([])

    const routedNowhere = await withRouting({ success: true, data: { desktopExecution: {} } })

    expect(routedNowhere.routingKnown).toBe(true)
    expect(routedNowhere.supported).toEqual([])
  })

  it('supports a platform routed here even when its flow setting is unset', async () => {
    // THE REGRESSION THIS PINS. `apiBasedAutomation.ajio.claim` unset resolves
    // to the script flow, and this build has no ajio script runner — so the
    // button was disabled while `desktopExecution.ajio.claim` was plainly true,
    // and the tooltip blamed a setting that was already correct.
    //
    // Worse than the message: TrackVid routes the claim here on
    // desktopExecution alone, so a desktop that refuses means NOBODY files it.
    const unset = await withRouting({
      success: true,
      data: { desktopExecution: { ajio: { claim: true } } }
    })

    expect(unset.supported).toEqual(['ajio'])
  })

  it('still obeys the choice where the platform genuinely has both flows', async () => {
    const scriptPath = await withRouting({
      success: true,
      data: {
        desktopExecution: { flipkart: { claim: true } },
        apiBasedAutomation: { flipkart: { claim: false } }
      }
    })

    // Flipkart has a script runner, so "script" is honoured rather than
    // substituted — running its API flow for a company that chose Selenium is
    // the bug this registry was reshaped to prevent.
    expect(scriptPath.supported).toEqual(['flipkart'])
  })

  it('reports the runners this build has, whatever the routing says', async () => {
    // So the UI can say "there is no desktop runner for Amazon" instead of
    // blaming a setting that would not help if it were changed.
    const support = await withRouting({ success: true, data: { desktopExecution: {} } })

    expect(support.runners).toEqual(expect.arrayContaining(['ajio', 'flipkart']))
    expect(support.runners).not.toContain('amazon')
  })

  it('supports a platform only when it is both routed here and has a runner', async () => {
    const support = await withRouting({
      success: true,
      data: {
        desktopExecution: {
          ajio: { claim: true },
          // Routed here, but this build cannot file it in ANY flow.
          amazon: { claim: true },
          // Has a runner, but the company keeps it on the server.
          flipkart: { claim: false }
        },
        apiBasedAutomation: { ajio: { claim: true } }
      }
    })

    expect(support.routedHere).toEqual(expect.arrayContaining(['ajio', 'amazon']))
    expect(support.supported).toEqual(['ajio'])
  })

  it('ignores routing for a different automation', async () => {
    const support = await withRouting({
      success: true,
      data: { desktopExecution: { ajio: { masterImport: true, claim: false } } }
    })

    expect(support.supported).toEqual([])
  })
})
