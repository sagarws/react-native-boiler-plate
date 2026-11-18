import { describe, expect, it } from 'vitest'
import {
  MIN_CLIP_MS,
  minimumRemainingMs,
  remainingSeconds,
  scanRefusedLogLine,
  scanRefusedMessage
} from '@shared/vms/partnerVmsMinClip'
import { BLOCKING_OVERLAY_SELECTOR, isBlockingOverlayOpen } from '@shared/vms/partnerVmsOverlay'

/** The 12-second minimum on mirror-enabled feeds (TrackVid-App 5138857). */
describe('minimum clip length', () => {
  it('counts down twelve seconds from our own start', () => {
    expect(MIN_CLIP_MS).toBe(12_000)
    expect(minimumRemainingMs(true, 1000, 1000)).toBe(12_000)
    expect(minimumRemainingMs(true, 1000, 6000)).toBe(7000)
    expect(minimumRemainingMs(true, 1000, 13_000)).toBe(0)
    expect(remainingSeconds(7000)).toBe(7)
    expect(remainingSeconds(6001)).toBe(7)
  })

  it('does not apply without the mirror, and fails open without a start time', () => {
    expect(minimumRemainingMs(false, 1000, 2000)).toBe(0)
    expect(minimumRemainingMs(true, null, 2000)).toBe(0)
  })

  it('tells the packer when to scan again, and logs which order blocked it', () => {
    expect(scanRefusedMessage(7)).toBe('Scan skipped — wait 7 more seconds, then scan again')
    expect(scanRefusedMessage(1)).toBe('Scan skipped — wait 1 more second, then scan again')
    expect(scanRefusedLogLine('AWB2', 'AWB1', 9)).toBe('[AWB2] Scan refused — AWB1 is still recording (9s left of its 12-second minimum).')
  })
})

/** The Flipkart page steps aside whenever a dialog / menu / popover is really open. */
describe('blocking overlay detection', () => {
  const el = (hidden: boolean, rects = 1) => ({
    closest: (selector: string) => (hidden && selector === '.MuiModal-hidden' ? {} : null),
    getClientRects: () => ({ length: rects })
  })
  const root = (...els: ReturnType<typeof el>[]) => ({
    querySelectorAll: (selector: string) => {
      expect(selector).toBe(BLOCKING_OVERLAY_SELECTOR)
      return els
    }
  })

  it('sees an open dialog, menu or popover', () => {
    expect(isBlockingOverlayOpen(root(el(false)))).toBe(true)
  })

  it('ignores none, closed (kept-mounted) and box-less ones', () => {
    expect(isBlockingOverlayOpen(root())).toBe(false)
    expect(isBlockingOverlayOpen(root(el(true)))).toBe(false)
    expect(isBlockingOverlayOpen(root(el(false, 0)))).toBe(false)
  })
})
