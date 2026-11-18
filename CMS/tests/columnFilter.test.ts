import { describe, expect, it } from 'vitest'
import type { CmsRow } from '@shared/types/cmsList'
import {
  applyColumnFilters,
  cellText,
  columnValues,
  withColumnFilter
} from '@shared/utils/columnFilter'
import { BLANK } from '@shared/utils/rowFilter'

const row = (over: Partial<CmsRow>): CmsRow =>
  ({
    id: 'x',
    platform: 'Nykaa',
    username: '',
    returnAwb: '',
    status: 'Pending',
    attempts: 0,
    amount: null,
    createdAt: '',
    ...over
  }) as CmsRow

const rows = [
  row({ id: '1', username: 'ranjit@tigc.in', returnAwb: '28449705464593', status: 'Pending' }),
  row({ id: '2', username: '', returnAwb: '32810210297850', status: 'Pending' }),
  row({ id: '3', username: 'ranjit@tigc.in', returnAwb: '26472713323110', status: 'In Review' })
]

const ids = (list: CmsRow[]): string[] => list.map(r => r.id)

describe('column filters', () => {
  it('searches a column case-insensitively, by part of the value', () => {
    expect(ids(applyColumnFilters(rows, { returnAwb: { search: '2844' } }))).toEqual(['1'])
    expect(ids(applyColumnFilters(rows, { username: { search: 'RANJIT' } }))).toEqual(['1', '3'])
  })

  it('narrows to the picked values, and an empty pick shows nothing', () => {
    expect(ids(applyColumnFilters(rows, { status: { values: ['In Review'] } }))).toEqual(['3'])
    expect(applyColumnFilters(rows, { status: { values: [] } })).toEqual([])
  })

  it('ANDs columns together, and a blank cell can be picked', () => {
    expect(
      ids(applyColumnFilters(rows, { status: { values: ['Pending'] }, username: { values: [BLANK] } }))
    ).toEqual(['2'])
  })

  it("lists one column's values from what the other columns let through", () => {
    const values = columnValues(rows, { status: { values: ['Pending'] } }, 'username')

    expect(values).toEqual([
      { value: 'ranjit@tigc.in', count: 1 },
      { value: BLANK, count: 1 }
    ])
  })

  it('drops a column that narrows nothing', () => {
    expect(withColumnFilter({ status: { values: ['Pending'] } }, 'status', { search: '  ' })).toEqual({})
  })

  it('reads numbers and dates as text, a date by its day', () => {
    expect(cellText(row({ attempts: 2 }), 'attempts')).toBe('2')
    expect(cellText(row({ amount: null }), 'amount')).toBe(BLANK)
    expect(cellText(row({ createdAt: '2026-10-07T08:00:00' }), 'createdAt')).toBe('07/10/2026')
  })
})
