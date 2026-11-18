import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The release policy — `appsettings.cmsApp`, written in Trackvid-Monitor and
 * read here on every check.
 *
 * WHAT THIS PINS, and why each rule earned a test:
 *
 * 1. THE PATH. The app asked `{host}/cms/version` on the belief that
 *    Automated-Scripts served it. Nothing does — TrackVid-BE serves
 *    `/api/cms/version` — so every request 404'd. And because an unreachable
 *    feed is deliberately non-fatal, the entire policy layer was silently
 *    inert: nothing set in Monitor ever reached a machine, and no error was
 *    raised anywhere to say so. A path regression must fail loudly here
 *    instead, because it cannot fail anywhere else.
 *
 * 2. THE FORCE FLAG. `isForceFullyUpdate` arrives as `mandatory` and is the
 *    difference between a notice and a screen the operator cannot get past.
 *
 * 3. THE LINK. It reaches a shell that opens it, so only http(s) survives.
 */

interface FeedState {
  status: number
  contentType: string
  body: Record<string, unknown>
  throws: boolean
  requested: string[]
}

const state = vi.hoisted<FeedState>(() => ({
  status: 200,
  contentType: 'application/json',
  body: {},
  throws: false,
  requested: []
}))

vi.mock('@main/services/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))

vi.mock('@main/config/env', () => ({
  env: { releaseFeedUrl: 'https://example.invalid/api/cms/version' }
}))

vi.stubGlobal('fetch', (url: string) => {
  state.requested.push(String(url))

  if (state.throws) return Promise.reject(new Error('ENOTFOUND'))

  return Promise.resolve({
    ok: state.status >= 200 && state.status < 300,
    status: state.status,
    headers: { get: () => state.contentType },
    json: () => Promise.resolve(state.body)
  })
})

const { checkReleasePolicy } = await import('@main/services/releasePolicy.service')

const ok = (body: Record<string, unknown>): void => {
  state.status = 200
  state.contentType = 'application/json'
  state.throws = false
  state.body = body
}

beforeEach(() => {
  state.requested.length = 0
  ok({ success: true, versionName: '0.1.17', mandatory: false })
})

describe('where the policy is fetched from', () => {
  it('asks whatever env says, and asks exactly once', async () => {
    await checkReleasePolicy('0.1.16')

    // The URL itself is env's to get right — pinned against the REAL module in
    // releaseFeedUrl.test.ts, since `env` is mocked in this file and an
    // assertion on the path here would only be checking the mock.
    expect(state.requested).toHaveLength(1)
  })
})

describe('the force flag', () => {
  it('carries mandatory through when the policy sets it', async () => {
    ok({ success: true, versionName: '0.1.17', mandatory: true })

    expect(await checkReleasePolicy('0.1.16')).toMatchObject({
      minimumVersion: '0.1.17',
      mandatory: true
    })
  })

  it('is not mandatory when the policy does not say so', async () => {
    ok({ success: true, versionName: '0.1.17', mandatory: false })

    expect((await checkReleasePolicy('0.1.16'))?.mandatory).toBe(false)
  })

  it('treats a missing flag as optional, never as forced', async () => {
    // A field absent from an older server must not lock anybody out.
    ok({ success: true, versionName: '0.1.17' })

    expect((await checkReleasePolicy('0.1.16'))?.mandatory).toBe(false)
  })
})

describe('the manual download link', () => {
  it('passes an http(s) link through', async () => {
    ok({ success: true, versionName: '0.1.17', mandatory: true, link: 'https://example.invalid/app.exe' })

    expect((await checkReleasePolicy('0.1.16'))?.downloadUrl).toBe('https://example.invalid/app.exe')
  })

  it('refuses a link that is not http(s)', async () => {
    // It is handed to the shell to open. A `file:` URL arriving from a network
    // response is not something to pass to the operating system.
    ok({ success: true, versionName: '0.1.17', link: 'file:///etc/passwd' })

    expect((await checkReleasePolicy('0.1.16'))?.downloadUrl).toBeNull()
  })

  it('is null when no link is configured', async () => {
    expect((await checkReleasePolicy('0.1.16'))?.downloadUrl).toBeNull()
  })
})

describe('a feed that cannot be trusted is no policy at all', () => {
  it('returns null on a 404 rather than inventing one', async () => {
    state.status = 404

    expect(await checkReleasePolicy('0.1.16')).toBeNull()
  })

  it('returns null when the host answers HTML', async () => {
    // A dead tunnel, or an ngrok interstitial that slipped past the header.
    state.contentType = 'text/html'

    expect(await checkReleasePolicy('0.1.16')).toBeNull()
  })

  it('returns null when the network is unreachable', async () => {
    state.throws = true

    expect(await checkReleasePolicy('0.1.16')).toBeNull()
  })

  it('returns null when no version is configured', async () => {
    // An empty versionName means "no policy" — the app carries on unblocked.
    ok({ success: true, versionName: '', mandatory: true })

    expect(await checkReleasePolicy('0.1.16')).toBeNull()
  })
})
