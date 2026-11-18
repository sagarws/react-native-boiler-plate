import type { MirrorFailureReason, MirrorState } from '@shared/vms/partnerVms'

/**
 * Copy for the mirror's chip, rail dot and packer-facing failure toasts —
 * TrackVid-App's `mirrorPresentation` and `failureMessage`, word for word.
 * Colours are theme tones, not hex: the chip resolves them to palette vars.
 * Pure, so tests/vms/partnerVms covers it.
 */
export type MirrorTone = 'success' | 'error' | 'warning' | 'neutral'

export interface MirrorPresentation {
  tone: MirrorTone
  label: string
  /** Set when something needs the packer's attention: the instruction to fix it. */
  nudge?: string
}

export const mirrorPresentation = (state: MirrorState): MirrorPresentation => {
  switch (state) {
    case 'READY':
      return { tone: 'success', label: 'Ready' }
    case 'MIRRORING':
      return { tone: 'error', label: 'Recording' }
    case 'BOOTING':
      return { tone: 'neutral', label: 'Starting…' }
    case 'LOGGED_OUT':
      return {
        tone: 'neutral',
        label: 'Signed out',
        nudge: 'Flipkart mirror signed out — open the Flipkart VMS tab to log in.'
      }
    case 'WRONG_SCREEN':
      return {
        tone: 'warning',
        label: 'Wrong page',
        nudge: 'Flipkart VMS is on another page — open the tab and go to Operator → VMS, then connect your feed.'
      }
    case 'NOT_CONNECTED':
      return {
        tone: 'warning',
        label: 'Feed not connected',
        nudge: 'Flipkart mirror not connected — open the Flipkart VMS tab and connect your desk feed.'
      }
    case 'DEGRADED':
      return {
        tone: 'warning',
        label: 'Page not recognised',
        nudge: 'Flipkart mirror paused — the VMS page has changed. Recording in TrackVid continues.'
      }
    default:
      return { tone: 'neutral', label: 'Off' }
  }
}

/** The tooltip on the chip: the fix when there is one, otherwise what it means. */
export const mirrorExplanation = (state: MirrorState): string => {
  const { label, nudge } = mirrorPresentation(state)
  if (nudge) return nudge
  return state === 'MIRRORING'
    ? 'Flipkart VMS is recording this order alongside TrackVid.'
    : `Flipkart mirror: ${label}. TrackVid records every order either way.`
}

/**
 * What to tell the packer when a Flipkart order did not mirror. Every message
 * says what to do, and that TrackVid itself still recorded — the packer must
 * never think they have lost the order. Null: nothing worth saying.
 */
export const failureMessage = (
  state?: MirrorState | (string & {}),
  reason?: MirrorFailureReason | (string & {})
): string | null => {
  // Reason first: a superseded order was skipped on purpose.
  if (reason === 'superseded') {
    return 'Scanned too quickly for Flipkart VMS — this parcel was NOT recorded there. TrackVid recorded it normally. Leave a few seconds between scans if you need the Flipkart copy.'
  }

  switch (state) {
    case 'LOGGED_OUT':
      return 'Flipkart VMS is signed out — open the Flipkart VMS tab and log in. This order was NOT recorded in Flipkart VMS. TrackVid recorded it normally.'
    case 'WRONG_SCREEN':
      return 'Flipkart VMS is on another page — open the Flipkart VMS tab and go to Operator → VMS, then connect your desk feed. This order was NOT recorded in Flipkart VMS. TrackVid recorded it normally.'
    case 'NOT_CONNECTED':
      return 'Flipkart VMS feed is not connected — open the Flipkart VMS tab and connect your desk feed. This order was NOT recorded in Flipkart VMS. TrackVid recorded it normally.'
    case 'DEGRADED':
      return 'Flipkart VMS page was not recognised — open the Flipkart VMS tab and check it. This order was NOT recorded in Flipkart VMS. TrackVid recorded it normally.'
    case 'BOOTING':
      return 'Flipkart VMS is still starting up. This order was NOT recorded in Flipkart VMS. TrackVid recorded it normally.'
    default:
      // 'disabled' means the platform is simply not mirrored — not a problem.
      return reason === 'disabled' ? null : 'This order was NOT recorded in Flipkart VMS. TrackVid recorded it normally.'
  }
}

/**
 * TrackVid-App gave each failure toast a fixed id per state so a repeat
 * replaced the last one instead of stacking over a shift. The CMS toast has no
 * ids, so the same key is simply not shown again within this window.
 */
export const FAILURE_TOAST_REPEAT_MS = 8000

export const shouldShowFailureToast = (
  key: string,
  now: number,
  lastShown: ReadonlyMap<string, number>
): boolean => {
  const previous = lastShown.get(key)
  return previous === undefined || now - previous >= FAILURE_TOAST_REPEAT_MS
}
