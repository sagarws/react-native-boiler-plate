import { describe, expect, it, vi } from 'vitest'

/**
 * AJIO's claim flow NEVER throws — it reports every outcome as a status string.
 *
 * That makes the mapping the only place a real failure can be turned back into
 * one. Returning a ProcessResult for `failed` would record a claim that was
 * never filed as filed, which is the worst outcome available: the row goes to
 * Success, nothing retries it, and the seller never gets their money.
 */

vi.mock('@main/services/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}))

const { toProcessResult } = await import(
  '@main/automations/platforms/ajio/claim-management/api-based-flow/runClaim'
)

const claim = { cmsId: 'cms-1' } as never

describe('AJIO claim status mapping', () => {
  it('records a filed claim with its ticket', () => {
    expect(toProcessResult(claim, { status: 'success', ticketId: 'TK-1' })).toMatchObject({
      cmsId: 'cms-1',
      ticketId: 'TK-1'
    })
  })

  // The ticket exists at AJIO. Recording it is the point — a retry that did not
  // know would raise a SECOND claim for the same return.
  it('records an already-raised claim rather than refiling it', () => {
    expect(toProcessResult(claim, { status: 'already_raised', ticketId: 'TK-9' })).toMatchObject({
      ticketId: 'TK-9'
    })
  })

  it('throws the tagged dry-run error so the row stays claimable', () => {
    try {
      toProcessResult(claim, { status: 'dry_run', message: 'skipped' })
      expect.unreachable('dry_run must not return a result')
    } catch (error) {
      expect((error as { code?: string }).code).toBe('CLAIM_SUBMIT_DISABLED')
    }
  })

  // Not bugs and not retryable — the return is not under this POB, or AJIO
  // holds no detail for it. Saying so plainly stops it being re-queued forever.
  it('throws for outcomes that cannot be claimed', () => {
    expect(() => toProcessResult(claim, { status: 'not_found', message: 'no AWB under POB' })).toThrow(
      /no AWB under POB/
    )
    expect(() => toProcessResult(claim, { status: 'not_claimable' })).toThrow(/not_claimable/)
  })

  // A ticket whose attachment failed comes back WITH an id. Naming it is what
  // lets a temp_ticket retry finish the job instead of filing a second claim.
  it('names the ticket when a failure created one anyway', () => {
    expect(() =>
      toProcessResult(claim, { status: 'failed', ticketId: 'TK-3', message: 'attachment failed' })
    ).toThrow(/ticket TK-3 was created/)
  })

  it('never turns a plain failure into a result', () => {
    expect(() => toProcessResult(claim, { status: 'failed', message: 'portal refused' })).toThrow(
      /portal refused/
    )
  })

  it('tags a mid-claim session rejection so the processor renews and retries', () => {
    // AJIO could not say this before: its flow reports statuses instead of
    // throwing, so the AUTH_EXPIRED every other platform gets from `authError`
    // had no equivalent here, and a session that died mid-claim was recorded as
    // a broken claim.
    expect(() =>
      toProcessResult(claim, { status: 'auth_expired', message: 'unauthorised (HTTP 401)' })
    ).toThrow(expect.objectContaining({ code: 'AUTH_EXPIRED' }))
  })

  it('keeps the ticket id when the session dies after the ticket was raised', () => {
    // The attachment path reaches this holding a real ticket. Losing it would
    // let the retry raise a SECOND claim for the same return.
    let thrown: (Error & { ticketId?: string }) | null = null

    try {
      toProcessResult(claim, {
        status: 'auth_expired',
        ticketId: 'TK-9',
        message: 'attachment failed: unauthorised (HTTP 401)'
      })
    } catch (error) {
      thrown = error as Error & { ticketId?: string }
    }

    expect(thrown?.ticketId).toBe('TK-9')
  })
})
