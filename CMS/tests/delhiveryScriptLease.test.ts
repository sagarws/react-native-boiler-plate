import { describe, expect, it, vi } from 'vitest'

/**
 * Which claims may share one signed-in browser.
 *
 * ONE SIGN-IN PER ACCOUNT, NOT PER CLAIM. The first version of this runner
 * built a driver, signed in and quit it for every claim: twenty claims on one
 * login meant twenty launches of Chrome and twenty sign-ins. The processor
 * already orders a selection so one account's claims run together, so the only
 * thing missing was a lease key — and a key that separates too little is worse
 * than no lease at all.
 *
 * THE LANE IS PART OF THE SESSION, which is the non-obvious half. Delhivery
 * holds the EXPRESS / SURFACE pick server-side, so two claims on one login but
 * different lanes sharing a browser would file the second lane's claims against
 * the first — a claim raised from the wrong seller, invisible until somebody
 * reconciles it.
 */

vi.mock('@main/services/claimSession.service', () => ({ claimCredentials: vi.fn() }))
vi.mock('@main/services/browserLease.service', () => ({
  leasedSession: vi.fn(),
  discardLease: vi.fn()
}))
vi.mock('@main/services/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))
vi.mock('@main/automations/common/coreLoader', () => ({ loadCore: () => ({}) }))
vi.mock('@main/automations/common/prepareCore', () => ({ prepareCoreWithBrowser: vi.fn() }))
vi.mock('@main/automations/common/tempDir', () => ({ withTempDir: vi.fn() }))
vi.mock('@main/automations/common/claimAccount', () => ({ requireClaimAccount: vi.fn() }))
vi.mock('@main/automations/common/claimConfig', () => ({ requireClaimConfig: vi.fn() }))

const { laneToSwitch, leaseKeyFor, sessionLooksDead } = await import(
  '@main/automations/platforms/delhivery/claim-management/script-based-flow/runClaim'
)

describe('leaseKeyFor', () => {
  it('lets every claim on one account share a browser', () => {
    expect(leaseKeyFor('ops@x.com')).toBe(leaseKeyFor('ops@x.com'))
  })

  it('gives a different account its own browser', () => {
    // The session is the whole point of holding one.
    expect(leaseKeyFor('ops@x.com')).not.toBe(leaseKeyFor('other@x.com'))
  })

  it('does not split a browser over typing', () => {
    expect(leaseKeyFor('Ops@X.com ')).toBe(leaseKeyFor('ops@x.com'))
  })

  it('does NOT split on the freight lane', () => {
    /*
     * THE BUG THIS REPLACED. The lane was in the key, which looked right —
     * Delhivery holds EXPRESS / SURFACE on the session. But a batch that mixes
     * lanes, or any row with a blank Domestic, then got a new key for almost
     * every claim and the lease closed the browser each time: twenty-five
     * claims, twenty-five logins, which is what the lease exists to stop.
     *
     * The lane is a dropdown. It is switched per claim instead — see
     * laneToSwitch.
     */
    expect(leaseKeyFor('ops@x.com')).toBe(leaseKeyFor('ops@x.com'))
  })
})

describe('laneToSwitch', () => {
  it('moves the session when the claim is on another lane', () => {
    // Not switching would file this claim from the lane the PREVIOUS claim
    // left the session on — a claim raised from the wrong seller.
    expect(laneToSwitch('EXPRESS', 'SURFACE')).toBe('SURFACE')
  })

  it('leaves it alone when the lane already matches', () => {
    // A dropdown dance per claim, for nothing.
    expect(laneToSwitch('EXPRESS', 'EXPRESS')).toBeNull()
    expect(laneToSwitch('EXPRESS', ' express ')).toBeNull()
  })

  it('leaves it alone when the row says nothing', () => {
    // A blank Domestic is not a reason to guess a lane: nothing is known to be
    // wrong with where the session stands.
    expect(laneToSwitch('EXPRESS', '')).toBeNull()
    expect(laneToSwitch('EXPRESS', undefined)).toBeNull()
  })

  it('sets the lane on a session that has none yet', () => {
    expect(laneToSwitch('', 'SURFACE')).toBe('SURFACE')
  })
})

describe('sessionLooksDead', () => {
  /**
   * WHAT DECIDES THE LOGIN COUNT. Everything that is not a dead browser keeps
   * the signed-in one — a refusal, a timeout, a step that did not work. The
   * previous rule discarded the browser on every failure, so a batch of claims
   * that Delhivery refused one after another signed in twenty-five times.
   */
  it('keeps the login when Delhivery refuses the claim in words', () => {
    expect(
      sessionLooksDead(
        Object.assign(new Error('The claim raise window for this waybill has passed.'), {
          delhiveryNotice: true
        })
      )
    ).toBe(false)
  })

  it('keeps it when a step simply did not work', () => {
    // A slow page is not a dead session, and paying a sign-in for one is how a
    // batch spends its afternoon logging in.
    expect(sessionLooksDead(new Error('Step 5 (Submit) failed: element not interactable'))).toBe(false)
    expect(sessionLooksDead(new Error('EVIDENCE_MISSING: no unboxing docs available.'))).toBe(false)
    expect(sessionLooksDead(undefined)).toBe(false)
  })

  it('replaces the browser when WebDriver says the session has gone', () => {
    // Reusing one of these produces a cascade of failures that read like
    // marketplace problems and are not.
    expect(sessionLooksDead(new Error('no such window: target window already closed'))).toBe(true)
    expect(sessionLooksDead(new Error('from unknown error: web view not found'))).toBe(true)
    expect(sessionLooksDead(new Error('invalid session id'))).toBe(true)
    expect(sessionLooksDead(new Error('ECONNREFUSED connect 127.0.0.1:49973'))).toBe(true)
  })
})
