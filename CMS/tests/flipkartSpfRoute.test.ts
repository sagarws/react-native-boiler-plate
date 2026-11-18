import { createRequire } from 'node:module'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Reaching the SPF Claims page.
 *
 * The sidebar route is three fragile steps — hover a rail item, wait for a
 * `popover="auto"` Chrome hides the moment the cursor drifts, click an option
 * inside it — and all three need the dashboard chrome to have rendered. When it
 * had not, the run failed at "Payments rail trigger" after 20 seconds of
 * nothing and the claim was recorded as broken, even though the session was
 * fine and the page it wanted is a plain URL.
 *
 * `gotoSpfDirect` is that URL. What these tests pin is that it verifies the
 * PAGE, not the address — because the address proves nothing here.
 * `#dashboard/payments/spf` is a hash fragment, and a hash never fails to
 * "land": a signed-out browser serves Flipkart's public "Start Selling"
 * marketing page at that exact URL, with a 200 and the fragment intact. Trusting
 * the URL reported that as success, and the run went on to hunt for a Raise New
 * Claim button on a page that has a Login button.
 */

const require_ = createRequire(import.meta.url)

const { gotoSpfDirect } = require_(
  '@trackvid/automation-core/platforms/flipkart/claim-management/common/utils'
) as { gotoSpfDirect: (driver: unknown) => Promise<boolean> }

/**
 * @param urls      what getCurrentUrl returns after each navigation, in order
 * @param options   href: the anchor's href when the DOM has one.
 *                  signedIn: whether the sidebar rail is present — the only
 *                  thing that distinguishes the dashboard from the public site.
 */
const makeDriver = (
  urls: string[],
  options: { href?: string; signedIn?: boolean; failFirstNavigation?: boolean } = {}
) => {
  const visited: string[] = []
  const signedIn = options.signedIn ?? true
  let index = 0
  let navigated = false

  return {
    visited,
    get: (url: string) => {
      visited.push(url)

      if (options.failFirstNavigation && visited.length === 1) {
        return Promise.reject(new Error('net::ERR_ABORTED'))
      }

      navigated = true

      return Promise.resolve()
    },
    getCurrentUrl: () => Promise.resolve(urls[index++] ?? urls.at(-1) ?? ''),
    wait: async (condition: () => Promise<boolean>) => {
      if (await condition()) return true

      throw new Error('timed out')
    },
    findElements: () => {
      // Before navigating this stands in for the SPF anchor; after, for the
      // sidebar rail the dashboard check looks for.
      if (!navigated) {
        return Promise.resolve(options.href ? [{ getAttribute: () => Promise.resolve(options.href) }] : [])
      }

      return Promise.resolve(signedIn ? [{}] : [])
    }
  }
}

const SPF = 'https://seller.flipkart.com/index.html#dashboard/payments/spf'

// Each attempt lets the SPA settle for three real seconds. Fake timers keep the
// suite instant without pretending that wait away in the code.
beforeEach(() => {
  vi.useFakeTimers()
})

const run = async (driver: unknown): Promise<boolean> => {
  const pending = gotoSpfDirect(driver)

  await vi.runAllTimersAsync()

  return pending
}

describe('gotoSpfDirect', () => {
  it('uses the real anchor href when the DOM still has one', async () => {
    const driver = makeDriver([SPF], { href: SPF })

    await expect(run(driver)).resolves.toBe(true)
    expect(driver.visited[0]).toBe(SPF)
  })

  it('constructs the hash route when no anchor is rendered', async () => {
    const driver = makeDriver(['https://seller.flipkart.com/#dashboard/payments/spf'])

    await expect(run(driver)).resolves.toBe(true)
    expect(driver.visited[0]).toContain('#dashboard/payments/spf')
  })

  it('tries the second URL shape when the first does not land', async () => {
    const driver = makeDriver([
      'https://seller.flipkart.com/',
      'https://seller.flipkart.com/index.html#dashboard/payments/spf'
    ])

    await expect(run(driver)).resolves.toBe(true)
    expect(driver.visited).toHaveLength(2)
  })

  it('reports failure when every attempt lands somewhere else', async () => {
    const driver = makeDriver(['https://seller.flipkart.com/login'])

    await expect(run(driver)).resolves.toBe(false)
  })

  it('refuses the public site even though it answers the very same URL', async () => {
    // The exact failure this was written for: right address, 200, hash intact,
    // and a "Start Selling" page underneath with no dashboard on it.
    const driver = makeDriver([SPF, SPF], { signedIn: false })

    await expect(run(driver)).resolves.toBe(false)
  })

  it('keeps trying after a navigation throws', async () => {
    const driver = makeDriver(
      ['https://seller.flipkart.com/index.html#dashboard/payments/spf'],
      { failFirstNavigation: true }
    )

    await expect(run(driver)).resolves.toBe(true)
    expect(driver.visited).toHaveLength(2)
  })
})
