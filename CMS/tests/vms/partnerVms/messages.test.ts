import { describe, expect, it } from 'vitest'
import { notMirroredLine } from '@main/vms/partnerVms/messages'
import {
  FAILURE_TOAST_REPEAT_MS,
  failureMessage,
  mirrorExplanation,
  mirrorPresentation,
  shouldShowFailureToast
} from '@shared/vms/partnerVmsPresentation'
import { MIRROR_STATES } from '@shared/vms/partnerVms'

/** Packer-facing copy: every failure says what to do AND that TrackVid still recorded. */
describe('failure toasts', () => {
  it('names the fix per state and always reassures', () => {
    for (const state of ['LOGGED_OUT', 'WRONG_SCREEN', 'NOT_CONNECTED', 'DEGRADED', 'BOOTING', 'READY']) {
      const message = failureMessage(state, 'not_ready')
      expect(message).toMatch(/TrackVid recorded it normally/)
      expect(message).toMatch(/NOT recorded/)
    }
    expect(failureMessage('LOGGED_OUT')).toMatch(/log in/)
    expect(failureMessage('NOT_CONNECTED')).toMatch(/connect your desk feed/)
  })

  it('explains a superseded order by its reason, whatever the state', () => {
    expect(failureMessage('READY', 'superseded')).toMatch(/^Scanned too quickly for Flipkart VMS/)
  })

  it('says nothing for a platform that is simply not mirrored', () => {
    expect(failureMessage('DISABLED', 'disabled')).toBeNull()
    expect(failureMessage(undefined, 'disabled')).toBeNull()
  })

  it('does not repeat the same toast within the window', () => {
    const shown = new Map([['LOGGED_OUT', 1000]])
    expect(shouldShowFailureToast('LOGGED_OUT', 1000 + FAILURE_TOAST_REPEAT_MS - 1, shown)).toBe(false)
    expect(shouldShowFailureToast('LOGGED_OUT', 1000 + FAILURE_TOAST_REPEAT_MS, shown)).toBe(true)
    expect(shouldShowFailureToast('NOT_CONNECTED', 1001, shown)).toBe(true)
  })
})

describe('chip presentation', () => {
  it('has a label for every state, red while recording, a nudge where action is needed', () => {
    for (const state of MIRROR_STATES) expect(mirrorPresentation(state).label).toBeTruthy()
    expect(mirrorPresentation('MIRRORING').tone).toBe('error')
    expect(mirrorPresentation('READY')).toEqual({ tone: 'success', label: 'Ready' })
    for (const state of ['LOGGED_OUT', 'WRONG_SCREEN', 'NOT_CONNECTED', 'DEGRADED'] as const) {
      expect(mirrorPresentation(state).nudge).toBeTruthy()
      expect(mirrorExplanation(state)).toBe(mirrorPresentation(state).nudge)
    }
    expect(mirrorExplanation('READY')).toMatch(/TrackVid records every order either way/)
  })
})

describe('order log line', () => {
  it('is keyed by AWB and names the reason and the fix', () => {
    const line = notMirroredLine('FMPP123', { ok: false, reason: 'record_not_started', state: 'READY' })
    expect(line.startsWith('[FMPP123] Not mirrored to Flipkart VMS')).toBe(true)
    expect(line).toMatch(/rejected the number/)
    expect(line).toMatch(/TrackVid recorded it normally\.$/)
    expect(notMirroredLine('X', { ok: false, reason: 'not_ready', state: 'LOGGED_OUT' })).toMatch(/log in on the Flipkart VMS tab/)
  })
})
