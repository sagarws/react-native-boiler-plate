/**
 * Does a cookie's domain belong to one the platform registry asked for?
 *
 * Pure and tested because getting it wrong is invisible. A filter that matches
 * nothing returns an empty jar, and an empty jar is indistinguishable from
 * "never signed in" — so a broken comparison here surfaces as an operator being
 * told their sign-in failed when it worked perfectly.
 *
 * The subtlety is the leading dot. A cookie set for a whole domain tree is
 * stored as `.ajio.com` by some Chromium versions and `ajio.com` by others,
 * while the registry writes it either way. They are the same domain to a cookie
 * store and different strings to `===`.
 */
export const domainMatches = (cookieDomain: string, wanted: string): boolean => {
  const actual = cookieDomain.replace(/^\./, '').toLowerCase().trim()
  const target = wanted.replace(/^\./, '').toLowerCase().trim()

  if (!actual || !target) return false

  // Exact host, or a subdomain of it. Never a suffix match on the bare string:
  // "notajio.com".endsWith("ajio.com") is true, and shipping a third party's
  // cookies to the backend as a seller session would be worse than none.
  return actual === target || actual.endsWith(`.${target}`)
}
