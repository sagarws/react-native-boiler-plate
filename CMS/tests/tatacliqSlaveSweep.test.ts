import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Sync slaves must actually READ THE PORTAL.
 *
 * THE REGRESSION THIS PINS, which shipped and cost two runs. A claim opens a
 * Tata CliQ session every time, and `openSignedInTataCliqPage` used to sweep
 * the portal's slave directory on every one of those opens — a page walk plus
 * one lookup per slave the type-ahead withheld, measured at EIGHT MINUTES on a
 * seller with 373 warehouses.
 *
 * Moving the claim onto the stored list fixed that. But `sweepTataCliqSlaves`
 * — the thing Sync slaves calls — deliberately makes NO separate call: it takes
 * the list off the same opener, on the reasoning that the opener already has
 * it. So the sweep went away there too, and Sync slaves became circular: it
 * read the nine already stored and wrote the same nine back.
 *
 * The list could no longer grow, and every Tata CliQ claim kept missing the
 * warehouse holding its return — reporting "not on any of 9 slaves" for an AWB
 * sitting in the portal's own QC panel.
 *
 * WHY THIS IS A SOURCE TEST. The two halves are in different files, and the
 * failure has no other signature: both compile, both run, and the sync reports
 * success having changed nothing. Only the wiring between them says otherwise.
 */

const main = join(__dirname, '..', 'electron', 'main')
const read = (...parts: string[]): string => readFileSync(join(main, ...parts), 'utf8')

const opener = () =>
  read('automations', 'platforms', 'tatacliq', 'common', 'signedInPage.ts')
const sweeper = () => read('automations', 'platforms', 'tatacliq', 'common', 'slaveSync.ts')

describe('Sync slaves reads the portal', () => {
  it('asks the opener to sweep', () => {
    // Without this the call returns the credential's stored list and the sync
    // writes back exactly what it just read.
    //
    // MATCHED INSIDE THE CALL, not anywhere in the file. The first version of
    // this test looked for `sweep: true` anywhere — and the comment explaining
    // the flag says that too, so deleting the ARGUMENT left the test passing.
    // Found by sabotaging the file and watching nothing fail.
    expect(sweeper()).toMatch(/openSignedInTataCliqPage\(\{[^})]*sweep:\s*true/s)
  })

  it('the opener still knows how to sweep', () => {
    const source = opener()

    expect(source).toMatch(/fetchAllSlaves/)
    expect(source).toMatch(/sweep\?:\s*boolean/)
  })

  it('only sweeps when asked', () => {
    /*
     * THE OTHER HALF, and the reason the flag exists rather than the sweep
     * simply coming back. A claim opens a session per run; sweeping there is
     * the eight minutes this whole change removed.
     */
    const source = opener()
    const call = source.indexOf('fetchAllSlaves(signedInPage')
    const guard = source.indexOf('if (input.sweep)')

    expect(guard).toBeGreaterThan(-1)
    expect(call).toBeGreaterThan(guard)
    // And the guard is close above the call — not a flag checked somewhere
    // else entirely while the sweep runs unconditionally.
    expect(call - guard).toBeLessThan(400)
  })

  it('falls back to the stored list rather than failing the open', () => {
    // A sweep that returns nothing, or throws, must not stop a claim: the
    // credential's list is worse but usable, and this path also runs for
    // sign-ins that have nothing to do with syncing.
    const source = opener()

    expect(source).toMatch(/storedSlaves\(input\.username\)/)
    expect(source).toMatch(/could not sweep the slave list/)
  })
})


/**
 * A Tata CliQ sign-in costs an emailed one-time code — so nothing unattended
 * may trigger one.
 *
 * WHAT HAPPENED WITHOUT THIS. A claim ran, the stored session would not open
 * the portal, and the run signed in: OTP requested, mailbox read, two minutes
 * spent, mid-batch, with nobody watching. The operator got a claim that failed
 * for a reason that had nothing to do with the claim — and the session was
 * silently replaced underneath them.
 *
 * The rule is now structural: a claim, a refill and an account-map probe all
 * pass `allowSignIn: false`, and a session that will not serve fails the row
 * with `TATACLIQ_SESSION_EXPIRED` instead. Only Sync slaves — pressed by a
 * person who is waiting — may sign in.
 */
describe('nothing unattended signs in to Tata CliQ', () => {
  const platform = join(main, 'automations', 'platforms', 'tatacliq')
  const read2 = (...parts: string[]): string => readFileSync(join(platform, ...parts), 'utf8')

  it.each([
    ['a claim', ['claim-management', 'api-based-flow', 'runClaim.ts']],
    ['a refill', ['refill', 'refillFields.ts']],
    ['an account-map probe', ['account-mapping', 'api-based-flow', 'probeAwb.ts']]
  ])('%s opens the session with allowSignIn: false', (_what, parts) => {
    expect(read2(...parts)).toMatch(
      /openSignedInTataCliqPage\(\{[^})]*allowSignIn:\s*false/s
    )
  })

  it('Sync slaves may still sign in — somebody pressed it', () => {
    // The exception, and the only one. Left able to sign in on purpose.
    expect(sweeper()).not.toMatch(/allowSignIn:\s*false/)
  })

  it('refuses with a code the claim can report, not a bare failure', () => {
    // The row needs to say "re-capture this session", which means the reason
    // has to survive as something matchable rather than a message.
    const source = opener()

    expect(source).toMatch(/TATACLIQ_SESSION_EXPIRED/)
    expect(source).toMatch(/if \(input\.allowSignIn === false\)/)
  })

  it('only records a session as dead when the portal actually answered', () => {
    /*
     * A navigation timeout says the PORTAL did not answer; it says nothing
     * about the jar. Stamping both would record a good session as dead on one
     * slow night and stop every claim on the account until a re-capture.
     */
    const source = opener()

    expect(source).toMatch(/verdict === 'signed-out'/)
    expect(source).toMatch(/onVerdict/)
  })
})
