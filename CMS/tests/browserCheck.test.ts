import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => '' } }))
vi.mock('../electron/main/services/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}))

const { runBrowserCheck } = await import('../electron/main/services/browserCheck.service')

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const now = () => new Date('2026-10-15T00:00:00.000Z')

describe('runBrowserCheck', () => {
  it('reports Chrome and driver ready', async () => {
    const result = await runBrowserCheck({
      findChrome: () => CHROME,
      versionOf: () => Promise.resolve('152.0.7300.12'),
      driverFor: () => Promise.resolve('C:\\cache\\chromedriver.exe'),
      downloadUrlFor: vi.fn(),
      now
    })

    expect(result).toEqual({
      success: true,
      data: {
        chrome: { found: true, path: CHROME, version: '152.0.7300.12' },
        driver: { ready: true, downloadUrl: null },
        checkedAt: '2026-10-15T00:00:00.000Z'
      }
    })
  })

  it('reports a missing Chrome without asking for a driver', async () => {
    const driverFor = vi.fn()
    const result = await runBrowserCheck({
      findChrome: () => null,
      versionOf: vi.fn(),
      driverFor,
      downloadUrlFor: vi.fn(),
      now
    })

    expect(result.success && result.data.chrome.found).toBe(false)
    expect(result.success && result.data.driver.ready).toBe(false)
    expect(driverFor).not.toHaveBeenCalled()
  })

  it('reports a missing driver, with the exact archive to download', async () => {
    const url = 'https://storage.googleapis.com/chrome-for-testing-public/152.0.7300.12/win64/chromedriver-win64.zip'
    const result = await runBrowserCheck({
      findChrome: () => CHROME,
      versionOf: () => Promise.resolve('152.0.7300.12'),
      driverFor: () => Promise.resolve(null),
      downloadUrlFor: () => Promise.resolve(url),
      now
    })

    expect(result.success && result.data.chrome.found).toBe(true)
    expect(result.success && result.data.driver).toEqual({ ready: false, downloadUrl: url })
  })

  it('never throws when a step fails', async () => {
    const result = await runBrowserCheck({
      findChrome: () => CHROME,
      versionOf: () => Promise.reject(new Error('EACCES')),
      driverFor: () => Promise.resolve('unused'),
      downloadUrlFor: () => Promise.resolve('unused'),
      now
    })

    expect(result.success).toBe(true)
    expect(result.success && result.data.driver.ready).toBe(false)
  })
})
