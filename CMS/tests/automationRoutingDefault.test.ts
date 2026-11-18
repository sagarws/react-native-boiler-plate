import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The desktop and the server must agree about a company that has configured
 * nothing.
 *
 * THE BUG THIS EXISTS FOR, which already happened once: this app defaulted to
 * the API flow while the server defaulted to script. A company with the setting
 * unset therefore ran its Snapdeal master import two different ways depending
 * on which machine picked it up — and the two are not interchangeable
 * (`/report/generateReport` answers 500 for accounts whose reports the portal
 * UI produces perfectly well). The desktop failed, the server succeeded, on
 * identical configuration, and nothing anywhere said why.
 *
 * The default is now PER PLATFORM — script for everything except AJIO, whose
 * script flow cannot complete against the "Seller Central" SPA. That map is
 * written twice, because this service answers from the routing endpoint and
 * cannot load the core. Two copies of one decision is precisely how the two
 * sides drifted apart before, so the copies are compared here.
 */

/** `ajio: true,` → `{ ajio: true }`. Typed, so callers are not handed `any`. */
const parse = (block: string): Record<string, boolean> => {
  const out: Record<string, boolean> = {}

  for (const match of block.matchAll(/(\w+)\s*:\s*(true|false)/g)) {
    out[match[1] as string] = match[2] === 'true'
  }

  return out
}

const coreMap = (): Record<string, boolean> => {
  const source = readFileSync(
    join(
      __dirname,
      '..',
      'packages',
      'TrackVid-Automation-Core',
      'common',
      'automationRouting.js'
    ),
    'utf8'
  )
  const block = /const DEFAULT_API_FLOW = \{([^}]*)\}/.exec(source)

  expect(block, 'DEFAULT_API_FLOW is gone from the core').toBeTruthy()

  return parse(block?.[1] ?? '')
}

const desktopMap = (): Record<string, boolean> => {
  const source = readFileSync(
    join(__dirname, '..', 'electron', 'main', 'services', 'automationRouting.service.ts'),
    'utf8'
  )
  const block = /const DEFAULT_API_FLOW: Record<string, boolean> = \{([^}]*)\}/.exec(source)

  expect(block, 'DEFAULT_API_FLOW is gone from the desktop service').toBeTruthy()

  return parse(block?.[1] ?? '')
}

describe('the two runners default the same way', () => {
  it('holds the same map on both sides', () => {
    // Not "both contain ajio" — the WHOLE map, so a platform added to one and
    // not the other is caught the day it is added rather than the day a claim
    // runs differently on two machines.
    expect(desktopMap()).toEqual(coreMap())
  })

  it('defaults AJIO to the API flow', () => {
    // Its script flow drives a portal that no longer has the buttons it waits
    // for — defaulting to script is defaulting to a known failure.
    expect(coreMap().ajio).toBe(true)
  })

  it('defaults nothing else to the API flow', () => {
    /*
     * A global default of true is the change that broke Snapdeal. Anything
     * added here is a platform somebody has to have checked — so it has to be
     * added deliberately, in both files, and this test is where that is
     * noticed.
     */
    const api = Object.entries(coreMap())
      .filter(([, value]) => value)
      .map(([platform]) => platform)

    expect(api).toEqual(['ajio'])
  })

  it('still lets a company override it', () => {
    // The default is a default, not a decision taken away from anybody. Both
    // sides must read the stored boolean before falling back to the map.
    const source = readFileSync(
      join(__dirname, '..', 'electron', 'main', 'services', 'automationRouting.service.ts'),
      'utf8'
    )

    expect(source).toMatch(/typeof set === 'boolean'/)
  })
})
