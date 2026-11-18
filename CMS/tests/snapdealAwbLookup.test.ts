import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

const dir = mkdtempSync(join(tmpdir(), 'snapdeal-lookup-'))

vi.mock('@main/database', () => ({ dataDirectory: () => dir }))
vi.mock('@main/services/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))

const row = (overrides: Record<string, unknown>) => ({
  key: 'k',
  subOrderCode: '',
  awb: '',
  reverseAwb: '',
  sku: '',
  date: '2026-04-01',
  year: 2026,
  month: 4,
  savedAt: '2026-04-02T00:00:00.000Z',
  requestId: null,
  ...overrides
})

writeFileSync(
  join(dir, 'snapdeal-backup-return.json'),
  JSON.stringify([
    row({ key: 'a', subOrderCode: '71216632046', reverseAwb: 'SDLR5005670795' }),
    row({
      key: 'b',
      subOrderCode: '71216632046',
      awb: 'SDLC1071591128',
      reverseAwb: 'SDLR5005670795',
      sku: '8907979260249'
    }),
    row({ key: 'c', subOrderCode: '71253700534', awb: '127950287706', reverseAwb: '24316550450177' })
  ])
)

const { findSnapdealByAwb } = await import('@main/services/snapdealBackup.store')

describe('findSnapdealByAwb', () => {
  it('matches the return AWB exactly and prefers the fullest row', async () => {
    const hit = await findSnapdealByAwb(' sdlr5005670795 ', 'return')
    expect(hit?.awb).toBe('SDLC1071591128')
    expect(hit?.sku).toBe('8907979260249')
  })

  it('matches the forward AWB on the forward side only', async () => {
    expect((await findSnapdealByAwb('127950287706', 'forward'))?.reverseAwb).toBe('24316550450177')
    expect(await findSnapdealByAwb('127950287706', 'return')).toBeNull()
  })

  it('does not match a partial AWB', async () => {
    expect(await findSnapdealByAwb('SDLR500567', 'return')).toBeNull()
  })
})
