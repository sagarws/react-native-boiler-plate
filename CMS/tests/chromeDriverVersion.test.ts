import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => '' } }))
vi.mock('../electron/main/services/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}))

const {
  activeChromeVersion,
  driverBuildCandidates,
  driverBuildsOnDisk,
  staleDriverDirectories,
  parseDriverVersion
} = await import(
  '../electron/main/services/browserProvision.service'
)

describe('activeChromeVersion', () => {
  it('picks the highest version directory, compared numerically', () => {
    expect(
      activeChromeVersion(['152.0.7300.85', '152.0.7300.100', 'chrome.exe', 'SetupMetrics'])
    ).toBe('152.0.7300.100')
  })

  it('picks the running version, not the staged one, while an update waits for a restart', () => {
    expect(
      activeChromeVersion(['154.0.7900.20', '155.0.8059.85', 'chrome.exe', 'new_chrome.exe'])
    ).toBe('154.0.7900.20')
  })

  it('reads a lone directory as the version even with an update flag', () => {
    expect(activeChromeVersion(['155.0.8059.85', 'new_chrome.exe'])).toBe('155.0.8059.85')
  })

  it('answers null when there is no version directory', () => {
    expect(activeChromeVersion(['chrome.exe'])).toBeNull()
  })
})

describe('driverBuildCandidates', () => {
  it('never asks for the full version, which resolveBuildId passes through unchecked', () => {
    expect(driverBuildCandidates('141.0.7390.123')).toEqual(['141.0.7390', '141'])
  })
})

describe('driverBuildsOnDisk', () => {
  const listing = [
    '.metadata',
    'win64-131.0.6778.108',
    'win64-155.0.8059.80',
    'win64-156.0.8078.9',
    'win64-156.0.8078.47',
    'win64-import-1761550000000',
    'mac-arm64-156.0.8078.60',
    '156.0.8078.47-chromedriver-win64.zip'
  ]

  it('lists every build of the same major for this platform, newest first', () => {
    expect(driverBuildsOnDisk(listing, 'win64', '156')).toEqual(['156.0.8078.47', '156.0.8078.9'])
  })

  it('does not match a longer major that shares the prefix', () => {
    expect(driverBuildsOnDisk(['win64-1560.0.1.2'], 'win64', '156')).toEqual([])
  })

  it('answers empty when nothing for that major is there', () => {
    expect(driverBuildsOnDisk(listing, 'win64', '157')).toEqual([])
  })
})

describe('staleDriverDirectories', () => {
  it('names older majors only, never the pinned build or anything not a build', () => {
    expect(
      staleDriverDirectories(
        [
          '.metadata',
          'win64-131.0.6778.108',
          'win64-154.0.8037.59',
          'win64-155.0.8059.80',
          'win64-156.0.8078.47',
          'win64-import-1761550000000',
          'mac-arm64-150.0.1.2'
        ],
        'win64',
        '156',
        '131.0.6778.108'
      )
    ).toEqual(['win64-154.0.8037.59', 'win64-155.0.8059.80'])
  })
})

describe('parseDriverVersion', () => {
  it('reads the version chromedriver prints', () => {
    expect(
      parseDriverVersion(
        'ChromeDriver 156.0.8078.47 (1d17a2e2ee147bb7d6ae2ab6abdb3a2510c17775-refs/branch-heads/8078@{#1313})'
      )
    ).toBe('156.0.8078.47')
  })

  it('answers null for anything else', () => {
    expect(parseDriverVersion('Google Chrome 156.0.8078.48')).toBeNull()
  })
})
