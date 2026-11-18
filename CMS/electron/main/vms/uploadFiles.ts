import { randomUUID } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdir, readdir, rm, stat } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import type { Readable } from 'node:stream'
import type { QueueEntryInput } from '@shared/vms/queue'

/**
 * The recorder's files, staged one request at a time — the CMS replacement for
 * Argos' multer.
 *
 *   POST /upload/file   raw bytes, `x-file-name` (URI-encoded), `content-type`
 *                       → the file is written to <userData>/vms-uploads/ and a
 *                         one-use id comes back.
 *   POST /upload        JSON naming those ids plus Argos' text fields → one
 *                       queue row, exactly as Argos' multipart /upload made it.
 *
 * Pure helpers (name checks, field parsing) are exported for tests.
 */

/** Argos' multer cap: 500 MB per file. */
export const MAX_FILE_BYTES = 500 * 1024 * 1024
/** Argos accepted up to 30 screenshots per recording. */
export const MAX_SCREENSHOTS = 30
const MAX_NAME_LENGTH = 120

export interface StagedFile {
  id: string
  path: string
  /** The name the renderer gave (Argos' `originalname`). */
  name: string
  mimetype: string
  size: number
  stagedAt: number
}

/**
 * Validates and sanitises `x-file-name`.
 *
 * Refused outright (null): an undecodable value, an empty one, anything with a
 * path separator, a NUL or a `..` segment — a client that sends one is not the
 * recorder. Otherwise every character outside `[A-Za-z0-9._-]` becomes `_`
 * (Argos' own rule) and leading dots are dropped, so the name can never
 * address anything but a plain file in the uploads folder.
 */
export const sanitiseUploadName = (header: unknown): { original: string; safe: string } | null => {
  if (typeof header !== 'string' || header.length === 0 || header.length > 1024) return null
  let decoded: string
  try {
    decoded = decodeURIComponent(header)
  } catch {
    return null
  }
  const original = decoded.trim()
  if (!original || /[/\\\0]/.test(original) || original === '.' || original.includes('..')) return null
  const safe = original
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/^\.+/, '')
    .slice(-MAX_NAME_LENGTH)
  return { original, safe: safe || 'file' }
}

const DEFAULT_TYPES: Record<string, string> = {
  webm: 'video/webm',
  mp4: 'video/mp4',
  mkv: 'video/x-matroska',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png'
}

/** The part's content type, as multer reported it; a guess by extension when absent or odd. */
export const resolveMimetype = (header: unknown, name: string): string => {
  const value = typeof header === 'string' ? header.trim() : ''
  if (/^(video|image)\/[a-z0-9.+-]+(;.{0,80})?$/i.test(value)) return value
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  return DEFAULT_TYPES[ext] ?? 'application/octet-stream'
}

/** A path inside `directory`, or null when joining would escape it. */
export const pathInside = (directory: string, fileName: string): string | null => {
  const root = resolve(directory)
  const target = resolve(root, fileName)
  return target.startsWith(root + sep) ? target : null
}

export class UploadTooLargeError extends Error {
  constructor() {
    super(`File exceeds ${MAX_FILE_BYTES / (1024 * 1024)} MB`)
    this.name = 'UploadTooLargeError'
  }
}

const staged = new Map<string, StagedFile>()

/**
 * Streams one request body to disk. Rejects (and removes the partial file)
 * when the body passes MAX_FILE_BYTES or the stream fails.
 */
export const stageFile = async (
  directory: string,
  body: Readable,
  nameHeader: unknown,
  typeHeader: unknown
): Promise<StagedFile | { error: string }> => {
  const name = sanitiseUploadName(nameHeader)
  if (!name) return { error: 'x-file-name is missing or not a plain file name' }

  const id = randomUUID()
  const path = pathInside(directory, `${id}-${name.safe}`)
  if (!path) return { error: 'x-file-name is not a plain file name' }

  await mkdir(directory, { recursive: true })
  const size = await new Promise<number>((resolvePromise, reject) => {
    let bytes = 0
    let settled = false
    const out = createWriteStream(path, { flags: 'wx' })
    const finish = (error: Error | null): void => {
      if (settled) return
      settled = true
      if (error) {
        body.unpipe(out)
        out.destroy()
        reject(error)
      } else {
        resolvePromise(bytes)
      }
    }
    body.on('data', (chunk: Buffer) => {
      bytes += chunk.length
      if (bytes > MAX_FILE_BYTES) {
        finish(new UploadTooLargeError())
        body.resume()
      }
    })
    body.on('error', (error) => finish(error))
    body.on('aborted', () => finish(new Error('Upload aborted')))
    out.on('error', (error) => finish(error))
    out.on('finish', () => finish(null))
    body.pipe(out)
  }).catch(async (error: unknown) => {
    await rm(path, { force: true })
    throw error
  })

  const file: StagedFile = {
    id,
    path,
    name: name.original,
    mimetype: resolveMimetype(typeHeader, name.original),
    size,
    stagedAt: Date.now()
  }
  staged.set(id, file)
  return file
}

const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const getStaged = (id: unknown): StagedFile | null =>
  typeof id === 'string' && ID_PATTERN.test(id) ? (staged.get(id) ?? null) : null

/** Removes ids from the staging table once a queue row owns their files. */
export const releaseStaged = (ids: readonly string[]): void => {
  for (const id of ids) staged.delete(id)
}

/** Paths the staging table still owns (not yet committed by /upload). */
export const stagedPaths = (): Set<string> => new Set([...staged.values()].map((file) => file.path))

const readBool = (value: unknown): boolean => value === 'true' || value === true
const readInt = (value: unknown, fallback = 0): number => {
  const n = Number(value)
  return Number.isFinite(n) ? Math.floor(n) : fallback
}
const readString = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

/**
 * The text fields of Argos' multipart /upload → the queue row input, read
 * exactly as Argos read them. `size` is the bytes actually received, not the
 * client's claim (Argos used multer's file.size the same way).
 */
export const toQueueInput = (
  fields: Record<string, unknown>,
  video: StagedFile,
  screenshots: readonly StagedFile[]
): QueueEntryInput | { error: string } => {
  const trackingId = readString(fields['trackingId'])
  const orderType = readString(fields['orderType'])
  if (!trackingId || !orderType) return { error: 'trackingId and orderType are required' }
  return {
    file: { path: video.path, name: video.name, mimetype: video.mimetype },
    files: screenshots.map((shot) => ({ path: shot.path, name: shot.name, mimetype: shot.mimetype })),
    trackingId,
    size: video.size,
    length: readInt(fields['videoDuration']),
    orderType,
    orderCondition: fields['orderCondition'] === '' ? null : readInt(fields['orderCondition'], 0) || null,
    start_time: readString(fields['start_time']) || String(Date.now()),
    keepOld: readBool(fields['keepOld']),
    needRefund: readBool(fields['needRefund']),
    eCommercePlatform: readString(fields['eCommercePlatform'])
  }
}

/**
 * Deletes files in the uploads folder that nothing owns — no queue row, not
 * staged — and are older than `minAgeMs`. These are recordings staged but
 * never committed, compression leftovers, and files whose rows were cleared.
 */
export const sweepOrphans = async (
  directory: string,
  owned: ReadonlySet<string>,
  minAgeMs: number
): Promise<number> => {
  let removed = 0
  let entries: string[]
  try {
    entries = await readdir(directory)
  } catch {
    return 0
  }
  const now = Date.now()
  for (const entry of entries) {
    const path = join(directory, entry)
    if (owned.has(path) || stagedPaths().has(path)) continue
    // A remux / compression intermediate of an owned recording is in use.
    if ([...owned].some((own) => path.startsWith(own.replace(/\.[^.]+$/, '') + '.'))) continue
    try {
      const info = await stat(path)
      if (!info.isFile() || now - info.mtimeMs < minAgeMs) continue
      await rm(path, { force: true })
      removed += 1
    } catch {
      // Gone already, or locked: the next sweep will look again.
    }
  }
  return removed
}
