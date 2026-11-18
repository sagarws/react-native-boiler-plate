import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
import { platformKey, platformLabel } from '@shared/utils/platformKey'
import { canRefill, refillFieldsFor } from '@shared/constants/refill'
import { isAccountMappable, isAccountMapEligible } from '@shared/constants/accountMapping'
import { refillPlatform } from '@main/automations/refill/registry'
import { probeOpener } from '@main/automations/accountMapping/registry'
import { resolveClaimRunner } from '@main/automations/registry'

/**
 * The gap between what a platform is CALLED and what the registries key.
 *
 * This is not a hypothetical. Every registry in this app looked its platform up
 * with `platform.toLowerCase().trim()`, and every caller either holds the
 * claims grid's display LABEL or whatever TrackVid stored on the row. For
 * "Myntra" and "Flipkart" lower-casing closed that gap, so nothing was wrong
 * until a platform arrived whose name has a space in it: "Tata CliQ"
 * lower-cases to "tata cliq", which is not the key "tatacliq".
 *
 * Nothing threw. `canRefill` said no, so the Refill Data button did not render;
 * `isAccountMappable` said no, so Map Username did not either; `supported` did
 * not contain the tab, so Create Ticket stayed disabled — on a platform with a
 * working runner, a probe and a refill resolver, all of it reachable only if
 * asked by the right name.
 *
 * So the tests below ask by the WRONG name on purpose.
 */

const require_ = createRequire(import.meta.url)

const core = require_('@trackvid/automation-core/common/platforms') as {
  platformKey: (value: string) => string
}

/** Every way this app can be handed the same marketplace. */
const SPELLINGS = ['Tata CliQ', 'tata cliq', 'tatacliq', 'TATACLIQ', 'tata-cliq', '  Tata  CliQ  ']

describe('platformKey', () => {
  it('agrees with the core, which owns the canonical form', () => {
    for (const spelling of [
      ...SPELLINGS,
      'Myntra',
      'AJIO',
      'xpressbees',
      'Expressbees',
      'naykaa',
      'Nykaa Fashion',
      ''
    ]) {
      expect(platformKey(spelling)).toBe(core.platformKey(spelling))
    }
  })

  it('collapses every spelling of a two-word platform onto one key', () => {
    for (const spelling of SPELLINGS) expect(platformKey(spelling)).toBe('tatacliq')
  })

  it('keeps the rebranded courier and the mistyped marketplace pointing home', () => {
    expect(platformKey('Expressbees')).toBe('xbees')
    expect(platformKey('xpressbees')).toBe('xbees')
    expect(platformKey('naykaa')).toBe('nykaa')
  })

  it('hands back an unknown name unmangled rather than inventing a key', () => {
    // Squashing separators unconditionally could turn a new platform into an
    // existing key — "Tata Cliq Express" must not become Tata CliQ.
    expect(platformKey('Some New Marketplace')).toBe('some new marketplace')
    expect(platformKey('')).toBe('')
  })
})

describe('asking the registries by the name the UI holds', () => {
  it('offers Refill Data on the Tata CliQ tab', () => {
    // The reported bug: the button was absent on this exact string.
    expect(canRefill('Tata CliQ')).toBe(true)
    expect(refillFieldsFor('Tata CliQ')).toEqual(['accountMapping', 'forwardAwbNumber'])
    expect(refillPlatform('Tata CliQ')).not.toBeNull()
  })

  it('offers Map Username on it, and can open its probe', () => {
    expect(isAccountMappable('Tata CliQ')).toBe(true)
    expect(probeOpener('Tata CliQ')).not.toBeNull()
  })

  it('resolves its claim runner', () => {
    expect(resolveClaimRunner('Tata CliQ', 'api')).not.toBeNull()
  })

  it('counts a Tata CliQ row with no account as work for the mapper', () => {
    // `row.platform` is whatever TrackVid stored, which is not the tab label
    // and not always the key either.
    const row = {
      platform: 'Tata CliQ',
      status: 'Pending',
      username: '',
      pobId: '',
      subOrderNumber: ''
    }

    expect(isAccountMapEligible(row)).toBe(true)
  })

  it('still answers for the one-word platforms it always did', () => {
    expect(canRefill('Myntra')).toBe(true)
    expect(isAccountMappable('AJIO')).toBe(true)
    expect(resolveClaimRunner('Flipkart', 'api')).not.toBeNull()
  })
})

describe('platformLabel', () => {
  it('writes a stored key the way the marketplace spells itself', () => {
    expect(platformLabel('myntra')).toBe('Myntra')
    expect(platformLabel('tata cliq')).toBe('Tata CliQ')
    expect(platformLabel('ExpressBees')).toBe('Xbees')
  })

  it('raises the first letter of a name it does not know, rather than guessing', () => {
    expect(platformLabel('glowroad')).toBe('Glowroad')
    expect(platformLabel('')).toBe('')
  })
})

describe('the Delhivery script flow', () => {
  /**
   * BOTH FLOWS, and they are not interchangeable.
   *
   * `apiBasedAutomation.delhivery.claim` decides which one a company gets.
   * While only the API flow existed here, that setting was silently ignored on
   * the desktop: a company on the Selenium path had the API flow run on this
   * machine and the Selenium flow run on the server, from one setting — and the
   * two disagree about what a refusal looks like. The drawer says "the claim
   * window has closed" in words; the support API answers 200 with no ticket id.
   */
  it('is registered, so the company setting is honoured here too', () => {
    const script = resolveClaimRunner('Delhivery', 'script')

    expect(script).not.toBeNull()
    expect(script?.flow).toBe('script')
    // Not a substitution: a run that silently files through the other flow is
    // the thing this registration exists to stop.
    expect(script?.substituted).toBe(false)
  })

  it('still has the API flow, asked for by name', () => {
    const api = resolveClaimRunner('delhivery', 'api')

    expect(api?.flow).toBe('api')
    expect(api?.substituted).toBe(false)
  })
})
