import { describe, expect, it } from 'vitest'
import { ACCOUNT_MAPPABLE_PLATFORMS, isAccountMappable } from '@shared/constants/accountMapping'
import { ACCOUNT_PROBES } from '@main/automations/accountMapping/registry'

/**
 * The renderer's list and the main process's registry must agree.
 *
 * They cannot be one thing: the registry maps platform names to imported
 * probe functions, which does not survive a trip over IPC, so the renderer
 * carries its own list to decide whether the button belongs on screen. Two
 * lists is how a button appears for a platform nothing can map — the operator
 * presses it and is told the app cannot do the thing it just offered.
 */
describe('account-mapping platforms', () => {
  it('offers the button for exactly the platforms this build can probe', () => {
    expect([...ACCOUNT_MAPPABLE_PLATFORMS].sort()).toEqual(Object.keys(ACCOUNT_PROBES).sort())
  })

  it('leaves out Nykaa, which has no per-claim account to map', () => {
    // The company's single Nykaa login files every claim, so a run would ask
    // that account about rows already going to it.
    expect(isAccountMappable('nykaa')).toBe(false)
  })

  it('leaves out the tabs that are not automated platforms', () => {
    // Tata CliQ used to be in this list and is not any more: it has a probe
    // now, and its return is located by sweeping the login's slaves.
    for (const tab of ['Amazon', 'Other']) {
      expect(isAccountMappable(tab)).toBe(false)
    }
  })

  it('matches on the grid’s casing AND its spacing, not the registry’s', () => {
    // Platform tabs are "Ajio" and "Meesho"; the registry is lowercase. That
    // much was always true — and lower-casing alone was enough only while
    // every platform's name was one word. See shared/utils/platformKey.
    expect(isAccountMappable('Ajio')).toBe(true)
    expect(isAccountMappable('Meesho')).toBe(true)
    expect(isAccountMappable('Tata CliQ')).toBe(true)
  })
})
