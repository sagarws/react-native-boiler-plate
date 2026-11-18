import { describe, expect, it } from 'vitest'
import type { CredentialRow, PlatformCredentials, SessionSummary } from '@shared/types/platformSession'
import { inactiveAccounts } from '@shared/utils/sessionPreflight'

/**
 * Create Ticket's check before it starts: every account the selection files from
 * must have a live session — by the same rule the stale-session banner uses.
 */

const NOW = Date.parse('2026-09-15T10:00:00.000Z')

const session = (expiresAt: string | null): SessionSummary => ({
  savedAt: '2026-09-15T00:00:00.000Z',
  expiresAt,
  ip: null,
  source: null,
  hasProxySession: false,
  cookieNames: [],
  rejectedAt: null,
  rejectedDetail: null
})

const credential = (username: string, s: SessionSummary | null): CredentialRow =>
  ({ credentialId: `id-${username}`, username, accountType: '', vendorCode: '', isVerified: true, visible: true, masterDataSync: null, session: s }) as CredentialRow

const health: PlatformCredentials[] = [
  {
    platform: 'ajio',
    autoLogin: true,
    credentials: [
      credential('online1@wrogn.com', session('2026-09-15T20:00:00.000Z')), // active
      credential('old@wrogn.com', session('2026-09-15T09:00:00.000Z')), // expired
      credential('soon@wrogn.com', session('2026-09-15T11:00:00.000Z')) // expiring — still works
    ]
  },
  { platform: 'flipkart', autoLogin: true, credentials: [credential('fk@wrogn.com', null)] } // never captured
] as PlatformCredentials[]

describe('inactiveAccounts', () => {
  it('passes live and expiring sessions', () => {
    expect(
      inactiveAccounts(
        [
          { platform: 'Ajio', username: 'online1@wrogn.com' },
          { platform: 'Ajio', username: 'SOON@wrogn.com' }
        ],
        health,
        NOW
      )
    ).toEqual([])
  })

  it('stops on an expired, never-captured, or unknown login — once per account', () => {
    expect(
      inactiveAccounts(
        [
          { platform: 'Ajio', username: 'old@wrogn.com' },
          { platform: 'ajio', username: 'OLD@wrogn.com ' }, // same account, another row
          { platform: 'Flipkart', username: 'fk@wrogn.com' },
          { platform: 'Ajio', username: 'nobody@wrogn.com' }
        ],
        health,
        NOW
      )
    ).toEqual([
      // `optional` is false throughout here: none of these credentials says its
      // sign-in costs a code, and a login this machine does not hold cannot be
      // skipped INTO a run at all.
      {
        platform: 'ajio',
        username: 'old@wrogn.com',
        credentialId: 'id-old@wrogn.com',
        state: 'expired',
        optional: false
      },
      {
        platform: 'flipkart',
        username: 'fk@wrogn.com',
        credentialId: 'id-fk@wrogn.com',
        state: 'none',
        optional: false
      },
      {
        platform: 'ajio',
        username: 'nobody@wrogn.com',
        credentialId: null,
        state: 'missing',
        optional: false
      }
    ])
  })

  it('does not block rows with no account, or platforms with no session model here', () => {
    expect(
      inactiveAccounts(
        [
          { platform: 'Nykaa', username: '' },
          { platform: 'Tata CliQ', username: 'x@y.com' }
        ],
        health,
        NOW
      )
    ).toEqual([])
  })
})

/**
 * An account whose sign-in costs a one-time code.
 *
 * Snapdeal and Flipkart challenge some seller accounts and not others, and
 * re-capturing one of those is an errand: somebody has to go and fetch a code.
 * The action rarely needs that particular login — a refill across six wants the
 * five that can answer — so it is marked skippable rather than made a blocker.
 *
 * The distinction has to survive here, because everything downstream reads it:
 * the dialog badges it, the gate does not stop for it, and the run leaves the
 * account out instead of spending a minute per row failing on it.
 */
describe('an account that needs a code', () => {
  const otpHealth = [
    {
      platform: 'flipkart',
      autoLogin: true,
      credentials: [
        {
          credentialId: 'id-otp',
          username: 'otp@wrogn.com',
          accountType: '',
          vendorCode: '',
          isVerified: true,
          visible: true,
          masterDataSync: null,
          isOtpBased: true,
          session: null,
          pobCount: 0,
          pobSyncedAt: null,
          slaveCount: 0,
          slavesSyncedAt: null,
          domesticCount: 0,
          domesticsSyncedAt: null
        },
        {
          credentialId: 'id-plain',
          username: 'plain@wrogn.com',
          accountType: '',
          vendorCode: '',
          isVerified: true,
          visible: true,
          masterDataSync: null,
          isOtpBased: null,
          session: null,
          pobCount: 0,
          pobSyncedAt: null,
          slaveCount: 0,
          slavesSyncedAt: null,
          domesticCount: 0,
          domesticsSyncedAt: null
        }
      ]
    }
  ] as unknown as Parameters<typeof inactiveAccounts>[1]

  it('is reported as optional, and its neighbour is not', () => {
    const result = inactiveAccounts(
      [
        { platform: 'Flipkart', username: 'otp@wrogn.com' },
        { platform: 'Flipkart', username: 'plain@wrogn.com' }
      ],
      otpHealth,
      NOW
    )

    expect(result.map(account => [account.username, account.optional])).toEqual([
      ['otp@wrogn.com', true],
      // Null is not false: nobody has said, so it behaves as it always did.
      ['plain@wrogn.com', false]
    ])
  })

  it('is still reported — skippable is not invisible', () => {
    // It explains why a run will be narrower than expected, which is worth a
    // line in the dialog even though nothing is waiting on it.
    const result = inactiveAccounts([{ platform: 'Flipkart', username: 'otp@wrogn.com' }], otpHealth, NOW)

    expect(result).toHaveLength(1)
    expect(result[0]?.state).toBe('none')
  })
})
