/**
 * A platform name as the registries key it.
 *
 * MIRRORS the core's `platformKey` in common/platforms.js, which is the source
 * of truth. The renderer cannot load the core — it decides what to render
 * before anything runs — and a test asserts the two agree.
 *
 * WHY IT IS NEEDED AT ALL, when every lookup already lower-cased: a platform
 * reaches this app three ways, and they do not agree on spelling.
 *
 *   - the claims grid's tabs are display LABELS ("Tata CliQ")
 *   - a claim row carries whatever TrackVid stored ("tata cliq", "Tata CliQ")
 *   - the registries and the credential documents key one word ("tatacliq")
 *
 * For "Myntra" and "Flipkart" lower-casing closed that gap. It stopped closing
 * it the moment a platform's name had a space in it: `canRefill('Tata CliQ')`
 * lower-cased to "tata cliq", matched nothing in REFILL_FIELDS, and the Refill
 * Data button simply did not render — and the same silence hid Map Username,
 * the claim runner lookup and the account field. Nothing errored; the features
 * were absent.
 *
 * SEPARATORS ARE DROPPED ONLY IF THE RESULT IS A PLATFORM WE KNOW, so an
 * unrecognised name comes back as itself rather than mangled into a key that
 * might collide with a real one.
 */

/** Every platform this app has a name for, including the non-automated tabs. */
const KNOWN = new Set([
  'ajio',
  'amazon',
  'd2c',
  'delhivery',
  'flipkart',
  'meesho',
  'myntra',
  'nykaa',
  'other',
  'shopify',
  'snapdeal',
  'tatacliq',
  'xbees'
])

/** Stored spellings that mean a platform already in that set. */
const ALIASES: Record<string, string> = {
  expressbees: 'xbees',
  xpressbees: 'xbees',
  naykaa: 'nykaa',
  nykaafashion: 'nykaa'
}

export const platformKey = (value: string): string => {
  const lower = String(value ?? '')
    .toLowerCase()
    .trim()

  if (ALIASES[lower]) return ALIASES[lower]
  if (KNOWN.has(lower)) return lower

  const squashed = lower.replace(/[\s._-]+/g, '')

  if (ALIASES[squashed]) return ALIASES[squashed]

  return KNOWN.has(squashed) ? squashed : lower
}

/** How each platform is written on screen — the marketplace's own spelling. */
const LABELS: Record<string, string> = {
  ajio: 'Ajio',
  amazon: 'Amazon',
  d2c: 'D2C',
  delhivery: 'Delhivery',
  flipkart: 'Flipkart',
  meesho: 'Meesho',
  myntra: 'Myntra',
  nykaa: 'Nykaa',
  other: 'Other',
  shopify: 'Shopify',
  snapdeal: 'Snapdeal',
  tatacliq: 'Tata CliQ',
  xbees: 'Xbees'
}

/**
 * The display name for whatever spelling a platform arrived in.
 *
 * Claims carry the stored value — "myntra", "tata cliq" — and messages built
 * from it read "myntra claim failed" beside a tab that says "Myntra". A name we
 * do not know comes back with its first letter raised rather than guessed at.
 */
export const platformLabel = (value: string): string => {
  const key = platformKey(value)

  if (LABELS[key]) return LABELS[key]

  const raw = String(value ?? '').trim()

  return raw ? raw.charAt(0).toUpperCase() + raw.slice(1) : raw
}
