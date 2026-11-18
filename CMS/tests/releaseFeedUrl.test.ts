import { describe, expect, it } from 'vitest'

/**
 * The release-policy URL, pinned against the REAL config module.
 *
 * THE BUG THIS EXISTS FOR. `RELEASE_FEED_PATH` was '/cms/version', on the
 * belief that Automated-Scripts served the policy beside latest.yml at the host
 * root. It does not, and never did — the endpoint is TrackVid-BE's, which
 * mounts `app.use("/api", routes)` and then `router.use("/cms", cmsRoutes)`.
 * Every check therefore 404'd.
 *
 * AND NOTHING SAID SO. An unreachable feed is deliberately non-fatal — "a dead
 * feed must never stop an update or the app from starting" — so the failure was
 * a debug-level warning and an inert policy layer. Versions set in
 * Trackvid-Monitor reached no machine, the force flag did nothing, and the only
 * symptom was an absence of behaviour.
 *
 * That is why this is asserted against the real `env` rather than a mock: a
 * mocked URL would pass while production asked the wrong host for ever.
 */

const { env } = await import('@main/config/env')

describe('the release policy URL', () => {
  it('points at the path TrackVid-BE serves', () => {
    expect(env.releaseFeedUrl).toMatch(/\/api\/cms\/version$/)
  })

  it('hangs off the release host, with no double slash', () => {
    expect(env.releaseFeedUrl).toBe(`${env.updateFeedUrl}/api/cms/version`)
    expect(env.releaseFeedUrl.replace(/^https?:\/\//, '')).not.toContain('//')
  })

  it('is absolute, so it can be fetched before anyone signs in', () => {
    // It is read at launch, ahead of the login screen — a relative path has
    // nothing to resolve against in the main process.
    expect(env.releaseFeedUrl).toMatch(/^https?:\/\//)
  })
})
