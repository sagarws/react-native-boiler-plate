import type { HarvestedCookie } from '@shared/types/platformSession'

/**
 * The captured jar, in the shape a platform's ingest endpoint expects.
 *
 * The eight endpoints do not agree, and the disagreement is silent. AJIO stores
 * an array of whole cookies because it rehydrates them into Puppeteer through
 * CDP `Network.setCookies`, which needs domain and path. Every other endpoint
 * stores `{ name: value }` and replays it as a Cookie header.
 *
 * Sending an array where a map is expected is NOT rejected. Those endpoints
 * guard with `Object.keys(jar).length === 0`, and on an array that expression is
 * its length — so the check passes, the array is written into the credential's
 * session field, and the automation later reads `jar["erp.at"]` and gets
 * undefined. The capture reports success and the session fails on its first
 * request, a long way from here.
 *
 * Which shape each platform wants is `jarFormat` in the core's platform
 * registry, so the server and this app cannot drift on it.
 */
export type JarFormat = 'cookie-array' | 'name-value-map'

/**
 * Cookies that are never part of a session, and are actively harmful in one.
 *
 * WHY THIS LIST EXISTS. A `name-value-map` jar is replayed as a bare `Cookie:`
 * header from Node — no browser, no matching TLS handshake, none of the other
 * signals the marketplace saw when the cookies were minted. Two kinds of cookie
 * are captured alongside the real session and both make that replay worse:
 *
 *   ANALYTICS (`_ga`, `_fbp`, …) are dead weight. Nothing authenticates with
 *   them and they inflate the record the credential carries.
 *
 *   BOT MANAGEMENT (`ak_bmsc`, `bm_sv`, `_abck` — Akamai, which Myntra sits
 *   behind) is the one that bites. Those cookies encode the browser session
 *   they were minted in. Replayed by a different HTTP client they do not
 *   corroborate the request, they contradict it — the request now claims to be
 *   the browser Akamai fingerprinted, and is not — so the edge can answer as if
 *   nobody is signed in rather than rejecting outright.
 *
 * That matches the symptom exactly: a Myntra jar captured seconds earlier —
 * `_ga, _ga_CLQ5YK88VZ, _ga_NPDZHY82G1, ak_bmsc, bm_sv, erp.at, erp.rt,
 * session` — probes as anonymous with BOTH cookies Myntra authenticates with
 * present, while the same account's day-old jar, whose bot cookies have long
 * since lapsed, probes as live.
 *
 * ONLY FOR `name-value-map`. A `cookie-array` jar (AJIO) is rehydrated into a
 * real browser through CDP, where the bot-management cookies are consistent
 * with the client presenting them and dropping them would be the harmful move.
 */
const NOT_SESSION_COOKIES: readonly string[] = [
  // Akamai Bot Manager.
  'ak_bmsc',
  'bm_sv',
  'bm_mi',
  'bm_sz',
  '_abck',
  // Google Analytics, Ads, Tag Manager.
  '_ga',
  '_gid',
  '_gat',
  '_gac',
  // Meta, Hotjar, Microsoft Clarity.
  '_fbp',
  '_fbc',
  '_hj',
  '_clck',
  '_clsk'
]

/**
 * A prefix match, because the analytics families are per-property: one site
 * sets `_ga_CLQ5YK88VZ` and `_ga_NPDZHY82G1`, and naming them individually
 * would be a list that goes stale the next time a tag is added.
 */
export const isSessionCookie = (name: string): boolean =>
  !NOT_SESSION_COOKIES.some((prefix) => name === prefix || name.startsWith(`${prefix}_`))

export const shapeJar = (
  jar: HarvestedCookie[],
  format: string
): HarvestedCookie[] | Record<string, string> => {
  if (format === 'cookie-array') return jar

  // Later cookies win, matching how a browser resolves a duplicate name — and
  // how the server's own jars are built.
  return Object.fromEntries(
    jar.filter((cookie) => isSessionCookie(cookie.name)).map((cookie) => [cookie.name, cookie.value])
  )
}
