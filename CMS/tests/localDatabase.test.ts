import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

const dir = mkdtempSync(join(tmpdir(), 'local-db-'))

vi.mock('@main/database', () => ({ dataDirectory: () => dir }))
vi.mock('@main/services/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}))

const { JsonCollection } = await import('@main/database/jsonStore')
const service = await import('@main/services/localDatabase.service')

const fileOf = (name: string): unknown => JSON.parse(readFileSync(join(dir, `${name}.json`), 'utf8'))

describe('local database', () => {
  it('lists tables on disk, including ones no store has opened', async () => {
    writeFileSync(join(dir, 'alpha.json'), JSON.stringify([{ a: 1 }, { a: 2 }]))
    writeFileSync(join(dir, 'settings.json'), JSON.stringify({ not: 'a list' }))

    const result = await service.listLocalTables()
    expect(result.success).toBe(true)
    if (!result.success) return

    const byName = Object.fromEntries(result.data.map(table => [table.name, table.rows]))
    expect(byName['alpha']).toBe(2)
    expect(byName['settings']).toBeNull()
  })

  it('pages, searches and collects columns', async () => {
    writeFileSync(
      join(dir, 'paged.json'),
      JSON.stringify(Array.from({ length: 5 }, (_, i) => ({ id: i, name: i % 2 ? 'odd' : 'even' })))
    )

    const page = await service.readLocalTable({ table: 'paged', page: 0, pageSize: 2, search: 'odd' })
    expect(page.success).toBe(true)
    if (!page.success) return

    expect(page.data.matched).toBe(2)
    expect(page.data.total).toBe(5)
    expect(page.data.columns).toEqual(['id', 'name'])
    expect(page.data.rows.map(row => row.index)).toEqual([1, 3])
  })

  it('refuses a table that is not a file in the data folder', async () => {
    const result = await service.readLocalTable({ table: '../outside', page: 0, pageSize: 10 })
    expect(result.success).toBe(false)
  })

  it('updates, inserts and deletes rows in a file nobody opened', async () => {
    writeFileSync(join(dir, 'edit.json'), JSON.stringify([{ v: 1 }, { v: 2 }]))

    expect((await service.updateLocalRow({ table: 'edit', index: 0, expected: { v: 1 }, record: { v: 10 } })).success).toBe(true)
    expect((await service.insertLocalRow({ table: 'edit', record: { v: 3 } })).success).toBe(true)
    expect((await service.deleteLocalRow({ table: 'edit', index: 1, expected: { v: 2 } })).success).toBe(true)

    expect(fileOf('edit')).toEqual([{ v: 10 }, { v: 3 }])
  })

  it('refuses an edit to a row that changed since it was read', async () => {
    writeFileSync(join(dir, 'stale.json'), JSON.stringify([{ v: 1 }]))

    const result = await service.updateLocalRow({ table: 'stale', index: 0, expected: { v: 99 }, record: { v: 2 } })
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.code).toBe('CONFLICT')
    expect(fileOf('stale')).toEqual([{ v: 1 }])
  })

  it('edits through an open store so its cache sees the change', async () => {
    writeFileSync(join(dir, 'open.json'), JSON.stringify([{ v: 1 }]))
    const store = new JsonCollection<{ v: number }>({ name: 'open', directory: dir })
    await store.read()

    await service.updateLocalRow({ table: 'open', index: 0, expected: { v: 1 }, record: { v: 5 } })

    expect(await store.read()).toEqual([{ v: 5 }])
    expect(fileOf('open')).toEqual([{ v: 5 }])
  })
})
