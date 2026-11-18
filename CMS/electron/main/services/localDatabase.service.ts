import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { dataDirectory } from '../database'
import { mutateCollectionFile, readCollectionFile } from '../database/jsonStore'
import { fail, ok, type Result } from '@shared/types/result'
import type {
  LocalRowDelete,
  LocalRowUpdate,
  LocalTable,
  LocalTablePage,
  LocalTableQuery
} from '@shared/types/localDatabase'
import { logger } from './logger'

/**
 * The Local Database page: every JSON collection under `userData/data`.
 *
 * Read from the DIRECTORY rather than from the stores that are open, because
 * most stores open lazily — a backup partition nobody has touched this session
 * is still a table on disk. Writes go through `mutateCollectionFile`, which
 * uses the open store when there is one so its cache cannot overwrite the edit.
 */

const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/
const MAX_PAGE_SIZE = 200

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

/** Collection names present on disk. */
const tableNames = async (): Promise<string[]> => {
  try {
    const entries = await readdir(dataDirectory(), { withFileTypes: true })
    return entries
      .filter(entry => entry.isFile() && entry.name.endsWith('.json'))
      .map(entry => entry.name.slice(0, -'.json'.length))
      .filter(name => NAME.test(name))
      .sort((a, b) => a.localeCompare(b))
  } catch {
    return []
  }
}

/**
 * Only a name that is a file in the data directory — never a path the
 * renderer made up.
 */
const knownTable = async (payload: unknown): Promise<string | null> => {
  const table = isRecord(payload) ? payload['table'] : undefined
  if (typeof table !== 'string' || !NAME.test(table) || table.includes('..')) return null
  return (await tableNames()).includes(table) ? table : null
}

export const listLocalTables = async (): Promise<Result<LocalTable[]>> => {
  const tables: LocalTable[] = []

  for (const name of await tableNames()) {
    try {
      const info = await stat(join(dataDirectory(), `${name}.json`))
      let rows: number | null = null

      try {
        const parsed = await readCollectionFile(dataDirectory(), name)
        rows = Array.isArray(parsed) ? parsed.length : null
      } catch {
        rows = null
      }

      tables.push({ name, rows, bytes: info.size, modifiedAt: info.mtime.toISOString() })
    } catch {
      // Removed between the listing and the stat — leave it out.
    }
  }

  return ok(tables)
}

const textOf = (record: unknown): string => {
  try {
    return JSON.stringify(record).toLowerCase()
  } catch {
    return ''
  }
}

export const readLocalTable = async (payload: unknown): Promise<Result<LocalTablePage>> => {
  const table = await knownTable(payload)
  if (!table || !isRecord(payload)) return fail('NOT_FOUND', 'That table is not on this machine.')

  const query = payload as Partial<LocalTableQuery>
  const pageSize = Math.min(Math.max(Math.trunc(Number(query.pageSize) || 50), 1), MAX_PAGE_SIZE)
  const search = typeof query.search === 'string' ? query.search.trim().toLowerCase() : ''

  let parsed: unknown
  try {
    parsed = await readCollectionFile(dataDirectory(), table)
  } catch (error) {
    logger.warn('Local database: could not read table', { table, error })
    return fail('STORAGE_ERROR', `${table} could not be read — the file is not valid JSON.`)
  }
  if (!Array.isArray(parsed)) return fail('VALIDATION_ERROR', `${table} is not a list of records.`)

  const all = (parsed as unknown[]).map((record, index) => ({ index, record }))
  const matching = search ? all.filter(row => textOf(row.record).includes(search)) : all
  const lastPage = Math.max(Math.ceil(matching.length / pageSize) - 1, 0)
  const page = Math.min(Math.max(Math.trunc(Number(query.page) || 0), 0), lastPage)
  const rows = matching.slice(page * pageSize, (page + 1) * pageSize)

  const columns: string[] = []
  const seen = new Set<string>()
  for (const { record } of rows) {
    if (!isRecord(record) || Array.isArray(record)) continue
    for (const key of Object.keys(record)) {
      if (seen.has(key)) continue
      seen.add(key)
      columns.push(key)
    }
  }

  return ok({ table, total: all.length, matched: matching.length, page, pageSize, columns, rows })
}

const sameRecord = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)

const indexOf = (payload: unknown): number | null => {
  const index = isRecord(payload) ? payload['index'] : undefined
  return typeof index === 'number' && Number.isInteger(index) && index >= 0 ? index : null
}

/** A record must survive JSON — that is all this store can hold. */
const recordOf = (payload: unknown): { value: unknown } | null => {
  if (!isRecord(payload) || !('record' in payload) || payload['record'] === undefined) return null
  try {
    return { value: JSON.parse(JSON.stringify(payload['record'])) as unknown }
  } catch {
    return null
  }
}

const CHANGED = 'This row changed since the page read it. Refresh and try again.'

type Edit = { ok: true } | { ok: false; message: string }

const runEdit = async (
  table: string,
  action: string,
  mutate: (records: unknown[]) => { records: unknown[]; result: Edit }
): Promise<Result<true>> => {
  try {
    const outcome = await mutateCollectionFile(dataDirectory(), table, mutate)
    if (!outcome.ok) return fail('CONFLICT', outcome.message)

    logger.info(`Local database: ${action}`, { table })
    return ok(true)
  } catch (error) {
    logger.warn(`Local database: ${action} failed`, { table, error })
    return fail('STORAGE_ERROR', `${table} could not be saved.`)
  }
}

export const updateLocalRow = async (payload: unknown): Promise<Result<true>> => {
  const table = await knownTable(payload)
  const index = indexOf(payload)
  const record = recordOf(payload)
  if (!table) return fail('NOT_FOUND', 'That table is not on this machine.')
  if (index === null || !record) return fail('VALIDATION_ERROR', 'The row could not be read.')

  const { expected } = payload as LocalRowUpdate

  return runEdit(table, 'row updated', records => {
    if (index >= records.length || !sameRecord(records[index], expected)) {
      return { records, result: { ok: false, message: CHANGED } }
    }
    records[index] = record.value
    return { records, result: { ok: true } }
  })
}

export const deleteLocalRow = async (payload: unknown): Promise<Result<true>> => {
  const table = await knownTable(payload)
  const index = indexOf(payload)
  if (!table) return fail('NOT_FOUND', 'That table is not on this machine.')
  if (index === null) return fail('VALIDATION_ERROR', 'The row could not be read.')

  const { expected } = payload as LocalRowDelete

  return runEdit(table, 'row deleted', records => {
    if (index >= records.length || !sameRecord(records[index], expected)) {
      return { records, result: { ok: false, message: CHANGED } }
    }
    records.splice(index, 1)
    return { records, result: { ok: true } }
  })
}

export const insertLocalRow = async (payload: unknown): Promise<Result<true>> => {
  const table = await knownTable(payload)
  const record = recordOf(payload)
  if (!table) return fail('NOT_FOUND', 'That table is not on this machine.')
  if (!record) return fail('VALIDATION_ERROR', 'The row could not be read.')

  return runEdit(table, 'row added', records => {
    records.push(record.value)
    return { records, result: { ok: true } }
  })
}
