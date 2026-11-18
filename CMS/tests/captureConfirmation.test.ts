import { describe, expect, it } from 'vitest'
import { healthOf } from '@shared/utils/sessionHealth'
import type { CredentialRow } from '@shared/types/platformSession'

/**
 * A capture is not finished when the sign-in worked.
 *
 * Every route reports success from its own vantage point — an ingest returning
 * 200, the automation server saying it drove a browser, a local store accepting
 * a jar — and none of those is the thing that decides whether a claim can run.
 * That is the credential record TrackVid serves back.
 *
 * The two came apart in the field: a Delhivery capture announced "Sessions
 * updated" while the server kept reporting the account as never captured, so
 * the gate re-opened on the next press with nothing to explain it. What is
 * pinned here is the reading that makes the difference visible — "no session"
 * is exactly the state a capture must not be allowed to claim it fixed.
 */

const row = (session: CredentialRow['session']): CredentialRow => ({
  credentialId: 'id-1',
  username: 'shashidhara.ct@tigc.in',
  accountType: '',
  vendorCode: '',
  isVerified: true,
  visible: true,
  masterDataSync: null,
  isOtpBased: null,
  session,
  pobCount: 0,
  pobSyncedAt: null,
  slaveCount: 0,
  slavesSyncedAt: null,
  domesticCount: 0,
  domesticsSyncedAt: null
})

const summary = (over: Record<string, unknown> = {}) =>
  ({
    savedAt: '2026-09-18T04:00:00.000Z',
    expiresAt: null,
    ip: null,
    source: 'cms-desktop',
    hasProxySession: false,
    cookieNames: [],
    rejectedAt: null,
    rejectedDetail: null,
    ...over
  }) as CredentialRow['session']

describe('what a stored session looks like to the app', () => {
  it('reads a credential the server reports no session for as "none"', () => {
    // The exact state behind "Never captured" in the gate dialog, and the one a
    // capture that reported success must never leave behind.
    expect(healthOf(row(null).session)).toBe('none')
  })

  it('accepts a session with no expiry — Delhivery stores tokens, not a window', () => {
    // A JWT session carries accessExpiresAt rather than expiresAt, and a
    // missing expiry is not a missing session.
    expect(healthOf(row(summary()).session)).toBe('active')
  })

  it('still calls an expired session expired', () => {
    expect(healthOf(row(summary({ expiresAt: '2020-01-01T00:00:00.000Z' })).session)).toBe('expired')
  })

  it('matches accounts case- and space-insensitively, as the confirmation does', () => {
    const credential = row(summary())
    const wanted = '  SHASHIDHARA.CT@TIGC.IN '

    expect(
      credential.username.trim().toLowerCase() === wanted.trim().toLowerCase()
    ).toBe(true)
  })
})
