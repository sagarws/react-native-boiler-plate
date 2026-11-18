import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * When an update fails, the message has one job: name the host that would not
 * answer.
 *
 * It did not. The host came from `autoUpdater.getFeedURL()`, which electron-
 * updater deprecated — it returns the literal string "Deprecated. Do not use
 * it.", and the old guard only checked for empty. So an operator whose release
 * host was missing `latest.yml` was told:
 *
 *   No update manifest found at Deprecated. Do not use it..
 *
 * The one line meant to say which host was wrong printed a library's
 * deprecation notice at exactly the moment somebody needed the host.
 */

const feed = 'https://releases.example.com'

vi.mock('electron', () => ({ app: { getVersion: () => '0.1.16', isPackaged: true } }))
vi.mock('@main/config/env', () => ({ env: { updateFeedUrl: feed } }))
vi.mock('@main/services/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))
vi.mock('@main/services/releasePolicy.service', () => ({ checkReleasePolicy: vi.fn() }))
vi.mock('@main/ipc/broadcast', () => ({ broadcast: vi.fn() }))
vi.mock('electron-updater', () => ({
  default: {
    autoUpdater: {
      // The deprecation string the real library returns. If this test ever
      // fails because the method is gone, delete the mock — not the guard.
      getFeedURL: () => 'Deprecated. Do not use it.',
      on: vi.fn(),
      autoDownload: false,
      autoInstallOnAppQuit: false,
      logger: null
    }
  }
}))

const { describeUpdateFailure } = await import('@main/services/updater.service')

beforeEach(() => vi.clearAllMocks())

describe('the message when an update cannot be fetched', () => {
  it('names the configured host when the manifest is missing', () => {
    const message = describeUpdateFailure(new Error('HttpError: 404 Not Found'))

    expect(message).toContain(feed)
    expect(message).toMatch(/latest\.yml/)
  })

  it('never repeats electron-updater’s deprecation notice', () => {
    for (const error of [
      new Error('HttpError: 404'),
      new Error('Cannot parse the response'),
      new Error('ENOTFOUND releases.example.com')
    ]) {
      expect(describeUpdateFailure(error)).not.toMatch(/deprecated/i)
    }
  })

  it('names the host for an unreachable one too, and says so differently', () => {
    // "Nothing is published there" and "nothing answered" need different
    // actions — upload the manifest, or look at the network.
    const message = describeUpdateFailure(new Error('connect ECONNREFUSED 10.0.0.1:443'))

    expect(message).toContain(feed)
    expect(message).toMatch(/cannot reach/i)
  })

  it('falls back to plain words rather than an empty gap in the sentence', () => {
    // A failure this does not recognise must not produce "No update manifest
    // found at ." — it says what it knows instead.
    expect(describeUpdateFailure(new Error('something nobody has seen before'))).not.toMatch(/ at \./)
  })
})
