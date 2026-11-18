import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * No claim is filed through a session the marketplace has already rejected.
 *
 * What matters here is where the line falls. Blocking too little means a run
 * opens a browser, files nothing, and reports a failure per claim — burning an
 * attempt each — for something the banner at the top of the screen was already
 * saying. Blocking too much is worse: AJIO has no jar-only probe by design, so
 * every AJIO account answers "cannot tell", and treating that as dead would
 * stop AJIO claims entirely.
 */

const calls = vi.hoisted(() => ({
  probed: [] as string[],
  renewed: [] as string[]
}))

interface Behaviour {
  /** platform:username → the verdicts to answer with, in order. */
  verdicts: Map<string, string[]>
  apiFlow: boolean
  hasApiRunner: boolean
  renewSucceeds: boolean
}

const behaviour = vi.hoisted<Behaviour>(() => ({
  verdicts: new Map(),
  apiFlow: true,
  hasApiRunner: true,
  renewSucceeds: false
}))

vi.mock('@main/services/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))
vi.mock('@main/services/automationRouting.service', () => ({
  usesApiFlow: () => Promise.resolve(behaviour.apiFlow)
}))
vi.mock('@main/automations/registry', () => ({
  resolveClaimRunner: () =>
    behaviour.hasApiRunner
      ? { runner: vi.fn(), flow: behaviour.apiFlow ? 'api' : 'script', substituted: false }
      : null,
  // The real rule, not a stub that always agrees: every API flow depends on
  // the stored session, and among the script flows only Flipkart's does.
  dependsOnStoredSession: (platform: string, flow: string) =>
    flow === 'api' || platform.toLowerCase().trim() === 'flipkart'
}))
vi.mock('@main/services/company.service', () => ({
  credentialFor: (_platform: string, username: string) =>
    Promise.resolve({ credentialId: `cred-${username}`, username })
}))
vi.mock('@main/services/sessionReuse.service', () => ({
  reusableSession: (platform: string, username: string) => {
    const id = `${platform}:${username}`

    calls.probed.push(id)

    const queue = behaviour.verdicts.get(id) ?? ['reused']
    const reason = queue.length > 1 ? queue.shift() : queue[0]

    return Promise.resolve({ session: null, reason, detail: `verdict: ${reason}` })
  }
}))
vi.mock('@main/services/claimSession.service', () => ({
  renewForClaim: (platform: string, username: string) => {
    calls.renewed.push(`${platform}:${username}`)

    return Promise.resolve(behaviour.renewSucceeds ? { jar: {} } : null)
  }
}))

const { inactiveAccounts, describeBlocked, sessionVerdicts } = await import(
  '@main/services/claimSessionGuard'
)

const reset = (): void => {
  calls.probed.length = 0
  calls.renewed.length = 0
  behaviour.verdicts = new Map()
  behaviour.apiFlow = true
  behaviour.hasApiRunner = true
  behaviour.renewSucceeds = false
}

beforeEach(reset)

const claim = (platform: string, username: string) => ({ platform, username })

describe('inactiveAccounts', () => {
  it('lets a working session through', async () => {
    behaviour.verdicts.set('flipkart:a@x.com', ['reused'])

    expect(await inactiveAccounts([claim('flipkart', 'a@x.com')])).toEqual([])
  })

  it('blocks the three verdicts that mean there is no usable session', async () => {
    for (const reason of ['none-stored', 'empty-jar', 'dead']) {
      reset()
      behaviour.verdicts.set('flipkart:a@x.com', [reason])

      const blocked = await inactiveAccounts([claim('flipkart', 'a@x.com')])

      expect(blocked).toHaveLength(1)
      expect(blocked[0]).toMatchObject({ platform: 'flipkart', username: 'a@x.com' })
    }
  })

  it('never blocks on a verdict the probe could not reach', async () => {
    // AJIO has no jar-only probe by design — its check needs a live page — so
    // every AJIO account lands here. Blocking would stop AJIO claims entirely.
    for (const reason of ['unverifiable', 'probe-failed']) {
      reset()
      behaviour.verdicts.set('ajio:a@x.com', [reason])

      expect(await inactiveAccounts([claim('ajio', 'a@x.com')])).toEqual([])
    }
  })

  it('tries to renew a dead session before refusing it', async () => {
    // An installation with auto-login on repairs itself rather than stopping.
    behaviour.verdicts.set('flipkart:a@x.com', ['dead', 'reused'])
    behaviour.renewSucceeds = true

    expect(await inactiveAccounts([claim('flipkart', 'a@x.com')])).toEqual([])
    expect(calls.renewed).toEqual(['flipkart:a@x.com'])
  })

  it('refuses when the renewal did not fix it', async () => {
    behaviour.verdicts.set('flipkart:a@x.com', ['dead', 'dead'])
    behaviour.renewSucceeds = true

    expect(await inactiveAccounts([claim('flipkart', 'a@x.com')])).toHaveLength(1)
  })

  it('checks each account once however many claims it covers', async () => {
    behaviour.verdicts.set('flipkart:a@x.com', ['reused'])

    await inactiveAccounts([
      claim('flipkart', 'a@x.com'),
      claim('flipkart', 'a@x.com'),
      claim('flipkart', 'A@X.com')
    ])

    // The probe is a marketplace round trip; twenty claims for one seller must
    // not be twenty of them.
    expect(calls.probed).toEqual(['flipkart:a@x.com'])
  })

  it('does not check a script flow at all', async () => {
    // It signs in from scratch every run and holds no stored session to be
    // dead; refusing it would turn away work that would have succeeded.
    behaviour.apiFlow = false
    behaviour.verdicts.set('meesho:a@x.com', ['dead'])

    expect(await inactiveAccounts([claim('meesho', 'a@x.com')])).toEqual([])
    expect(calls.probed).toEqual([])
  })

  it("checks a script flow that DOES start from the stored session", async () => {
    // Flipkart's Selenium flow hydrates the stored jar and proves it against
    // the SPF dashboard, so a dead session there is not free: the run falls
    // through to a sign-in that waits on an emailed code, once per account,
    // in the middle of a batch. It was skipped for years on the assumption
    // that "script flow" meant "signs in anyway".
    behaviour.apiFlow = false
    behaviour.verdicts.set('flipkart:a@x.com', ['dead'])

    const blocked = await inactiveAccounts([claim('flipkart', 'a@x.com')])

    expect(calls.probed).toEqual(['flipkart:a@x.com'])
    expect(blocked).toHaveLength(1)
    expect(blocked[0]?.state).toBe('dead')
  })

  it('carries the credential and the state, so the page can offer a re-capture', async () => {
    behaviour.verdicts.set('flipkart:a@x.com', ['none-stored'])

    const blocked = await inactiveAccounts([claim('flipkart', 'a@x.com')])

    // A toast the operator has to decode is the thing this replaces: the
    // dialog re-captures the named account in one press.
    expect(blocked[0]).toMatchObject({ credentialId: 'cred-a@x.com', state: 'none' })
  })

  it('ignores a claim with no account on it', async () => {
    // A different problem, reported by a different gate — naming it here would
    // report a missing account as a session fault.
    expect(await inactiveAccounts([{ platform: 'flipkart', username: '' }])).toEqual([])
    expect(await inactiveAccounts([{ platform: '', username: 'a@x.com' }])).toEqual([])
    expect(calls.probed).toEqual([])
  })
})

describe('sessionVerdicts for an action that IS the API call', () => {
  /**
   * Check TAT, Refill, account mapping and the SKU sweep are HTTP calls on the
   * stored jar. They have no sign-in to fall back on, so the claim registry's
   * question — "would this flow have signed in anyway?" — is the wrong one: a
   * company that files claims through a script flow still cannot refill a row
   * on a dead session.
   */
  it('blocks a dead session even where a claim would not be blocked', async () => {
    // Meesho's script flow signs in every run, so a claim is let through…
    behaviour.apiFlow = false
    behaviour.verdicts.set('meesho:a@x.com', ['dead'])

    expect(await sessionVerdicts([claim('meesho', 'a@x.com')])).toEqual([])

    // …and the same account, for a refill, is not.
    const blocked = await sessionVerdicts([claim('meesho', 'a@x.com')], { directApiCall: true })

    expect(blocked).toHaveLength(1)
    expect(blocked[0]).toMatchObject({ platform: 'meesho', username: 'a@x.com', state: 'dead' })
  })

  it('still lets a working session through, and still ignores "cannot tell"', async () => {
    behaviour.apiFlow = false
    behaviour.verdicts.set('meesho:a@x.com', ['reused'])
    behaviour.verdicts.set('ajio:b@x.com', ['unverifiable'])

    expect(
      await sessionVerdicts([claim('meesho', 'a@x.com'), claim('ajio', 'b@x.com')], {
        directApiCall: true
      })
    ).toEqual([])
  })

  it('asks about a platform this build has no claim runner for', async () => {
    // The gate is in front of a refill, not a claim — "no runner" says nothing
    // about whether the marketplace will answer an HTTP call.
    behaviour.hasApiRunner = false
    behaviour.verdicts.set('xbees:a@x.com', ['dead'])

    expect(await sessionVerdicts([claim('xbees', 'a@x.com')])).toEqual([])
    expect(await sessionVerdicts([claim('xbees', 'a@x.com')], { directApiCall: true })).toHaveLength(1)
  })
})

describe('describeBlocked', () => {
  it('names the accounts, and says nothing was filed', () => {
    const message = describeBlocked([
      { platform: 'flipkart', username: 'a@x.com', detail: 'dead', credentialId: 'c1', state: 'dead' },
      { platform: 'nykaa', username: 'b@x.com', detail: 'dead', credentialId: 'c2', state: 'dead' }
    ])

    expect(message).toContain('Nothing was filed')
    expect(message).toContain('flipkart (a@x.com)')
    expect(message).toContain('nykaa (b@x.com)')
    expect(message).toContain('Login page')
  })
})
