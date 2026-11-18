import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

const require_ = createRequire(import.meta.url)

interface Validation {
  isValid: boolean
  errors: { message: string; field: string | null }[]
}

interface MeeshoFlow {
  isOpaqueServerError: (error: unknown) => boolean
  TAT_EXPIRED_MESSAGE: string
  INVALID_SUB_ORDER_MESSAGE: string
  meeshoErrorDetail: (body: unknown) => string | null
  subOrderVerdict: (validation: Validation) => { invalid: boolean; message: string | null }
  tatVerdict: (validation: Validation) => { expired: boolean; message: string | null }
}

const flow = require_(
  '@trackvid/automation-core/platforms/meesho/claim-management/api-based-flow/claimApiFlow'
) as MeeshoFlow

/**
 * The bare 500 Meesho answers a claim it will not take.
 *
 * Observed 2026-09-18 filing against an AWB whose window had closed:
 *   HTTP 500 {"error":"Request failed with status code 500",
 *             "options":{"backendData":{"error":""}}}
 * No field, no message — three lines of JSON that reach an operator as an
 * outage. A refusal Meesho can still reason about arrives as HTTP 200 with a
 * sentence, so this shape is its own signal.
 *
 * What is pinned here is how NARROW that signal is: a 500 carrying a backend
 * message is a different problem and must keep its own words, or every real
 * outage gets filed as an expired claim and nobody retries it.
 */

const gateway500 = (backend: unknown) =>
  Object.assign(new Error('Create ticket failed: HTTP 500'), {
    code: 'MEESHO_API_ERROR',
    step: 'Create ticket',
    status: 500,
    body: { error: 'Request failed with status code 500', options: { backendData: backend } }
  })

describe('an opaque Meesho server error', () => {
  it('recognises the empty-gateway 500 exactly as captured', () => {
    expect(flow.isOpaqueServerError(gateway500({ error: '' }))).toBe(true)
  })

  it('recognises it with no backendData at all', () => {
    expect(flow.isOpaqueServerError(gateway500(undefined))).toBe(true)
    expect(flow.isOpaqueServerError(gateway500({}))).toBe(true)
  })

  it('leaves a 500 that DID say something alone', () => {
    const spoken = gateway500({
      errors: [{ defaultMessage: 'Sub order number is not valid for this supplier' }]
    })

    // It has words of its own, and they are more useful than a guess.
    expect(flow.meeshoErrorDetail(spoken.body)).toContain('not valid')
    expect(flow.isOpaqueServerError(spoken)).toBe(false)
  })

  it('leaves every other failure alone', () => {
    expect(flow.isOpaqueServerError(new Error('socket hang up'))).toBe(false)
    expect(flow.isOpaqueServerError({ ...gateway500({ error: '' }), status: 400 })).toBe(false)
    expect(flow.isOpaqueServerError({ ...gateway500({ error: '' }), code: 'OTHER' })).toBe(false)
    expect(flow.isOpaqueServerError(null)).toBe(false)
  })

  it('files under the code the claims page is read by', () => {
    // Short and stable: it is matched downstream, so Meesho's own sentence is
    // kept on the error rather than folded into this.
    expect(flow.TAT_EXPIRED_MESSAGE).toBe('ME1: TAT expired')
  })

  it('writes the same words the Check TAT sweep writes', () => {
    // Two paths reach the same fact — the sweep asks validateTicketField before
    // filing, the claim meets the refusal on submit — and the column is matched
    // on, not just read. One constant, so they cannot drift by a capital.
    const shared = require_('@trackvid/automation-core/common/claimErrors') as {
      TAT_EXPIRED: string
      INVALID_SUB_ORDER: string
      SNAPDEAL_INVALID_AWB: string
    }

    expect(shared.TAT_EXPIRED).toBe(flow.TAT_EXPIRED_MESSAGE)
  })

  it('files an AWB that is on no account under its own code, not the raw tag', () => {
    // What reached the column before was "NO_RETURN_PACKETS: Wrong awb number,
    // Not exist in account ops@example.com" — a machine tag, too long for the
    // column, and unfilterable because the account name made every occurrence a
    // different string. The tag still exists; it just moved to `.code`, where
    // the flow keys on it and an operator never sees it.
    const shared = require_('@trackvid/automation-core/common/claimErrors') as {
      MEESHO_INVALID_AWB: string
      INVALID_SUB_ORDER: string
    }

    expect(shared.MEESHO_INVALID_AWB).toBe('ME3: Invalid AWB number')
    expect(shared.MEESHO_INVALID_AWB).not.toContain('NO_RETURN_PACKETS')
    expect(shared.MEESHO_INVALID_AWB).not.toBe(shared.INVALID_SUB_ORDER)
  })

  it('keeps every code distinct — the column is filtered on', () => {
    const shared = require_('@trackvid/automation-core/common/claimErrors') as Record<string, unknown>
    // The module also exports the BUILDER for one of these failures. Only the
    // operator-facing strings are codes, so only those are compared.
    const codes = Object.values(shared).filter((value): value is string => typeof value === 'string')

    // ME1, ME2, ME3, SE1: a repeated string would merge two reasons with two
    // different fixes into one line an operator cannot act on. ME3 nearly was
    // ME2 — both mean "the identifiers on this row do not match Meesho", but a
    // bad sub-order number is repaired by Refill Data while an AWB on no
    // account at all needs a person, so they are two queues with two owners.
    expect(new Set(codes).size).toBe(codes.length)
    // Each opens with its marketplace's letter and a number, so a row says
    // where the refusal came from before it says what it was.
    for (const code of codes) expect(code).toMatch(/^[A-Z]{2}\d+: /)
  })
})

/**
 * The second question, asked when the window is not the answer.
 *
 * Meesho validates the sub-order number ON ITS OWN differently from a form
 * carrying both fields: the pair can come back valid, or refused for something
 * else, while the number alone is one it does not recognise — and that row
 * meets a bare 500 on submit. Observed 2026-09-18:
 *   { is_valid: false, errors: [{ field_name: "sub_order_number",
 *     error_message: "Please enter a valid sub order number." }] }
 *
 * The two verdicts must stay disjoint. A window message filed as a bad number
 * sends somebody to correct a number that was right; a bad number filed as an
 * expired window hides a row that Refill Data could have repaired.
 */

const refusal = (message: string, field: string | null = null): Validation => ({
  isValid: false,
  errors: [{ message, field }]
})

describe('the sub-order verdict', () => {
  it("recognises Meesho's own wording", () => {
    const verdict = flow.subOrderVerdict(refusal('Please enter a valid sub order number.', 'sub_order_number'))

    expect(verdict.invalid).toBe(true)
    expect(verdict.message).toBe('Please enter a valid sub order number.')
  })

  it('says nothing about a form that validated', () => {
    expect(flow.subOrderVerdict({ isValid: true, errors: [] }).invalid).toBe(false)
  })

  it('leaves the claim window to the other verdict', () => {
    const window = refusal('The dispute can only be claimed within 7 days of return delivery', 'awb_number')

    expect(flow.subOrderVerdict(window).invalid).toBe(false)
    expect(flow.tatVerdict(window).expired).toBe(true)
  })

  it('does not claim every refusal is a bad number', () => {
    const other = refusal('Attachments are required for this category', 'attachments')

    expect(flow.subOrderVerdict(other).invalid).toBe(false)
    expect(flow.tatVerdict(other).expired).toBe(false)
  })

  it('files under a code of its own, since the fix is its own', () => {
    // Refill Data repairs a sub-order number. Nothing repairs a closed window.
    expect(flow.INVALID_SUB_ORDER_MESSAGE).toBe('ME2: Invalid sub order number.')
    expect(flow.INVALID_SUB_ORDER_MESSAGE).not.toBe(flow.TAT_EXPIRED_MESSAGE)
  })
})
