import { describe, expect, it } from 'vitest'
import {
  EXPORT_COLUMNS,
  pagePath,
  parsePagePath,
  recordToSheetRow,
  sheetRowToRecord
} from '../shared/utils/backupRows'

/**
 * Taking the backup off this machine, and putting it back.
 *
 * The zip is laid out the way the data is — `{year}/{month}/{page}.xlsx` — and
 * the layout is not decoration: the path is the ONLY record of where a row
 * belongs once it is a spreadsheet, so a path that writes one way and reads
 * another files a year of returns under the wrong month. The round trip is
 * checked here rather than trusted.
 */

describe('the zip layout', () => {
  it('nests year, then month, then page', () => {
    // Pages are zero-based in storage and one-based on screen, as everywhere.
    expect(pagePath(2026, 9, 0)).toBe('2026/09/1.xlsx')
    expect(pagePath(2026, 12, 16)).toBe('2026/12/17.xlsx')
  })

  it('pads the month, so the files sort the way the months run', () => {
    expect(pagePath(2026, 3, 0)).toBe('2026/03/1.xlsx')
    expect(pagePath(2026, 3, 0) < pagePath(2026, 12, 0)).toBe(true)
  })

  it('reads its own paths back', () => {
    expect(parsePagePath('2026/09/1.xlsx')).toEqual({ year: 2026, month: 9, page: 0 })
    expect(parsePagePath('2026/12/17.xlsx')).toEqual({ year: 2026, month: 12, page: 16 })
  })

  it('reads a path nested under a folder, which is how zips are often made', () => {
    expect(parsePagePath('ajio-return-backup/2026/09/2.xlsx')).toEqual({
      year: 2026,
      month: 9,
      page: 1
    })
    // Windows separators, from a zip built by Explorer.
    expect(parsePagePath('backup\\2026\\09\\2.xlsx')).toEqual({ year: 2026, month: 9, page: 1 })
  })

  it('ignores anything that is not a page', () => {
    expect(parsePagePath('manifest.json')).toBeNull()
    expect(parsePagePath('2026/09/notes.txt')).toBeNull()
    expect(parsePagePath('2026/13/1.xlsx')).toBeNull()
    expect(parsePagePath('2026/09/0.xlsx')).toBeNull()
  })
})

describe('a row through the round trip', () => {
  const record = {
    key: '2367064627473|8905834507638',
    awb: '2367064627473',
    ean: '8905834507638',
    date: '2026-09-14',
    year: 2026,
    month: 9,
    page: 3,
    savedAt: '2026-09-17T04:00:00.000Z',
    row: {
      returnAwbNo: '2367064627473',
      ean: '8905834507638',
      sellerSku: 'WRG-TSH-001',
      pobId: 'DV00353155',
      fwdAwbNo: 'FWD90011',
      returnCreateDate: '2026-09-14'
    }
  }

  it('puts where it came from first, then everything AJIO returned', () => {
    const sheet = recordToSheetRow(record)

    expect(Object.keys(sheet).slice(0, 3)).toEqual([
      EXPORT_COLUMNS.year,
      EXPORT_COLUMNS.month,
      EXPORT_COLUMNS.page
    ])
    // One-based on the page, matching the file it is written to.
    expect(sheet[EXPORT_COLUMNS.page]).toBe(4)
    expect(sheet.sellerSku).toBe('WRG-TSH-001')
  })

  it('comes back identical, and keyed the same', () => {
    const back = sheetRowToRecord(recordToSheetRow(record), { year: 2026, month: 9, page: 3 })

    expect(back.row).toEqual(record.row)
    expect(back.key).toBe(record.key)
    expect(back.awb).toBe(record.awb)
    expect(back.date).toBe(record.date)
    expect(back.page).toBe(3)
  })

  it('drops the three added columns rather than folding them into the row', () => {
    const back = sheetRowToRecord(recordToSheetRow(record), { year: 2026, month: 9, page: 3 })

    // Otherwise a re-exported file would carry Year, Month and Page twice.
    for (const column of Object.values(EXPORT_COLUMNS)) {
      expect(back.row[column]).toBeUndefined()
    }
  })

  it('takes the month from the FILE, not from a column somebody edited', () => {
    const edited = { ...recordToSheetRow(record), [EXPORT_COLUMNS.month]: 11 }
    const back = sheetRowToRecord(edited, { year: 2026, month: 9, page: 3 })

    expect(back.month).toBe(9)
  })

  it('falls back to the first of the month when the row carries no date', () => {
    const undated = sheetRowToRecord(
      { returnAwbNo: '123', ean: '456' },
      { year: 2026, month: 7, page: 0 }
    )

    expect(undated.date).toBe('2026-07-01')
  })
})
