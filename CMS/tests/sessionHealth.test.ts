import { describe, expect, it } from 'vitest'
import type { SessionSummary } from '@shared/types/platformSession'
import { HEALTH_LABEL, healthOf, relativeTime, summarise } from '@shared/utils/sessionHealth'

const NOW = Date.parse('2026-08-29T12:00:00.000Z')

const session = (overrides: Partial<SessionSummary> = {}): SessionSummary => ({
  savedAt: '2026-08-29T09:00:00.000Z',
  expiresAt: '2026-09-05T09:00:00.000Z',
  ip: null,
  source: 'cms-desktop',
  hasProxySession: false,
  cookieNames: ['a', 'b', 'c'],
  rejectedAt: null,
  rejectedDetail: null,
  ...overrides
})

describe('healthOf', () => {
  it('reports no session when the credential has never been captured', () => {
    expect(healthOf(null, NOW)).toBe('none')
  })

  it('reports active for a session with plenty of life left', () => {
    expect(healthOf(session(), NOW)).toBe('active')
  })

  it('reports expired once the expiry has passed', () => {
    expect(healthOf(session({ expiresAt: '2026-08-29T11:59:00.000Z' }), NOW)).toBe('expired')
  })

  it('reports expiring inside the two-hour window', () => {
    // Still usable, but not long enough to trust with a batch.
    expect(healthOf(session({ expiresAt: '2026-08-29T13:30:00.000Z' }), NOW)).toBe('expiring')
  })

  it('treats the window boundary as expiring rather than active', () => {
    expect(healthOf(session({ expiresAt: '2026-08-29T14:00:00.000Z' }), NOW)).toBe('expiring')
  })

  it('treats a missing expiry as active rather than hiding a working session', () => {
    expect(healthOf(session({ expiresAt: null }), NOW)).toBe('active')
  })

  it('treats an unparseable expiry as active for the same reason', () => {
    expect(healthOf(session({ expiresAt: 'not-a-date' }), NOW)).toBe('active')
  })
})

describe('relativeTime', () => {
  it('describes a future time', () => {
    expect(relativeTime('2026-08-29T15:00:00.000Z', NOW)).toBe('in 3 hours')
  })

  it('describes a past time', () => {
    expect(relativeTime('2026-08-29T09:00:00.000Z', NOW)).toBe('3 hours ago')
  })

  it('switches to days beyond two', () => {
    expect(relativeTime('2026-09-01T12:00:00.000Z', NOW)).toBe('in 3 days')
  })

  it('uses minutes under an hour', () => {
    expect(relativeTime('2026-08-29T12:30:00.000Z', NOW)).toBe('in 30 minutes')
  })

  it('singularises a value of one', () => {
    expect(relativeTime('2026-08-29T13:00:00.000Z', NOW)).toBe('in 1 hour')
  })

  it('collapses sub-minute distances', () => {
    expect(relativeTime('2026-08-29T11:59:45.000Z', NOW)).toBe('just now')
  })

  it('returns unknown for a missing or unparseable value', () => {
    expect(relativeTime(null, NOW)).toBe('unknown')
    expect(relativeTime('nope', NOW)).toBe('unknown')
  })
})

describe('summarise', () => {
  it('counts active separately from everything needing attention', () => {
    expect(summarise(['active', 'active', 'expiring', 'expired', 'none'])).toEqual({
      active: 2,
      needsAttention: 3,
      total: 5
    })
  })

  it('handles an empty list', () => {
    expect(summarise([])).toEqual({ active: 0, needsAttention: 0, total: 0 })
  })

  it('counts a login the marketplace refused as needing attention', () => {
    // The banner counts these; the page summary once did not, and the two
    // disagreed about how many logins needed work.
    expect(summarise(['active', 'rejected'])).toEqual({ active: 1, needsAttention: 1, total: 2 })
  })
})

describe('what the badge is allowed to claim', () => {
  it('says Saved, not Active', () => {
    // "Active" reads as "this session works". Everything here has done is
    // compare two dates against an expiry the marketplace never gave us — a
    // Myntra jar sat inside its window and read Active while the portal
    // answered its probe anonymously. The label must not outrun the evidence.
    expect(HEALTH_LABEL.active).toBe('Saved')
  })

  it('still distinguishes the states worth acting on', () => {
    expect(HEALTH_LABEL.expiring).toBe('Expiring')
    expect(HEALTH_LABEL.expired).toBe('Expired')
    expect(HEALTH_LABEL.none).toBe('No login')
  })
})

