import { createRequire } from 'node:module'
import { describe, expect, it, vi } from 'vitest'

/**
 * Filing a Nykaa claim through the dispute portal's UI.
 *
 * The distinction that matters most is in `toProcessResult`: a ticket whose
 * NUMBER could not be read is not a failed claim. The ticket exists at Nykaa
 * either way, and reporting it as failed invites a retry that files a second
 * one for the same return — the one outcome a seller cannot undo.
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

// Loaded through createRequire, which bypasses vitest's module mocking — so
// only the parts with no collaborators are exercised here.
const { toFormData, readTicketNumber } = require_(
  '@trackvid/automation-core/platforms/nykaa/claim-management/script-based-flow/fileClaim'
) as {
  toFormData: (entry: Record<string, unknown>) => Record<string, string>
  readTicketNumber: (page: { evaluate: (fn: () => unknown) => Promise<unknown> }) => Promise<string | null>
}

const { toProcessResult } = await import(
  '@main/automations/platforms/nykaa/claim-management/script-based-flow/runClaim'
)

const claim = { cmsId: 'claim-1' } as Parameters<typeof toProcessResult>[0]

describe('toFormData', () => {
  it('uses typeOfClaim for both Subject and Issue', () => {
    // Nykaa's form asks for them separately and the claim has one answer.
    const form = toFormData({ typeOfClaim: 'Damaged', awbNumber: 'AWB-1', returnType: 'DTO' })

    expect(form.subject).toBe('Damaged')
    expect(form.issue).toBe('Damaged')
    expect(form.reverseAwb).toBe('AWB-1')
  })

  it('prefers explicit fields over the fallbacks', () => {
    const form = toFormData({
      subject: 'Explicit subject',
      issue: 'Explicit issue',
      typeOfClaim: 'Damaged',
      reverseAwb: 'AWB-EXPLICIT',
      awbNumber: 'AWB-FALLBACK',
      skuId: 'SKU-1',
      emailTemplate: { body: 'fallback body' },
      emailBody: 'explicit body'
    })

    expect(form).toMatchObject({
      subject: 'Explicit subject',
      issue: 'Explicit issue',
      reverseAwb: 'AWB-EXPLICIT',
      skuId: 'SKU-1',
      emailBody: 'explicit body'
    })
  })
})

describe('readTicketNumber', () => {
  it('never throws — an unreadable page is a null, not an error', async () => {
    const page = { evaluate: () => Promise.reject(new Error('page went away')) }

    await expect(readTicketNumber(page)).resolves.toBeNull()
  })
})

describe('toProcessResult', () => {
  it('records the ticket it raised', () => {
    expect(
      toProcessResult(claim, { status: 'success', ticketId: '6339882', message: 'raised' })
    ).toEqual({ cmsId: 'claim-1', ticketId: '6339882', message: 'raised', cmsStatus: null })
  })

  it('does NOT throw for a submitted ticket whose number could not be read', () => {
    // Throwing marks the row failed and invites a retry — a second ticket for
    // the same return, which nobody can undo.
    const result = toProcessResult(claim, {
      status: 'help_center_failed',
      ticketId: null,
      message: 'verify manually'
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
      toProcessResult(claim, { status: 'failed', ticketId: null, message: 'My Area never opened' })
    ).toThrow('My Area never opened')
  })
})
