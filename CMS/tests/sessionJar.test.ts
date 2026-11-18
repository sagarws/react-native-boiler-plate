import { describe, expect, it } from 'vitest'
import { isSessionCookie, shapeJar } from '@shared/utils/sessionJar'
import type { HarvestedCookie } from '@shared/types/platformSession'

const cookie = (name: string, value: string, domain = '.example.com'): HarvestedCookie => ({
  name,
  value,
  domain
})

describe('shapeJar', () => {
  const jar = [cookie('erp.at', 'token-a'), cookie('session', 'token-b')]

  it('keeps the whole cookie for a cookie-array endpoint', () => {
    // AJIO rehydrates via CDP Network.setCookies, which needs domain and path.
    const shaped = shapeJar(jar, 'cookie-array')

    expect(Array.isArray(shaped)).toBe(true)
    expect(shaped).toEqual(jar)
  })

  it('flattens to name/value for a map endpoint', () => {
    expect(shapeJar(jar, 'name-value-map')).toEqual({
      'erp.at': 'token-a',
      session: 'token-b'
    })
  })

  it('produces a map the automation can index by cookie name', () => {
    // The whole point: `jar["erp.at"]` has to work. An array here is the silent
    // corruption this function exists to prevent — Object.keys(array).length is
    // non-zero, so the backend's emptiness check passes and stores it anyway.
    const shaped = shapeJar(jar, 'name-value-map') as Record<string, string>

    expect(shaped['erp.at']).toBe('token-a')
    expect(Array.isArray(shaped)).toBe(false)
  })

  it('defaults an unknown format to the map shape', () => {
    // Seven of eight endpoints want a map, and a map that is wrong is rejected
    // loudly by the one that wants an array — whereas an array that is wrong is
    // accepted and stored. Fail toward the shape that cannot corrupt.
    expect(shapeJar(jar, 'something-new')).toEqual({
      'erp.at': 'token-a',
      session: 'token-b'
    })
  })

  it('lets a later duplicate win, as a browser would', () => {
    const dupes = [cookie('session', 'stale'), cookie('session', 'fresh')]

    expect(shapeJar(dupes, 'name-value-map')).toEqual({ session: 'fresh' })
  })

  it('handles an empty jar', () => {
    expect(shapeJar([], 'name-value-map')).toEqual({})
    expect(shapeJar([], 'cookie-array')).toEqual([])
  })

  /**
   * A map jar is replayed as a bare `Cookie:` header from Node, with none of
   * the other signals the marketplace saw when the cookies were minted.
   * Analytics cookies are dead weight there; Akamai's bot-management cookies
   * are worse, because they encode the BROWSER session they came from and a
   * different client replaying them contradicts its own request.
   */
  describe('cookies that are not session material', () => {
    // Exactly what a Myntra capture harvested in the field. Both cookies
    // Myntra authenticates with are present, and the probe still came back
    // anonymous.
    const harvested = [
      cookie('_ga', 'GA1.1'),
      cookie('_ga_CLQ5YK88VZ', 'GS1.1'),
      cookie('_ga_NPDZHY82G1', 'GS1.1'),
      cookie('ak_bmsc', 'akamai-blob'),
      cookie('bm_sv', 'akamai-blob'),
      cookie('erp.at', 'token-a'),
      cookie('erp.rt', 'token-r'),
      cookie('session', 'token-b')
    ]

    it('keeps only what the marketplace authenticates with', () => {
      expect(shapeJar(harvested, 'name-value-map')).toEqual({
        'erp.at': 'token-a',
        'erp.rt': 'token-r',
        session: 'token-b'
      })
    })

    it('matches a whole analytics family, not just the names seen so far', () => {
      // `_ga_<PROPERTY>` is per tag, so naming them individually is a list that
      // goes stale the next time somebody adds one.
      expect(isSessionCookie('_ga_ANYTHINGATALL')).toBe(false)
      expect(isSessionCookie('_ga')).toBe(false)
    })

    it('does not catch a session cookie that merely starts the same way', () => {
      // A prefix match on the bare name would drop these; the rule requires the
      // separator, so a marketplace cookie called `_gateway` survives.
      expect(isSessionCookie('_gateway')).toBe(true)
      expect(isSessionCookie('sessionid')).toBe(true)
    })

    /**
     * AJIO's jar is rehydrated into a real browser through CDP, where the
     * bot-management cookies are consistent with the client presenting them.
     * Dropping them there would be the harmful move.
     */
    it('leaves a cookie-array jar completely alone', () => {
      expect(shapeJar(harvested, 'cookie-array')).toEqual(harvested)
    })
  })
})
