/**
 * Did a scripted marketplace sign-in work?
 *
 * The URL half of the decision, kept pure and separate from the driver because
 * getting it wrong is the expensive failure: a `success` rule expressed as "the
 * URL no longer contains /login" will happily match an error page that
 * redirected somewhere else, and report a rejected sign-in as a good one. The
 * cost of that is a session that was never captured, silently.
 */

export interface LoginOutcomeMatch {
  anySelector?: string[]
  urlIncludes?: string[]
  urlExcludes?: string[]
}

/** A URL that is not yet a real page — a window that has not navigated. */
const isBlank = (url: string): boolean => !url || url === 'about:blank'

/**
 * Whether `url` satisfies the URL part of a match.
 *
 * `urlIncludes` is positive evidence and needs only one hit. `urlExcludes` is
 * the absence of evidence, so it is only trusted once the window has actually
 * gone somewhere — otherwise the blank page a window starts on satisfies
 * "does not contain /login" and the sign-in reports success before the form
 * has even been submitted.
 *
 * Selector-based matching is not here: it needs the live document, so the
 * driver does it.
 */
export const urlMatches = (url: string, match: LoginOutcomeMatch | undefined): boolean => {
  if (!match) return false

  if (match.urlIncludes?.some(fragment => url.includes(fragment))) return true

  if (match.urlExcludes && !isBlank(url)) {
    return !match.urlExcludes.some(fragment => url.includes(fragment))
  }

  return false
}
