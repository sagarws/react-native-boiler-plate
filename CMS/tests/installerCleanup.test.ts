import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Settings → "Delete old installers" removes files from the operator's own
 * Downloads folder with no confirm step, so the name check is the only thing
 * standing between the button and somebody else's file.
 */

const unlink = vi.fn<(path: string) => Promise<void>>()
const files = new Map<string, { isFile: boolean; size: number }>()

vi.mock('electron', () => ({
  app: { getPath: () => 'DOWNLOADS' }
}))
vi.mock('@main/services/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn() } }))
vi.mock('@main/config/env', () => ({
  env: { installerReportUrl: 'https://report.test/api/installer-cleanup' }
}))
vi.mock('@main/services/company.store', () => ({
  readCompany: () => Promise.resolve({ company: { name: ' Acme Pvt Ltd ' }, fetchedAt: '' })
}))
vi.mock('node:fs/promises', () => ({
  readdir: () =>
    Promise.resolve([...files].map(([name, file]) => ({ name, isFile: () => file.isFile }))),
  unlink: (path: string) => unlink(path),
  stat: (path: string) => Promise.resolve({ size: files.get(path.split(/[\\/]/).pop() ?? '')?.size ?? 0 })
}))

const { isCmsInstaller, deleteDownloadedInstallers, cleanUpInstallersAtLaunch } = await import('@main/services/installerCleanup.service')

describe('isCmsInstaller', () => {
  it.each([
    'TrackVid-CMS-x64-setup.exe',
    'TrackVid-CMS-x64-setup (1).exe',
    'TrackVid CMS Setup 0.0.5.exe',
    'trackvid_cms.EXE',
    'TrackVidCMS-arm64-setup.exe'
  ])('matches %s', (name) => expect(isCmsInstaller(name)).toBe(true))

  it.each([
    'TrackVid-CMS-x64-setup.exe.blockmap',
    'TrackVid-CMS-x64-setup.dmg',
    'TrackVid-Monitor-setup.exe',
    'chrome-setup.exe',
    'cms-trackvid.exe',
    'notes about TrackVid CMS.txt'
  ])('leaves %s alone', (name) => expect(isCmsInstaller(name)).toBe(false))
})

describe('deleteDownloadedInstallers', () => {
  beforeEach(() => {
    files.clear()
    unlink.mockReset().mockResolvedValue(undefined)
  })

  it('deletes only matching regular files, and reports the ones that would not go', async () => {
    files.set('TrackVid-CMS-x64-setup.exe', { isFile: true, size: 100 })
    files.set('TrackVid-CMS-x64-setup (1).exe', { isFile: true, size: 200 })
    files.set('TrackVid-CMS-folder.exe', { isFile: false, size: 0 })
    files.set('other-setup.exe', { isFile: true, size: 50 })
    unlink.mockImplementation((path) =>
      path.includes('(1)') ? Promise.reject(new Error('locked')) : Promise.resolve()
    )

    const result = await deleteDownloadedInstallers()

    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data.removed.map((file) => file.name)).toEqual(['TrackVid-CMS-x64-setup.exe'])
    expect(result.data.failed).toEqual([{ name: 'TrackVid-CMS-x64-setup (1).exe', reason: 'locked' }])
    expect(unlink).toHaveBeenCalledTimes(2)
  })

  it('does nothing when there is nothing to delete', async () => {
    files.set('other-setup.exe', { isFile: true, size: 50 })

    const result = await deleteDownloadedInstallers()

    expect(result.success && result.data).toEqual({ removed: [], failed: [] })
    expect(unlink).not.toHaveBeenCalled()
  })
})

describe('cleanUpInstallersAtLaunch', () => {
  const fetchMock = vi.fn<typeof fetch>()

  beforeEach(() => {
    files.clear()
    unlink.mockReset().mockResolvedValue(undefined)
    fetchMock.mockReset().mockResolvedValue(new Response('{}', { status: 201 }))
    vi.stubGlobal('fetch', fetchMock)
  })

  it('reports the company and how many went, once, when something was deleted', async () => {
    files.set('TrackVid-CMS-x64-setup.exe', { isFile: true, size: 100 })
    files.set('TrackVid-CMS-x64-setup (1).exe', { isFile: true, size: 100 })

    await cleanUpInstallersAtLaunch()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe('https://report.test/api/installer-cleanup')
    expect(JSON.parse(init?.body as string)).toEqual({ companyName: 'Acme Pvt Ltd', deletedCount: 2 })
  })

  it('sends nothing when nothing was deleted', async () => {
    files.set('other-setup.exe', { isFile: true, size: 50 })

    await cleanUpInstallersAtLaunch()

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('sends nothing when every delete failed', async () => {
    files.set('TrackVid-CMS-x64-setup.exe', { isFile: true, size: 100 })
    unlink.mockRejectedValue(new Error('locked'))

    await cleanUpInstallersAtLaunch()

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('never throws when the report server is down', async () => {
    files.set('TrackVid-CMS-x64-setup.exe', { isFile: true, size: 100 })
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'))

    await expect(cleanUpInstallersAtLaunch()).resolves.toBeUndefined()
  })
})
