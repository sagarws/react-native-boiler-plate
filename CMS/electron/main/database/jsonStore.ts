import { access, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * Durable JSON collection backed by a single file.
 *
 * Chosen over a native database (better-sqlite3 and friends) because this app's
 * persistence needs are small and native modules are the single biggest
 * cross-platform packaging risk - see docs/CROSS_PLATFORM_DEVELOPMENT_GUIDELINES.md.
 *
 * Writes are atomic (temp file + rename) so an interrupted write can never leave
 * a truncated file behind, and every mutation is serialised through a promise
 * chain so concurrent IPC calls cannot interleave read-modify-write cycles.
 */
export interface JsonCollectionOptions {
  /** Collection name; becomes <name>.json inside `directory`. */
  name: string
  /** Absolute directory, supplied by the caller so this module never guesses a path. */
  directory: string
}

/**
 * Every collection opened in this process.
 *
 * Kept so that "forget everything on this machine" can be one operation rather
 * than a list somebody has to remember to extend. A store added next year is
 * cleared by signing out without anybody touching the sign-out code — and the
 * direction that fails is the safe one: a new store is wiped rather than
 * silently kept behind after an operator asked for their data to be gone.
 */
const opened = new Set<JsonCollection<unknown>>()

export class JsonCollection<T> {
  readonly #file: string
  readonly #tempFile: string
  readonly #directory: string
  readonly #name: string
  #cache: T[] | null = null
  #queue: Promise<unknown> = Promise.resolve()

  constructor(options: JsonCollectionOptions) {
    this.#directory = options.directory
    this.#name = options.name
    this.#file = join(options.directory, `${options.name}.json`)
    this.#tempFile = join(options.directory, `${options.name}.json.tmp`)
    opened.add(this)
  }

  get name(): string {
    return this.#name
  }

  /**
   * Empties the collection: the file AND the in-memory copy.
   *
   * Both, because they are two halves of the same answer — deleting the file
   * while a cache survives means the next write puts it all back, which is the
   * kind of "cleared" that is worse than not clearing at all.
   */
  async clear(): Promise<void> {
    await this.mutate(() => ({ records: [] as T[], result: undefined }))
  }

  get filePath(): string {
    return this.#file
  }

  async read(): Promise<T[]> {
    if (this.#cache) return this.#cache

    try {
      const raw = await readFile(this.#file, 'utf8')
      const parsed: unknown = JSON.parse(raw)
      this.#cache = Array.isArray(parsed) ? (parsed as T[]) : []
    } catch (error) {
      if (isNotFound(error)) {
        // First run: an empty collection is the correct state, not an error.
        this.#cache = []
      } else {
        throw error
      }
    }

    return this.#cache
  }

  /**
   * Runs `mutate` against the current records and persists whatever it returns.
   * Serialised: each call waits for the previous one to finish.
   */
  async mutate<R>(mutate: (records: T[]) => { records: T[]; result: R } | Promise<{ records: T[]; result: R }>): Promise<R> {
    const run = this.#queue.then(async () => {
      const current = await this.read()
      const { records, result } = await mutate([...current])
      await this.#persist(records)
      return result
    })

    // Keep the chain alive even when a mutation rejects.
    this.#queue = run.catch(() => undefined)
    return run
  }

  /**
   * Writes the file now if there is none yet, as an empty list.
   *
   * A collection otherwise appears on disk only at its first record, so a store
   * that exists per task shows up in the Local Database page one task at a time,
   * whenever each happens to run. An existing file is left exactly as it is.
   */
  async ensureFile(): Promise<void> {
    try {
      await access(this.#file)
    } catch (error) {
      if (!isNotFound(error)) throw error

      await this.mutate(records => ({ records, result: undefined }))
    }
  }

  async #persist(records: T[]): Promise<void> {
    await mkdir(this.#directory, { recursive: true })
    await writeFile(this.#tempFile, JSON.stringify(records, null, 2), 'utf8')
    // fs.rename replaces an existing destination on both Windows and POSIX.
    await rename(this.#tempFile, this.#file)
    this.#cache = records
  }
}

const isNotFound = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && (error as { code?: string }).code === 'ENOENT'

/** The most recently opened collection for this file, if any store has opened it. */
const openedFor = (directory: string, name: string): JsonCollection<unknown> | undefined => {
  const file = join(directory, `${name}.json`)
  let found: JsonCollection<unknown> | undefined

  for (const collection of opened) {
    if (collection.filePath === file) found = collection
  }

  return found
}

/** Serialises direct writes to files no store has opened yet. */
const directQueues = new Map<string, Promise<unknown>>()

/**
 * Reads a collection file as it stands — through the store's own copy when one
 * has it open, so the Local Database page sees what the app sees.
 *
 * Returns the parsed JSON, which is NOT necessarily a list.
 */
export const readCollectionFile = async (directory: string, name: string): Promise<unknown> => {
  const collection = openedFor(directory, name)
  if (collection) return collection.read()

  try {
    return JSON.parse(await readFile(join(directory, `${name}.json`), 'utf8')) as unknown
  } catch (error) {
    if (isNotFound(error)) return []
    throw error
  }
}

/**
 * Edits a collection file from outside the store that owns it.
 *
 * Through the open collection when there is one: its cache and its write queue
 * are the truth, and writing the file behind its back would be overwritten by
 * the store's next save. When nothing has opened it, the file is rewritten the
 * same atomic way (temp file + rename), serialised per file — and the store
 * that opens it later reads the edited file.
 */
export const mutateCollectionFile = async <R>(
  directory: string,
  name: string,
  mutate: (records: unknown[]) => { records: unknown[]; result: R }
): Promise<R> => {
  const collection = openedFor(directory, name)
  if (collection) return collection.mutate(mutate)

  const file = join(directory, `${name}.json`)
  const previous = directQueues.get(file) ?? Promise.resolve()
  const run = previous.then(async () => {
    const parsed = await readCollectionFile(directory, name)
    if (!Array.isArray(parsed)) throw new Error(`${name} is not a list of records`)

    const { records, result } = mutate([...(parsed as unknown[])])
    const temp = `${file}.tmp`

    await mkdir(directory, { recursive: true })
    await writeFile(temp, JSON.stringify(records, null, 2), 'utf8')
    await rename(temp, file)
    return result
  })

  directQueues.set(file, run.catch(() => undefined))
  return run
}

/**
 * Empties every open collection except the ones a caller asks to keep.
 *
 * `keep` is given the collection NAME — the same string the store was opened
 * with — so the decision reads as a list of what survives rather than a list of
 * what goes, which is the half that must not be forgotten.
 *
 * Best effort per collection: one file that will not write must not leave the
 * rest of an operator's data on the machine.
 */
export const clearCollections = async (
  keep: (name: string) => boolean
): Promise<{ cleared: string[]; failed: string[] }> => {
  const cleared: string[] = []
  const failed: string[] = []

  for (const collection of opened) {
    if (keep(collection.name)) continue

    try {
      await collection.clear()
      cleared.push(collection.name)
    } catch {
      failed.push(collection.name)
    }
  }

  return { cleared, failed }
}
