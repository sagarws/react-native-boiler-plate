import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Delhivery claims recorded with the internal ticket UUID instead of the "J…"
 * number — and the one-off correction the status pass makes.
 *
 * A claim found already filed took its ticket from the claims list's
 * `jarvis_ticket_id` (e.g. 587232ca-22bb-4a34-ba64-695710378968), which nobody
 * can look up on the portal and the status check cannot read by. The status
 * pass now resolves it to the J-number, reads the status by that, and the run
 * writes the J-number onto the row — before the status, and only while the
 * claim's status allows a ticket edit.
 */

const UUID = '587232ca-22bb-4a34-ba64-695710378968'
const J = 'J1793190060742161'

const core = vi.hoisted(() => ({
  resolve: vi.fn<(ctx: unknown, awb: string, uuid: string) => Promise<string | null>>(),
  fetchTicket: vi.fn<(ctx: unknown, id: string) => Promise<{ status?: string | null } | null>>(),
  claims: vi.fn<(ctx: unknown, input: { awb: string }) => Promise<Record<string, unknown>[]>>()
}))
const requests = vi.hoisted(() => ({ calls: [] as { path: string; body: unknown }[], ok: true }))

vi.mock('@main/services/claimSession.service', () => ({
  claimCredentials: () => Promise.reject(new Error('no login in this test'))
}))
vi.mock('@main/automations/common/coreLoader', () => ({
  loadCore: () => ({
    resolvePublicTicketId: core.resolve,
    isInternalTicketId: (value: string | null) =>
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value ?? '')),
    fetchClientTicket: core.fetchTicket,
    mapDelhiveryTicketStatus: (status: string | null) => (status === 'open' ? 'In Review' : null),
    listLostDamageClaims: core.claims,
    mapDelhiveryStatus: () => null
  })
}))
vi.mock('@main/services/httpClient', () => ({
  apiRequest: (path: string, options: { body?: unknown } = {}) => {
    requests.calls.push({ path, body: options.body })

    return Promise.resolve(
      requests.ok ? { success: true, data: {} } : { success: false, error: { code: 'INTERNAL_ERROR', message: 'down' } }
    )
  }
}))
vi.mock('@main/services/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))

const { delhiveryRefill } = await import('@main/automations/platforms/delhivery/refill/refillFields')
const { correctTicketNumber } = await import('@main/services/refill.service')

const ask = (ticketNumber: string | null) =>
  delhiveryRefill({
    doc: {},
    awb: '26472713456644',
    username: 'shashidhara.ct@tigc.in',
    ticketNumber,
    fields: ['statusChange'],
    contexts: new Map([['shashidhara.ct@tigc.in', {}]])
  })

beforeEach(() => {
  core.resolve.mockReset()
  core.fetchTicket.mockReset()
  core.claims.mockReset()
  requests.calls.length = 0
  requests.ok = true
})

describe('the Delhivery status pass', () => {
  it('resolves an internal id to the J-number, reads the status by it, and reports the correction', async () => {
    core.resolve.mockResolvedValue(J)
    core.fetchTicket.mockResolvedValue({ status: 'open' })

    expect(await ask(UUID)).toEqual({ ticketNumber: J, marketplaceStatus: 'open', status: 'In Review', rejectReason: null })
    expect(core.resolve).toHaveBeenCalledWith({}, '26472713456644', UUID)
    expect(core.fetchTicket).toHaveBeenCalledWith({}, J)
  })

  it('leaves a row that already holds a J-number exactly as it was', async () => {
    core.fetchTicket.mockResolvedValue({ status: 'open' })

    expect(await ask(J)).toEqual({ marketplaceStatus: 'open', status: 'In Review', rejectReason: null })
    expect(core.resolve).not.toHaveBeenCalled()
  })

  it('reports no correction when the J-number cannot be found, and still reads the status', async () => {
    core.resolve.mockResolvedValue(null)
    core.fetchTicket.mockResolvedValue(null)
    core.claims.mockResolvedValue([{ wbn: '26472713456644', status: 'claim_raised' }])

    const values = await ask(UUID)

    expect(values).not.toHaveProperty('ticketNumber')
    expect(values).toMatchObject({ marketplaceStatus: 'claim_raised' })
  })
})

describe('writing the correction', () => {
  it('saves the J-number while the claim may still take a ticket edit', async () => {
    await correctTicketNumber('jwt', 'cms1', { ticketNumber: UUID, status: 'In Review' }, J)

    expect(requests.calls).toEqual([{ path: '/cms/update-ticket', body: { _id: 'cms1', ticket: J, source: 'desktop' } }])
  })

  it('never touches an Approved or Rejected claim — the ticket write would demote it', async () => {
    await correctTicketNumber('jwt', 'cms1', { ticketNumber: UUID, status: 'Approved' }, J)
    await correctTicketNumber('jwt', 'cms1', { ticketNumber: UUID, status: 'Rejected' }, J)

    expect(requests.calls).toEqual([])
  })

  it('writes nothing when there is nothing to correct', async () => {
    await correctTicketNumber('jwt', 'cms1', { ticketNumber: J, status: 'In Review' }, J)
    await correctTicketNumber('jwt', 'cms1', { ticketNumber: UUID, status: 'In Review' }, null)

    expect(requests.calls).toEqual([])
  })

  it('does not throw when the save is refused — the status still gets written', async () => {
    requests.ok = false

    await expect(correctTicketNumber('jwt', 'cms1', { ticketNumber: UUID, status: 'In Review' }, J)).resolves.toBeUndefined()
  })
})
