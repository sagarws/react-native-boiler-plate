import { describe, expect, it } from 'vitest'
import type { JobDetail } from '@shared/types/jobs'

import { rowsToReasons } from '@shared/utils/sessionRunReasons'

/**
 * Attaching "why" to the account it belongs to.
 *
 * The Login update already writes a reason per account — "Flipkart did not
 * accept the OTP after retry", "gave up after 180s" — and it has only ever
 * been readable by opening Jobs and matching timestamps. That is why the
 * Settings card could report a completed run while every login stayed red and
 * explain neither half.
 *
 * THE JOIN IS A DISPLAY STRING, `"<Platform> · <username>"`, which is the weak
 * part: a reason shown against the wrong account is worse than no reason, so a
 * row that cannot be matched is dropped rather than guessed at.
 */

const detail = (
  succeededRows: { ref: string; note: string | null }[],
  failedRows: { ref: string; reason: string }[] = []
): JobDetail =>
  ({
    succeededRows: succeededRows.map(row => ({ ...row, ticketId: null })),
    failedRows: failedRows.map(row => ({ ...row, result: null }))
  }) as JobDetail

describe('rowsToReasons', () => {
  it('keys a reason by platform and account', () => {
    const reasons = rowsToReasons(
      detail([{ ref: 'Flipkart · ops@example.com', note: 'OTP was refused twice' }])
    )

    expect(reasons['flipkart:ops@example.com']).toBe('OTP was refused twice')
  })

  it('canonicalises the platform the way the rest of the app does', () => {
    // The ref carries the LABEL ("Tata CliQ"), and every other part of the app
    // keys on "tatacliq". Lower-casing alone does not get there.
    const reasons = rowsToReasons(
      detail([{ ref: 'Tata CliQ · seller@example.com', note: 'no code arrived' }])
    )

    expect(reasons['tatacliq:seller@example.com']).toBe('no code arrived')
  })

  it('reads both lists, because the task writes to each', () => {
    // An account that timed out is a "succeeded row" with a note explaining it
    // did not; one that threw is a failed row. Same fact, two places.
    const reasons = rowsToReasons(
      detail(
        [{ ref: 'Myntra · a@x.com', note: 'Gave up after 180s' }],
        [{ ref: 'Snapdeal · b@x.com', reason: 'Wrong credential' }]
      )
    )

    expect(reasons).toEqual({
      'myntra:a@x.com': 'Gave up after 180s',
      'snapdeal:b@x.com': 'Wrong credential'
    })
  })

  it('drops a row it cannot match rather than guessing', () => {
    const reasons = rowsToReasons(
      detail([
        { ref: 'no separator here', note: 'something' },
        { ref: 'Flipkart · ', note: 'half a ref' },
        { ref: 'Meesho · c@x.com', note: null }
      ])
    )

    expect(reasons).toEqual({})
  })

  it('survives a detail with neither list', () => {
    expect(rowsToReasons({} as JobDetail)).toEqual({})
  })
})
