import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

/**
 * The Snapdeal / Flipkart backup zip, written and read back.
 *
 * It is the one copy that leaves the laptop, so what is pinned is that it comes
 * back EXACTLY: long digit strings stay strings (an AWB read as a number is
 * `8.90798e+12` and matches nothing), and a zip for one platform or report
 * cannot be merged into another.
 */

const dir = mkdtempSync(join(tmpdir(), 'trackvid-archive-'))
const picked = vi.hoisted(() => ({ path: '' }))

vi.mock('electron', () => ({
  app: { getPath: () => dir, getVersion: () => '0.0.0' },
  dialog: {
    showOpenDialog: () => Promise.resolve({ canceled: false, filePaths: [picked.path] })
  }
}))

const { readBackupZip, writeBackupZip } = await import('@main/services/backupArchive')

const today = new Date()
const date = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-03`
const rows = [
  { key: 'S1|R1', awb: '8907979168347', sku: '4608544326972', date, requestId: null },
  { key: 'S2|R2', awb: '0012345', sku: 'ABC', date, requestId: 'req-1' }
]

describe('backup archive', () => {
  it('reads back every row as the text it was written as', async () => {
    const written = await writeBackupZip({
      platform: 'snapdeal',
      label: 'Snapdeal returns',
      report: 'return',
      rows,
      dateOf: row => row.date
    })

    expect(written.success).toBe(true)
    if (!written.success) return
    expect(written.data.rows).toBe(2)

    picked.path = written.data.path

    const read = await readBackupZip({ platform: 'snapdeal', label: 'Snapdeal returns', report: 'return' })

    expect(read.success).toBe(true)
    if (!read.success) return

    const back = read.data.months.flatMap(month => month.rows)

    expect(back).toHaveLength(2)
    expect(back[0]).toMatchObject({ key: 'S1|R1', awb: '8907979168347', sku: '4608544326972', requestId: '' })
    expect(back[1]).toMatchObject({ awb: '0012345', requestId: 'req-1' })
  })

  it('refuses a zip made for another platform or report', async () => {
    const written = await writeBackupZip({
      platform: 'flipkart',
      label: 'Flipkart orders',
      report: 'forward',
      rows,
      dateOf: row => row.date
    })

    if (!written.success) throw new Error(written.error.message)
    picked.path = written.data.path

    const wrongPlatform = await readBackupZip({ platform: 'snapdeal', label: 'x', report: 'forward' })
    const wrongReport = await readBackupZip({ platform: 'flipkart', label: 'x', report: 'return' })

    expect(wrongPlatform.success).toBe(false)
    expect(wrongReport.success).toBe(false)
  })

  it('says so when there is nothing to export', async () => {
    const written = await writeBackupZip({
      platform: 'snapdeal',
      label: 'Snapdeal returns',
      report: 'return',
      rows: [] as typeof rows,
      dateOf: row => row.date
    })

    expect(written.success).toBe(false)
  })
})
