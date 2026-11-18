import { describe, expect, it } from 'vitest'
import type { FlipkartRequest } from '@shared/types/flipkartBackup'
import type { SnapdealRequest } from '@shared/types/snapdealBackup'
import {
  MAX_REPORT_REQUEST_ATTEMPTS,
  failedToRetry,
  isStaleRequest,
  isWindowCovered,
  nextAttempt,
  retryableFor
} from '@shared/utils/reportRequestRetry'

/**
 * A Snapdeal or Flipkart report request that failed is asked for again on the
 * next daily pass.
 *
 * It used to be stranded two ways: a failure fell out of the daily range once
 * a later window was stored, and a report Snapdeal never built stayed
 * "requested" — which counts as asked — forever.
 */

const DAY_MS = 24 * 60 * 60 * 1000

const request = (overrides: Partial<SnapdealRequest> = {}): SnapdealRequest => ({
  id: 'r1',
  requestId: '14254568',
  username: 'seller@example.com',
  report: 'return',
  from: '2026-10-01',
  to: '2026-10-07',
  status: 'failed',
  requestedAt: '2026-10-08T05:30:00.000Z',
  readyAt: null,
  storedAt: null,
  code: null,
  subArea: 'ReturnsAck',
  filename: null,
  rows: 0,
  added: 0,
  attempts: 1,
  error: 'Generate report refused: busy',
  ...overrides
})

describe('which failed windows are asked for again', () => {
  it('re-asks a refused window even when the range has moved past it', () => {
    const refused = request()
    const later = request({ id: 'r2', status: 'stored', from: '2026-10-08', to: '2026-10-14' })

    expect(failedToRetry([later, refused], '2026-05-01')).toEqual([refused])
  })

  it('gives up after the attempt limit', () => {
    const tired = request({ attempts: MAX_REPORT_REQUEST_ATTEMPTS })

    expect(failedToRetry([tired], '2026-05-01')).toEqual([])
    // …and the window then counts as answered, so the range does not ask either.
    expect(isWindowCovered({ from: '2026-10-01', to: '2026-10-07' }, [tired])).toBe(true)
  })

  it('does not re-ask a window a live request now covers', () => {
    const refused = request()
    const wider = request({ id: 'r2', status: 'requested', from: '2026-09-28', to: '2026-10-10' })

    expect(failedToRetry([wider, refused], '2026-05-01')).toEqual([])
  })

  it('collapses duplicate failures of one window onto the newest', () => {
    const older = request({ id: 'old', requestedAt: '2026-10-08T05:30:00.000Z' })
    const newer = request({ id: 'new', requestedAt: '2026-10-09T05:30:00.000Z', attempts: 2 })

    expect(failedToRetry([older, newer], '2026-05-01').map(record => record.id)).toEqual(['new'])
  })

  it('leaves windows older than retention alone', () => {
    expect(failedToRetry([request({ from: '2026-03-01', to: '2026-03-07' })], '2026-05-01')).toEqual([])
  })

  it('does not treat a still-retryable failure as covering its window', () => {
    expect(isWindowCovered({ from: '2026-10-01', to: '2026-10-07' }, [request()])).toBe(false)
  })
})

describe('asking again', () => {
  it('reuses the failed row for the same window, and counts the attempt', () => {
    const refused = request({ attempts: 2 })
    const now = new Date('2026-10-15T05:30:00.000Z')

    expect(retryableFor({ from: '2026-10-01', to: '2026-10-07' }, [refused])).toBe(refused)

    const again = nextAttempt(refused, now)

    expect(again).toMatchObject({
      id: 'r1',
      status: 'requested',
      attempts: 3,
      error: null,
      requestId: null,
      requestedAt: now.toISOString()
    })
  })
})

describe('a request Snapdeal never builds', () => {
  it('is stale after a day', () => {
    const asked = request({ status: 'requested', requestedAt: '2026-10-14T05:30:00.000Z' })

    expect(isStaleRequest(asked, new Date('2026-10-15T05:29:00.000Z'), DAY_MS)).toBe(false)
    expect(isStaleRequest(asked, new Date('2026-10-15T05:31:00.000Z'), DAY_MS)).toBe(true)
  })

  it('is never stale on an unreadable date', () => {
    expect(isStaleRequest({ requestedAt: 'not a date' }, new Date(), DAY_MS)).toBe(false)
  })
})

describe('Flipkart rows', () => {
  // Written before attempts were counted: no `attempts` field at all.
  const flipkart = (overrides: Partial<FlipkartRequest> = {}): FlipkartRequest => ({
    id: 'f1',
    requestId: 'REQ-1',
    username: 'seller@example.com',
    report: 'return',
    from: '2026-09-20',
    to: '2026-09-26',
    status: 'failed',
    requestedAt: '2026-09-27T05:30:00.000Z',
    storedAt: null,
    rows: 0,
    added: 0,
    error: 'Flipkart marked it FAILED',
    ...overrides
  })

  it('re-asks an old failure behind a stored window, reading a missing count as one', () => {
    const failed = flipkart()
    const later = flipkart({ id: 'f2', status: 'stored', from: '2026-10-01', to: '2026-10-14' })

    expect(failedToRetry([later, failed], '2026-05-01')).toEqual([failed])
    expect(nextAttempt(failed, new Date('2026-10-15T05:30:00.000Z'))).toMatchObject({
      id: 'f1',
      status: 'requested',
      requestId: null,
      attempts: 2
    })
  })

  it('gives up on a Flipkart window at the same limit', () => {
    expect(failedToRetry([flipkart({ attempts: MAX_REPORT_REQUEST_ATTEMPTS })], '2026-05-01')).toEqual([])
  })
})
