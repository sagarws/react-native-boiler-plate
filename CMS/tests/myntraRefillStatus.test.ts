import { describe, expect, it, vi } from 'vitest'

/**
 * Myntra's status read: the payout comes from `finalAmount` and the rejection
 * reason from `rejectReason` / `rejectReasonDescription`, each falling back to
 * what the core read before when Myntra leaves them out.
 */

let ticket: Record<string, unknown> = {}

vi.mock('@main/services/claimSession.service', () => ({
  claimCredentials: () => Promise.reject(new Error('no login in this test'))
}))
vi.mock('@main/automations/common/coreLoader', () => ({
  loadCore: () => ({
    fetchClaimByTicketId: () =>
      Promise.resolve({
        found: true,
        status: String(ticket.status),
        validationReason: (ticket.validationReason as string | undefined) ?? null,
        row: ticket
      }),
    mapMyntraStatus: (status: string) => (status === 'REJECT' ? 'Rejected' : 'Paid'),
    myntraCompensation: (row: { compensationAmount?: number }) => row.compensationAmount ?? null
  })
}))

const { myntraRefill, finalAmount, rejectReasonOf } = await import(
  '@main/automations/platforms/myntra/refill/refillFields'
)

const ask = (row: Record<string, unknown>) => {
  ticket = row

  return myntraRefill({
    doc: {},
    awb: 'RTN123',
    username: 'seller@example.com',
    ticketNumber: '9606903',
    fields: ['statusChange'],
    contexts: new Map([['seller@example.com', {}]])
  })
}

describe('Myntra status refill', () => {
  it('takes finalAmount as the compensation', async () => {
    const values = await ask({ status: 'PAYMENT_COMPLETED', finalAmount: 412.5, compensationAmount: 500 })

    expect(values.compensationAmount).toBe(412.5)
    expect(values.status).toBe('Paid')
  })

  it('falls back to compensationAmount without a finalAmount', async () => {
    const values = await ask({ status: 'PAYMENT_COMPLETED', finalAmount: null, compensationAmount: 500 })

    expect(values.compensationAmount).toBe(500)
  })

  it('takes rejectReason, then its description, then validationReason', async () => {
    expect(
      (await ask({ status: 'REJECT', rejectReason: 'Wrong item', validationReason: 'CODE' })).rejectReason
    ).toBe('Wrong item')
    expect(
      (await ask({ status: 'REJECT', rejectReason: ' ', rejectReasonDescription: 'Seal intact', validationReason: 'CODE' }))
        .rejectReason
    ).toBe('Seal intact')
    expect((await ask({ status: 'REJECT', validationReason: 'CODE' })).rejectReason).toBe('CODE')
  })

  it('reads numbers sent as strings and ignores junk', () => {
    expect(finalAmount({ finalAmount: '99' })).toBe(99)
    expect(finalAmount({ finalAmount: 'n/a' })).toBeNull()
    expect(finalAmount(null)).toBeNull()
    expect(rejectReasonOf({ rejectReason: 42 })).toBeNull()
  })
})
