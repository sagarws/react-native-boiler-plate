import { createRequire } from 'node:module'
import { describe, expect, it, vi } from 'vitest'

/**
 * Filing a Meesho claim through the supplier portal's form.
 *
 * The distinction worth protecting is the middle one: a form that WAS submitted
 * but whose ticket id could not be read back is neither a success (there is
 * nothing to write) nor a failure (a retry would raise a second ticket for the
 * same return). The server's runner has drawn that line for months; this makes
 * sure the desktop draws it in the same place.
 */

vi.mock('@main/services/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))
vi.mock('@main/services/claimSession.service', () => ({ claimCredentials: vi.fn() }))
vi.mock('@main/automations/common/claimConfig', () => ({ requireClaimConfig: vi.fn() }))
vi.mock('@main/automations/common/claimAccount', () => ({ requireClaimAccount: vi.fn() }))
vi.mock('@main/automations/common/coreLoader', () => ({ loadCore: vi.fn() }))
vi.mock('@main/automations/common/prepareCore', () => ({
  prepareCoreWithBrowser: vi.fn(),
  prepareCoreProcess: vi.fn()
}))
vi.mock('@main/services/browserLease.service', () => ({
  leasedSession: vi.fn(),
  discardLease: vi.fn()
}))

const require_ = createRequire(import.meta.url)

// Loaded through createRequire, which bypasses vitest's mocking — so only the
// parts with no collaborators are exercised here.
const { toFormData } = require_(
  '@trackvid/automation-core/platforms/meesho/claim-management/script-based-flow/fileClaim'
) as { toFormData: (entry: Record<string, unknown>, companyId?: string) => Record<string, unknown> }

const { toProcessResult } = await import(
  '@main/automations/platforms/meesho/claim-management/script-based-flow/runClaim'
)

const claim = { cmsId: 'claim-1' } as Parameters<typeof toProcessResult>[0]

describe('toFormData', () => {
  it('falls back to the default claim reason when the row has none', () => {
    expect(toFormData({ awbNumber: 'A1' }).typeOfClaim).toBe('I have received damaged return')
  })

  it('maps the CMS field names onto the portal form', () => {
    const form = toFormData(
      {
        typeOfClaim: 'Wrong product returned',
        logisticsPartnerName: 'Valmo',
        subOrderNumber: 'SO-1',
        awbNumber: 'A1',
        stateOfPacket: 'Damaged',
        callbackNumber: '9999999999'
      },
      'company-1'
    )

    expect(form).toMatchObject({
      typeOfClaim: 'Wrong product returned',
      // The portal calls it "courier partner"; the CMS calls it
      // logisticsPartnerName. One mapping, beside the filling that uses it.
      courierPartner: 'Valmo',
      subOrderNumber: 'SO-1',
      awbNumber: 'A1',
      stateOfPacket: 'Damaged',
      callbackNumber: '9999999999',
      companyId: 'company-1'
    })
  })
})

describe('toProcessResult', () => {
  it('records the ticket it raised', () => {
    expect(
      toProcessResult(claim, { status: 'success', ticketId: 'TK-1', message: 'raised' })
    ).toEqual({ cmsId: 'claim-1', ticketId: 'TK-1', message: 'raised', cmsStatus: null })
  })

  it('does NOT throw when the form submitted but the ticket id was unreadable', () => {
    // Throwing marks the row failed and invites a retry — a second ticket for
    // the same return, which nobody can undo.
    const result = toProcessResult(claim, {
      status: 'help_center_failed',
      ticketId: null,
      message: 'Ticket ID could not be captured'
    })

    expect(result.cmsId).toBe('claim-1')
    expect(result.ticketId).toBeNull()
  })

  it('throws a tagged dry run so the row stays claimable', () => {
    expect(() =>
      toProcessResult(claim, { status: 'dry_run', ticketId: null, message: 'not submitted' })
    ).toThrow(expect.objectContaining({ code: 'CLAIM_SUBMIT_DISABLED' }))
  })

  it('turns a real failure back into one', () => {
    expect(() =>
      toProcessResult(claim, { status: 'failed', ticketId: null, message: 'sub order invalid' })
    ).toThrow('sub order invalid')
  })
})
