import { describe, expect, it } from 'vitest'
import {
  OFFSCREEN_X,
  placeView,
  sanitiseFormat,
  sanitiseLabel,
  sanitiseRect,
  sanitiseRequest
} from '@shared/vms/partnerVms'

/** What main accepts from the renderer, and where it draws the native view. */
describe('view bounds', () => {
  it('accepts four finite numbers with a positive size, rounded', () => {
    expect(sanitiseRect({ x: 260.4, y: 120.6, width: 900.2, height: 600.5 })).toEqual({ x: 260, y: 121, width: 900, height: 601 })
  })

  it('refuses junk', () => {
    expect(sanitiseRect(null)).toBeNull()
    expect(sanitiseRect({ x: 0, y: 0, width: 0, height: 10 })).toBeNull()
    expect(sanitiseRect({ x: 0, y: 0, width: Number.NaN, height: 10 })).toBeNull()
    expect(sanitiseRect({ x: '1', y: 0, width: 10, height: 10 })).toBeNull()
  })

  it('hides OFF-SCREEN AT FULL SIZE, never 0x0', () => {
    const rect = { x: 260, y: 120, width: 900, height: 600 }
    expect(placeView(rect, true)).toEqual(rect)
    expect(placeView(rect, false)).toEqual({ x: OFFSCREEN_X, y: 120, width: 900, height: 600 })
  })
})

describe('camera and request input', () => {
  it('keeps a usable format only', () => {
    expect(sanitiseFormat({ width: 1280, height: 720, frameRate: 29.97 })).toEqual({ width: 1280, height: 720, frameRate: 30 })
    expect(sanitiseFormat({ width: 1280 })).toBeNull()
    expect(sanitiseFormat(null)).toBeNull()
  })

  it('keeps a non-empty label only', () => {
    expect(sanitiseLabel('  USB Camera  ')).toBe('USB Camera')
    expect(sanitiseLabel('')).toBeNull()
    expect(sanitiseLabel(3)).toBeNull()
  })

  it('needs an AWB, defaults the order type and normalises the platform', () => {
    expect(sanitiseRequest({ awb: ' FMPP123 ', platform: ' Flipkart ' })).toEqual({ awb: 'FMPP123', orderType: 'Forward', platform: 'flipkart' })
    expect(sanitiseRequest({ awb: '', platform: 'flipkart' })).toBeNull()
    expect(sanitiseRequest('FMPP123')).toBeNull()
  })
})
