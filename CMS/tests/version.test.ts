import { describe, expect, it } from 'vitest'
import { compareVersions, isNewerVersion } from '@shared/utils/version'

describe('compareVersions', () => {
  it('orders by major, minor and patch', () => {
    expect(compareVersions('2.0.0', '1.9.9')).toBeGreaterThan(0)
    expect(compareVersions('1.2.0', '1.10.0')).toBeLessThan(0)
    expect(compareVersions('1.0.2', '1.0.10')).toBeLessThan(0)
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0)
  })

  it('ignores a leading v and surrounding whitespace', () => {
    expect(compareVersions(' v1.2.3 ', '1.2.3')).toBe(0)
  })

  it('ranks a pre-release below the matching release', () => {
    expect(compareVersions('1.2.0-beta.1', '1.2.0')).toBeLessThan(0)
    expect(compareVersions('1.2.0', '1.2.0-beta.1')).toBeGreaterThan(0)
    expect(compareVersions('1.2.0-alpha', '1.2.0-beta')).toBeLessThan(0)
  })

  it('treats an unparseable version as equal so a bad feed cannot nag users', () => {
    expect(compareVersions('1.0.0', 'latest')).toBe(0)
    expect(compareVersions('', '1.0.0')).toBe(0)
    expect(compareVersions('1.0', '1.0.0')).toBe(0)
  })
})

describe('isNewerVersion', () => {
  it('is true only when the candidate is strictly newer', () => {
    expect(isNewerVersion('0.1.0', '1.0.0')).toBe(true)
    expect(isNewerVersion('1.0.0', '1.0.0')).toBe(false)
    expect(isNewerVersion('1.0.1', '1.0.0')).toBe(false)
  })
})
