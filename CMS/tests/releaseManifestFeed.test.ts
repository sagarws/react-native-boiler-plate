import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The release policy can move a shipped build's update feed.
 *
 * WHY IT HAS TO. `app-update.yml` is written when the installer is built and is
 * permanent for every copy from it. A release uploaded anywhere that host does
 * not serve is one no installed machine can fetch — and the channel for telling
 * them the new address is the very thing that broke. The policy feed is the
 * one they still read, so the manifest link travels on it.
 *
 * WHAT IS PINNED HERE is the translation, because electron-updater wants the
 * DIRECTORY and the channel, not the file: it appends `<channel>.yml` itself,
 * and it fetches the installer named inside relative to that same directory.
 * Getting this wrong replaces a feed that might work with one that certainly
 * cannot, which is why a link it cannot read is ignored rather than used.
 */

const calls = vi.hoisted(() => ({ feeds: [] as unknown[] }))

const state = vi.hoisted(() => ({
  policy: null as { minimumVersion: string; mandatory: boolean; downloadUrl: string | null; manifestUrl: string | null } | null
}))

vi.mock('electron', () => ({ app: { getVersion: () => '0.1.16', isPackaged: false } }))
vi.mock('@main/config/env', () => ({ env: { updateFeedUrl: 'https://baked-in.example.com' } }))
vi.mock('@main/services/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))
vi.mock('@main/ipc/broadcast', () => ({ broadcast: vi.fn() }))
vi.mock('@main/services/releasePolicy.service', () => ({
  checkReleasePolicy: () => Promise.resolve(state.policy)
}))
vi.mock('electron-updater', () => ({
  default: {
    autoUpdater: {
      setFeedURL: (config: unknown) => calls.feeds.push(config),
      checkForUpdates: () => Promise.resolve(null),
      on: vi.fn(),
      autoDownload: false,
      autoInstallOnAppQuit: false,
      logger: null
    }
  }
}))

const { checkForUpdates } = await import('@main/services/updater.service')

const policy = (manifestUrl: string | null) => ({
  minimumVersion: '0.1.17',
  mandatory: true,
  downloadUrl: null,
  manifestUrl
})

beforeEach(() => {
  calls.feeds.length = 0
  state.policy = null
})

describe('a manifest link on the release policy', () => {
  it('becomes the directory it sits in, plus the channel named by the file', async () => {
    state.policy = policy('https://releases.example.com/cms/latest.yml')

    await checkForUpdates()

    expect(calls.feeds).toEqual([
      { provider: 'generic', url: 'https://releases.example.com/cms', channel: 'latest' }
    ])
  })

  it('works at a host root, where the directory is the host itself', async () => {
    state.policy = policy('https://releases.example.com/latest.yml')

    await checkForUpdates()

    expect(calls.feeds).toEqual([
      { provider: 'generic', url: 'https://releases.example.com', channel: 'latest' }
    ])
  })

  it('keeps a non-default channel, since that is what names the file', async () => {
    state.policy = policy('https://releases.example.com/beta.yml')

    await checkForUpdates()

    expect(calls.feeds[0]).toMatchObject({ channel: 'beta' })
  })

  it('leaves the baked-in feed alone when the policy names none', async () => {
    state.policy = policy(null)

    await checkForUpdates()

    expect(calls.feeds).toEqual([])
  })

  it('ignores a link it cannot read as a feed', async () => {
    // A share page or a folder. Pointing the updater at one replaces a feed
    // that might work with one that certainly cannot.
    for (const bad of ['not a url at all', 'https://drive.google.com/file/d/abc/view']) {
      calls.feeds.length = 0
      state.policy = policy(bad)

      await checkForUpdates()

      expect(calls.feeds, bad).toEqual([])
    }
  })
})
