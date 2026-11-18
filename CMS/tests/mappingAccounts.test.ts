import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Which logins a probe is offered, and in what order.
 *
 * Three runs ask the same question — Map Username, Refill Data, and a claim
 * that arrived without an account — and each one used to build its own list
 * with its own rule. The rule that matters is about COST: opening an account is
 * a sign-in, and on some platforms a browser and an emailed code, so the order
 * decides how much a run spends before it gets its answer.
 */

const behaviour = vi.hoisted(() => ({
  credentials: [] as { username: string; credentialId?: string; accountType?: string }[],
  health: [] as {
    platform: string
    credentials: { username: string; session: unknown; isOtpBased?: boolean | null }[]
  }[],
  healthFails: false
}))

vi.mock('@main/services/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))
vi.mock('@main/services/company.service', () => ({
  credentialsFor: () =>
    Promise.resolve(
      behaviour.credentials.map(entry => ({
        credentialId: entry.credentialId ?? `id-${entry.username}`,
        username: entry.username,
        accountType: entry.accountType ?? ''
      }))
    )
}))
vi.mock('@main/services/platformSession.service', () => ({
  sessionHealth: () =>
    Promise.resolve(
      behaviour.healthFails
        ? { success: false, error: { code: 'NETWORK_ERROR', message: 'offline' } }
        : { success: true, data: behaviour.health }
    )
}))

const { mappingAccounts } = await import('@main/services/mappingAccounts.service')

/** A session that is alive for another day. */
const live = { expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() }
/** One whose guess ran out yesterday. */
const dead = { expiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString() }

const names = async (platform = 'snapdeal'): Promise<string[]> =>
  (await mappingAccounts(platform)).map(account => account.username)

beforeEach(() => {
  behaviour.credentials = []
  behaviour.health = []
  behaviour.healthFails = false
})

describe('mappingAccounts', () => {
  it('puts the accounts holding a live session first', async () => {
    behaviour.credentials = [{ username: 'cold@x.com' }, { username: 'warm@x.com' }]
    behaviour.health = [
      {
        platform: 'snapdeal',
        credentials: [
          { username: 'cold@x.com', session: dead },
          { username: 'warm@x.com', session: live }
        ]
      }
    ]

    expect(await names()).toEqual(['warm@x.com', 'cold@x.com'])
  })

  it('keeps the stored order inside each group', async () => {
    behaviour.credentials = [
      { username: 'a@x.com' },
      { username: 'b@x.com' },
      { username: 'c@x.com' },
      { username: 'd@x.com' }
    ]
    behaviour.health = [
      {
        platform: 'snapdeal',
        credentials: [
          { username: 'a@x.com', session: dead },
          { username: 'b@x.com', session: live },
          { username: 'c@x.com', session: null },
          { username: 'd@x.com', session: live }
        ]
      }
    ]

    expect(await names()).toEqual(['b@x.com', 'd@x.com', 'a@x.com', 'c@x.com'])
  })

  it('leaves out an account that needs a one-time code and has no session', async () => {
    behaviour.credentials = [{ username: 'otp@x.com' }, { username: 'plain@x.com' }]
    behaviour.health = [
      {
        platform: 'snapdeal',
        credentials: [
          { username: 'otp@x.com', session: dead, isOtpBased: true },
          { username: 'plain@x.com', session: dead, isOtpBased: false }
        ]
      }
    ]

    // The plain one can still be signed in unattended; the OTP one cannot.
    expect(await names()).toEqual(['plain@x.com'])
  })

  it('keeps an OTP account whose session is still live', async () => {
    behaviour.credentials = [{ username: 'otp@x.com' }]
    behaviour.health = [
      {
        platform: 'snapdeal',
        credentials: [{ username: 'otp@x.com', session: live, isOtpBased: true }]
      }
    ]

    expect(await names()).toEqual(['otp@x.com'])
  })

  it('offers every account in stored order when health cannot be read', async () => {
    behaviour.healthFails = true
    behaviour.credentials = [{ username: 'a@x.com' }, { username: 'b@x.com' }]

    // Not knowing must not narrow the search — that would report "nobody holds
    // this AWB" after asking nobody.
    expect(await names()).toEqual(['a@x.com', 'b@x.com'])
  })

  it('matches the health bucket through platformKey, not a lowercase compare', async () => {
    behaviour.credentials = [{ username: 'cold@x.com' }, { username: 'warm@x.com' }]
    behaviour.health = [
      {
        // What the backend stores. "Tata CliQ".toLowerCase() is not "tatacliq".
        platform: 'Tata CliQ',
        credentials: [
          { username: 'cold@x.com', session: dead },
          { username: 'warm@x.com', session: live }
        ]
      }
    ]

    expect(await names('tatacliq')).toEqual(['warm@x.com', 'cold@x.com'])
  })

  it('carries the fields a sign-in needs', async () => {
    behaviour.credentials = [
      { username: 'a@x.com', credentialId: 'cred-1', accountType: 'Brand' }
    ]

    // Myntra's sign-in stops at the relationship-type modal without it.
    expect(await mappingAccounts('myntra')).toEqual([
      { username: 'a@x.com', credentialId: 'cred-1', accountType: 'Brand' }
    ])
  })
})
