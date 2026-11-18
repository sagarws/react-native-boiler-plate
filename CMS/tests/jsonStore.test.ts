import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { JsonCollection } from '@main/database/jsonStore'

/**
 * JsonCollection is the app's only persistence primitive: the claim queue, the
 * encrypted marketplace sessions and the import schedule all write through it.
 * Its two guarantees — a bad file never throws, and concurrent mutations never
 * lose a write — are what the rest of the app assumes.
 */

interface Row {
  id: string
  name: string
}

let directory: string

beforeEach(async () => {
  // os.tmpdir() + mkdtemp keeps this test platform-neutral.
  directory = await mkdtemp(join(tmpdir(), 'trackvid-test-'))
})

afterEach(async () => {
  await rm(directory, { recursive: true, force: true })
})

describe('JsonCollection', () => {
  it('treats a missing file as an empty collection', async () => {
    const collection = new JsonCollection<Row>({ name: 'missing', directory })

    await expect(collection.read()).resolves.toEqual([])
  })

  it('recovers from a file that is valid JSON of the wrong shape', async () => {
    await writeFile(join(directory, 'shape.json'), '{"not":"an array"}', 'utf8')
    const collection = new JsonCollection<Row>({ name: 'shape', directory })

    await expect(collection.read()).resolves.toEqual([])
  })

  it('serialises concurrent mutations without losing writes', async () => {
    // Each mutation is a read-modify-write. Twenty in flight at once is exactly
    // the case that loses records if they are not queued — and it is a real
    // case: several claim dispatches can land in the same tick.
    const collection = new JsonCollection<Row>({ name: 'rows', directory })

    await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        collection.mutate(records => ({
          records: [...records, { id: String(index), name: `Row ${index}` }],
          result: undefined
        }))
      )
    )

    const raw = await readFile(join(directory, 'rows.json'), 'utf8')

    expect(JSON.parse(raw)).toHaveLength(20)
  })

  it('keeps the mutation queue alive after one rejects', async () => {
    // A throwing mutation must not wedge the chain, or one bad write would stop
    // every later one for the lifetime of the process.
    const collection = new JsonCollection<Row>({ name: 'resilient', directory })

    await expect(
      collection.mutate(() => {
        throw new Error('boom')
      })
    ).rejects.toThrow('boom')

    await collection.mutate(records => ({
      records: [...records, { id: '1', name: 'after' }],
      result: undefined
    }))

    await expect(collection.read()).resolves.toEqual([{ id: '1', name: 'after' }])
  })

  it('creates an empty file on ensureFile, so the table is visible before its first row', async () => {
    const collection = new JsonCollection<Row>({ name: 'fresh', directory })

    await collection.ensureFile()

    expect(JSON.parse(await readFile(join(directory, 'fresh.json'), 'utf8'))).toEqual([])
  })

  it('leaves an existing file exactly as it is on ensureFile', async () => {
    const rows: Row[] = [{ id: '1', name: 'kept' }]

    await writeFile(join(directory, 'existing.json'), JSON.stringify(rows), 'utf8')

    const collection = new JsonCollection<Row>({ name: 'existing', directory })

    await collection.ensureFile()

    expect(await readFile(join(directory, 'existing.json'), 'utf8')).toBe(JSON.stringify(rows))
  })
})
