import { describe, expect, it } from 'vitest'
import { exportColumns } from '@shared/constants/claimExport'

const PLATFORMS = ['Ajio', 'Meesho', 'Myntra', 'Snapdeal', 'Nykaa', 'Amazon', 'Flipkart', 'Tata CliQ', 'Delhivery', 'Xbees']

describe('claim export columns', () => {
  it('never exports an image or an uploaded file — only text fields and video links', () => {
    for (const platform of PLATFORMS) {
      for (const { path } of exportColumns(platform)) {
        expect(path).not.toMatch(/image|Images|Label|podProof|sixSide|returnVideo$|forwardVideo$|damagedProductVideo$/i)
      }
    }
  })

  it('keeps the AWB-based video links on every platform', () => {
    for (const platform of PLATFORMS) {
      const paths = exportColumns(platform).map(column => column.path)

      expect(paths).toContain('returnVideoLink')
      expect(paths).toContain('forwardVideoLink')
    }
  })

  it('follows each platform form — Meesho has its sub-order, Myntra its SKU', () => {
    const headers = (platform: string): string[] => exportColumns(platform).map(column => column.header)

    expect(headers('Meesho')).toContain('Sub Order Number')
    expect(headers('Myntra')).toContain('SKU')
    expect(headers('Ajio')).toContain('POB ID')
    expect(headers('Myntra')).not.toContain('POB ID')
  })

  it('still exports the common fields for a platform it does not know', () => {
    const headers = exportColumns('Shopify').map(column => column.header)

    expect(headers).toContain('Return AWB Number')
    expect(headers).toContain('Remark')
  })
})
