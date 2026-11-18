import { describe, expect, it } from 'vitest'
import { IDENTITY_CHECKS } from '@trackvid/automation-core/common/sessionIdentity'

/**
 * A Myntra VENDOR is signed in, and used to be told it was nobody.
 *
 * ONE ACCOUNT IN A HUNDRED, for a fortnight. Every other Myntra credential on
 * the same machine captured fine; `listing@mozafia.com` failed every single
 * attempt from 10 to 23 September — sign in, refuse, discard, sign in again an
 * hour later — and the app's account of it was "Myntra does not recognise the
 * session that was captured — it answers as if nobody is signed in".
 *
 * Myntra was recognising it perfectly well. Recorded traffic from a real
 * browser login, `GET /api/boot/partners`, HTTP 200:
 *
 *   partnerType "VENDOR"     partnerCode "DYVY"     partnerId "14880"
 *   sellerId    0            sellerType  []         hasAccess true
 *   user.loginId "listing@mozafia.com"              user.status ACTIVE
 *
 * The probe wanted a partner id AND a non-empty `sellerType`. But `sellerType`
 * is the SELLER classification — PPMP, FBM, SJIT — and a vendor has none, so
 * the rule refused every vendor account on the platform while the payload was
 * naming the signed-in user on the very same line. `sellerId: 0` is Myntra
 * saying "not a seller", not an id.
 *
 * The fixtures here are trimmed from that recording. Nothing secret survives:
 * an account name and a partner code, no cookies, no tokens.
 */

const read = IDENTITY_CHECKS.myntra.read as (
  status: number,
  body: unknown
) => { ok: true | false | null; who?: string }

/** The recorded VENDOR payload, trimmed to what the rule reads. */
const vendor = {
  partnerType: 'VENDOR',
  partnerCode: 'DYVY',
  partnerId: '14880',
  sellerId: 0,
  sellerType: [],
  hasAccess: true,
  user: { loginId: 'listing@mozafia.com', uidx: 'eb4dd0a8.fd49', status: 'ACTIVE', enabled: true }
}

/** A seller, which is what every other Myntra credential here is. */
const seller = {
  partnerType: 'PARTNER_SELLER',
  partnerId: '23026',
  sellerId: 2297,
  sellerType: ['PPMP'],
  user: { loginId: 'northridge0005@gmail.com' }
}

describe('the Myntra boot payload', () => {
  it('counts a VENDOR with no sellerType as signed in', () => {
    expect(read(200, vendor)).toEqual({ ok: true, who: 'listing@mozafia.com' })
  })

  it('still counts an ordinary seller as signed in', () => {
    expect(read(200, seller)).toEqual({ ok: true, who: 'northridge0005@gmail.com' })
  })

  it('names the account rather than an internal id', () => {
    // `who` is read out loud — in the log line, and in the message an operator
    // is asked about down a phone line. "23026" identifies nothing to them.
    expect(read(200, seller).who).toBe('northridge0005@gmail.com')
  })
})

describe('what must still be refused', () => {
  it('refuses a payload that names nobody', () => {
    // The anonymous boot payload — the case the old rule was written for, and
    // the one it did catch. A signed-out session has no user to carry.
    expect(read(200, { partnerId: null, sellerId: 0, sellerType: [] })).toEqual({ ok: false })
  })

  it('refuses a named user with no partner behind them', () => {
    expect(read(200, { user: { loginId: 'a@x.com' } })).toEqual({ ok: false })
  })

  it('does not read sellerId 0 as a partner identity', () => {
    // Myntra's "not a seller", not an id. Alone it is not evidence.
    expect(read(200, { user: { loginId: 'a@x.com' }, sellerId: 0 })).toEqual({ ok: false })
  })

  it('refuses a 401 outright', () => {
    expect(read(401, {})).toEqual({ ok: false })
  })
})

describe('what must stay "cannot tell"', () => {
  it('does not condemn a session over a rate-limited burst', () => {
    // Three captures in a minute from one IP. A 429 says nothing about the
    // session, and treating it as death would discard a good capture.
    expect(read(429, {})).toEqual({ ok: null })
  })

  it('does not condemn a session over a body it cannot read', () => {
    expect(read(200, 'an edge error page')).toEqual({ ok: null })
  })
})
