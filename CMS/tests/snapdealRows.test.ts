import { describe, expect, it } from 'vitest'
import {
  SNAPDEAL_WINDOW_DAYS,
  bestRequestStatus,
  mergeSnapdealRecord,
  snapdealApiDate,
  snapdealDate,
  snapdealDaysIn,
  snapdealFileWindow,
  snapdealKey,
  snapdealRecordDiffers,
  snapdealValue,
  snapdealWindowDays,
  snapdealWindows,
  toSnapdealRecord
} from '../shared/utils/snapdealRows'

/**
 * The Snapdeal backup's arithmetic.
 *
 * Every one of these is a silent failure if it is wrong, and none of them is
 * visible from the UI: a window split that overshoots asks Snapdeal for a
 * report it will not build, a filename that does not parse files one month's
 * rows against another month's request, and a merge that prefers the wrong row
 * throws away the forward AWB — which is the field most claims are blocked on.
 */

describe('snapdealValue', () => {
  it('treats Snapdeal’s "NA" as nothing', () => {
    // A forward AWB stored as the literal string "NA" is a lookup that answers
    // a claim with a courier number no courier has.
    expect(snapdealValue('NA')).toBe('')
    expect(snapdealValue('na')).toBe('')
    expect(snapdealValue(' 7269624179856 ')).toBe('7269624179856')
    expect(snapdealValue('')).toBe('')
    expect(snapdealValue(undefined)).toBe('')
  })

  it('keeps a number as its digits, not as a float', () => {
    expect(snapdealValue(8907979168347)).toBe('8907979168347')
  })
})

describe('snapdealKey', () => {
  it('needs both halves — one sub-order carries several returns', () => {
    expect(snapdealKey('74216331124', '4608544326972')).toBe('74216331124|4608544326972')
    expect(snapdealKey('74216331124', 'SDLR5006999324')).not.toBe(
      snapdealKey('74216331124', '4608544326972')
    )
  })

  it('ignores casing and padding, which differ between downloads', () => {
    expect(snapdealKey(' 74216331124 ', 'sdlr5006999324')).toBe(
      snapdealKey('74216331124', 'SDLR5006999324')
    )
  })
})

describe('snapdealDate', () => {
  it('reads Snapdeal’s time-first stamp', () => {
    // THE TRAP. A naive dd-MM-yyyy match against "13:37:33 04-09-2026" finds
    // "33 04-09" and files the row in the year 9.
    expect(snapdealDate('13:37:33 04-09-2026')).toBe('2026-09-04')
    expect(snapdealDate('16:57:07 30-08-2026')).toBe('2026-08-30')
  })

  it('takes an ISO date as it is', () => {
    expect(snapdealDate('2026-09-04')).toBe('2026-09-04')
  })

  it('is empty rather than wrong when the shape is something else', () => {
    expect(snapdealDate('')).toBe('')
    expect(snapdealDate('NA')).toBe('')
    expect(snapdealDate('last Tuesday')).toBe('')
  })
})

describe('snapdealWindows', () => {
  it('tiles a range exactly — no gap, no overlap', () => {
    const windows = snapdealWindows('2026-09-01', '2026-09-30')

    expect(windows).toEqual([
      { from: '2026-09-01', to: '2026-09-28' },
      { from: '2026-09-29', to: '2026-09-30' }
    ])
  })

  it('never asks for more days than Snapdeal will build', () => {
    for (const window of snapdealWindows('2026-01-01', '2026-12-31')) {
      expect(snapdealWindowDays(window)).toBeLessThanOrEqual(SNAPDEAL_WINDOW_DAYS)
    }
  })

  it('covers every day of the range exactly once', () => {
    const days = snapdealWindows('2026-03-01', '2026-05-15').flatMap(snapdealDaysIn)

    expect(days.length).toBe(new Set(days).size)
    expect(days[0]).toBe('2026-03-01')
    expect(days.at(-1)).toBe('2026-05-15')
  })

  it('answers a single day with one window', () => {
    expect(snapdealWindows('2026-09-04', '2026-09-04')).toEqual([
      { from: '2026-09-04', to: '2026-09-04' }
    ])
  })

  it('answers a backwards range with nothing, rather than a window', () => {
    expect(snapdealWindows('2026-09-30', '2026-09-01')).toEqual([])
  })
})

describe('snapdealApiDate', () => {
  it('writes the zero-padded DD-MM-YYYY the portal sends', () => {
    expect(snapdealApiDate('2026-10-01')).toBe('01-10-2026')
    expect(snapdealApiDate('2026-08-21')).toBe('21-08-2026')
    expect(snapdealApiDate('2026-10-14')).toBe('14-10-2026')
  })
})

describe('snapdealFileWindow', () => {
  it('reads the window out of a real report name', () => {
    // The only thing that says which window a download holds — the reports
    // list carries no id, and every row of it has the same name.
    expect(snapdealFileWindow('S7aea7_DROPSHIP_RTN_CREATED_05092026_03102026 (8).csv')).toEqual({
      from: '2026-09-05',
      to: '2026-10-03'
    })
  })

  it('says it does not know, rather than guessing', () => {
    expect(snapdealFileWindow('report.csv')).toBeNull()
    expect(snapdealFileWindow('')).toBeNull()
    expect(snapdealFileWindow(undefined)).toBeNull()
  })
})

describe('mergeSnapdealRecord', () => {
  const row = (awb: string, date: string): ReturnType<typeof toSnapdealRecord> =>
    toSnapdealRecord(
      {
        SUBORDERCODE: '74216331124',
        REVERSEAWBNO: '4608544326972',
        SKUCODE: '8907979168347',
        AWBNO: awb,
        RETURNINITIATEDON: date
      },
      'req-1'
    )

  it('fills the forward AWB in from the later row', () => {
    /*
     * THE WHOLE REASON THE MERGE EXISTS. Snapdeal serves the return twice —
     * once as it was raised, with AWBNO "NA", and again once the forward leg
     * settled, carrying the number. In a real 422-row report that was 85 of
     * 331 returns, and a plain "skip what is held" loses every one of them.
     */
    const first = row('NA', '13:37:33 04-09-2026')
    const second = row('7269624179856', '13:37:33 04-09-2026')

    expect(first).not.toBeNull()
    expect(second).not.toBeNull()

    const merged = mergeSnapdealRecord(first!, second!)

    expect(merged.awb).toBe('7269624179856')
    expect(snapdealRecordDiffers(first!, merged)).toBe(true)
  })

  it('never lets a blank overwrite something already held', () => {
    const held = row('7269624179856', '13:37:33 04-09-2026')
    const blank = row('NA', '13:37:33 04-09-2026')

    const merged = mergeSnapdealRecord(held!, blank!)

    expect(merged.awb).toBe('7269624179856')
    // Nothing changed, so nothing is rewritten — which is what keeps a
    // re-download of a month already held from touching the file at all.
    expect(snapdealRecordDiffers(held!, merged)).toBe(false)
  })

  it('keeps the earliest date, so the calendar does not move under a re-read', () => {
    const early = row('NA', '13:37:33 04-09-2026')
    const late = row('7269624179856', '13:37:33 06-09-2026')

    expect(mergeSnapdealRecord(early!, late!).date).toBe('2026-09-04')
    expect(mergeSnapdealRecord(late!, early!).date).toBe('2026-09-04')
  })
})

describe('toSnapdealRecord', () => {
  it('keeps the four fields a claim is argued from', () => {
    const record = toSnapdealRecord(
      {
        SUBORDERCODE: '74226942559',
        AWBNO: 'SDLC1078396547',
        REVERSEAWBNO: 'SDLR5006999324',
        SKUCODE: '8907979282982',
        RETURNINITIATEDON: '07:57:31 08-09-2026',
        PRODUCTNAME: 'something long nobody stores'
      },
      'req-9'
    )

    expect(record).toMatchObject({
      subOrderCode: '74226942559',
      awb: 'SDLC1078396547',
      reverseAwb: 'SDLR5006999324',
      sku: '8907979282982',
      date: '2026-09-08',
      year: 2026,
      month: 9,
      requestId: 'req-9'
    })
  })

  it('refuses a row with no sub-order — that is a blank line, not a return', () => {
    expect(toSnapdealRecord({ SUBORDERCODE: '', AWBNO: 'x' }, null)).toBeNull()
  })

  it('falls back to the order date when the return date is missing', () => {
    const record = toSnapdealRecord(
      { SUBORDERCODE: '1', RETURNINITIATEDON: '', ORDERCREATEDDATE: '16:57:06 30-08-2026' },
      null
    )

    expect(record?.date).toBe('2026-08-30')
  })
})

describe('bestRequestStatus', () => {
  it('paints a day by the furthest any request covering it got', () => {
    // A day covered by a stored request and a failed retry is STORED. Painting
    // it red would send somebody re-requesting what they already hold.
    expect(bestRequestStatus(['failed', 'stored'])).toBe('stored')
    expect(bestRequestStatus(['requested', 'ready'])).toBe('ready')
    expect(bestRequestStatus(['failed'])).toBe('failed')
  })

  it('has nothing to say about a day nothing covers', () => {
    expect(bestRequestStatus([])).toBeNull()
  })
})
