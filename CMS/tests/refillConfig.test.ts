import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
import { REFILL_FIELDS, REFILL_LABELS, canRefill, refillFieldsFor } from '@shared/constants/refill'
import { REFILL_PLATFORMS, refillPlatform } from '@main/automations/refill/registry'

/**
 * Which blanks Refill Data can fill, per platform.
 *
 * The list exists TWICE by necessity: the core owns it (the runners read it)
 * and the renderer mirrors it (it cannot load the core, and the dialog has to
 * offer the fields before anything runs). A field added to one and forgotten in
 * the other is a button that promises something no code answers — so the two
 * are compared here rather than trusted.
 */

const require_ = createRequire(import.meta.url)

const core = require_('@trackvid/automation-core/common/refillConfig') as {
  REFILL_PLATFORMS: string[]
  refillFields: (platform: string) => string[]
  canRefill: (platform: string, field: string) => boolean
}

describe('the refill config', () => {
  it('offers the same platforms as the core', () => {
    expect(Object.keys(REFILL_FIELDS).sort()).toEqual([...core.REFILL_PLATFORMS].sort())
  })

  it('offers the same fields as the core, in the same order', () => {
    for (const platform of core.REFILL_PLATFORMS) {
      expect(refillFieldsFor(platform)).toEqual(core.refillFields(platform))
    }
  })

  it('has a label for every field it offers', () => {
    // An unlabelled field renders as a blank row with a checkbox.
    for (const fields of Object.values(REFILL_FIELDS)) {
      for (const field of fields) expect(REFILL_LABELS[field]?.label).toBeTruthy()
    }
  })

  it('offers only what each platform can actually answer', () => {
    // Nykaa has exactly one field — the claim status. No per-claim account
    // (the company's single login owns every ticket), no sub-order, no forward
    // AWB: a ticket whose state moves after filing is all there is to repair.
    expect(canRefill('nykaa')).toBe(true)
    expect(refillFieldsFor('nykaa')).toEqual(['statusChange'])
    // AJIO does have a refill — answered from this machine's backup of the
    // seller portal's reports rather than from AJIO.
    expect(canRefill('ajio')).toBe(true)
    expect(refillFieldsFor('ajio')).toEqual([
      'accountMapping',
      'forwardAwbNumber',
      'sellerSku',
      'pobId',
      // The one AJIO field that is not local: a ticket's state lives with AJIO,
      // not in the reports this machine backs up.
      'statusChange'
    ])
    expect(canRefill('Meesho')).toBe(true)
  })

  it('has a resolver wherever a platform offers more than the account', () => {
    // The account is resolved by the run itself; anything else needs code.
    for (const [platform, fields] of Object.entries(REFILL_FIELDS)) {
      const needsResolver = fields.some(field => field !== 'accountMapping')

      expect(Boolean(REFILL_PLATFORMS[platform])).toBe(needsResolver)
    }
  })

  it('lets AJIO answer its own account, since its data is already here', () => {
    const ajio = refillPlatform('ajio')

    expect(ajio?.answersAccount).toBe(true)
    // No browser, no login sweep: the backup is on this machine.
    expect(ajio?.offline).toBe(true)
  })

  it('leaves every other platform to the login sweep', () => {
    for (const platform of Object.keys(REFILL_PLATFORMS).filter(name => name !== 'ajio')) {
      expect(refillPlatform(platform)?.answersAccount).toBeUndefined()
      expect(refillPlatform(platform)?.offline).toBeUndefined()
    }
  })

  it('never offers a field the core marks unanswerable', () => {
    for (const [platform, fields] of Object.entries(REFILL_FIELDS)) {
      for (const field of fields) expect(core.canRefill(platform, field)).toBe(true)
    }
  })
})
