import { describe, expect, it } from 'vitest'
import { DEFAULT_FLOW, flowOrigin, shouldMirror } from '@main/vms/partnerVms/flowConfig'
import { MIRRORED_PLATFORMS, normalisePlatform } from '@shared/vms/partnerVms'

/**
 * The Flipkart VMS mirror's flow config and platform rule, ported from
 * TrackVid-App @ c188745. The selectors and timings were measured on the live
 * page there; these tests pin them so a port cannot quietly drift.
 */
describe('partner VMS flow config', () => {
  it('drives the operator screen on fkvms with the measured timings', () => {
    expect(DEFAULT_FLOW.url).toBe('https://fkvms.synlabs.io/index.html#/operator/vms')
    expect(DEFAULT_FLOW.route).toBe('#/operator/vms')
    expect(DEFAULT_FLOW.url.endsWith(DEFAULT_FLOW.route)).toBe(true)
    expect(flowOrigin(DEFAULT_FLOW)).toBe('https://fkvms.synlabs.io')
    expect(DEFAULT_FLOW.entryMethod).toBe('insertText')
    expect(DEFAULT_FLOW.parkStrategy).toBe('stopButton')
    expect(DEFAULT_FLOW.timings).toEqual({ probeMs: 3000, settleMs: 400, parkConfirmMs: 15000, recordConfirmMs: 8000 })
  })

  it('keeps Record off the icon-only scan button that shares its classes', () => {
    expect(DEFAULT_FLOW.selectors.recordButton).toContain(':not(.ant-btn-icon-only)')
    expect(DEFAULT_FLOW.selectors.stopButton).toContain(':not(.ant-btn-icon-only)')
    expect(DEFAULT_FLOW.selectors.orderTypeToggle).toEqual({ scope: 'span.ant-typography', anyOf: ['Forward', 'Return'] })
  })
})

describe('shouldMirror', () => {
  it('mirrors Flipkart and Myntra only', () => {
    expect([...MIRRORED_PLATFORMS].sort()).toEqual(['flipkart', 'myntra'])
    expect(shouldMirror('Flipkart')).toBe(true)
    expect(shouldMirror('myntra')).toBe(true)
    expect(shouldMirror('Meesho')).toBe(false)
    expect(shouldMirror('Amazon')).toBe(false)
  })

  it('matches on words, so configured variants still mirror', () => {
    expect(shouldMirror('Myntra PPMP')).toBe(true)
    expect(shouldMirror('Flipkart Forward')).toBe(true)
    expect(shouldMirror('MYNTRA (M-Now)')).toBe(true)
    expect(shouldMirror('  flipkart  ')).toBe(true)
  })

  it('does not match a platform that merely contains the letters', () => {
    expect(shouldMirror('flipkartish')).toBe(false)
    expect(shouldMirror('notmyntra')).toBe(false)
  })

  it('treats nothing as not mirrored', () => {
    expect(shouldMirror('')).toBe(false)
    expect(shouldMirror(null)).toBe(false)
    expect(shouldMirror(undefined)).toBe(false)
    expect(normalisePlatform('  Flipkart ')).toBe('flipkart')
  })
})
