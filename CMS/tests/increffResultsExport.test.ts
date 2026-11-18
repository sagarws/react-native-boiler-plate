import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as XLSX from 'xlsx'

/**
 * Increff Bulk Claim → "Export result".
 *
 * Pinned: both sheets land with the modal's columns, an AWB stays text (a
 * number cell shows 4.88E+12 and loses digits), the payload is validated, and
 * a closed save dialog is the word the renderer swallows.
 */

const mocks = vi.hoisted(() => ({
  showSaveDialog: vi.fn(),
  writeFile: vi.fn()
}))

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/trackvid-test' },
  dialog: { showSaveDialog: mocks.showSaveDialog }
}))
vi.mock('node:fs/promises', () => ({ readFile: vi.fn(), writeFile: mocks.writeFile }))
vi.mock('@main/services/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))

const { saveIncreffResults } = await import('@main/services/bulkClaimSheet.service')

const success = [['1', '4884668446441', 'Ajio', 'OTHER_BRAND', 'AJIO · 4884668446441', 'Created · abc']]
const failed = [['5', '195042661266612', 'Ajio', 'OTHER_BRAND', '—', 'Unmatched (no VMS record)']]

beforeEach(() => {
  vi.clearAllMocks()
  mocks.showSaveDialog.mockResolvedValue({ canceled: false, filePath: '/tmp/out.xlsx' })
  mocks.writeFile.mockResolvedValue(undefined)
})

describe('saveIncreffResults', () => {
  it('writes a Success and a Failed sheet, AWBs as text', async () => {
    const result = await saveIncreffResults({ fileStem: 'qc report', success, failed })

    expect(result).toEqual({ success: true, data: { path: '/tmp/out.xlsx' } })

    const book = XLSX.read(mocks.writeFile.mock.calls[0]?.[1] as Buffer, { type: 'buffer' })

    expect(book.SheetNames).toEqual(['Success', 'Failed'])

    const failedSheet = book.Sheets.Failed as XLSX.WorkSheet

    expect(XLSX.utils.sheet_to_json(failedSheet, { header: 1 })).toEqual([
      ['Row #', 'Return AWB', 'Sales Channel', 'QC Reason', 'VMS Matches', 'Reason'],
      failed[0]
    ])
    expect((failedSheet.B2 as XLSX.CellObject | undefined)?.t).toBe('s')
  })

  it('names the file from a sanitised stem', async () => {
    await saveIncreffResults({ fileStem: 'qc/report:1', success, failed: [] })

    const options = mocks.showSaveDialog.mock.calls[0]?.[0] as { defaultPath?: string } | undefined

    expect(options?.defaultPath).toMatch(/qc-report-1-results-\d{4}-\d{2}-\d{2}\.xlsx$/)
  })

  it('refuses a payload that is not rows', async () => {
    await expect(saveIncreffResults({ success: 'x', failed })).resolves.toMatchObject({ success: false })
    expect(mocks.showSaveDialog).not.toHaveBeenCalled()
  })

  it('refuses an empty export', async () => {
    await expect(saveIncreffResults({ success: [], failed: [] })).resolves.toMatchObject({ success: false })
  })

  it('answers Cancelled when the dialog is closed, writing nothing', async () => {
    mocks.showSaveDialog.mockResolvedValue({ canceled: true })

    const result = await saveIncreffResults({ success, failed })

    expect(result).toMatchObject({ success: false, error: { message: 'Cancelled' } })
    expect(mocks.writeFile).not.toHaveBeenCalled()
  })
})
