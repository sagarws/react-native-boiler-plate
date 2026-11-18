import { createReadStream, createWriteStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { once } from 'node:events'

/**
 * A ZIP writer for files already on disk, with no dependency.
 *
 * Every entry is STORED, not deflated. What goes in here is claim evidence —
 * JPEGs, PNGs, MP4s — which are compressed formats already; deflate would spend
 * CPU for a few bytes, and "stored" is the one ZIP method every unzip tool on
 * Windows and macOS reads. A few kilobytes of text ride along uncompressed.
 *
 * Streams file contents, so a 300 MB video never sits in memory. Classic ZIP
 * only (no ZIP64): each file and the archive must stay under 4 GiB and 65 535
 * entries, which a single claim never approaches — exceeding either throws
 * rather than writing an archive that tools would read as corrupt.
 *
 * Kept here rather than pulling in a zip package: the guidelines want a
 * dependency only when a built-in is not enough, and this is ~100 lines over
 * `node:fs`.
 */

export interface ZipEntry {
  /** Path inside the archive, forward slashes. */
  name: string
  /** A file on disk, or the entry's text content. */
  source: { path: string } | { text: string }
}

const ZIP32_LIMIT = 0xffffffff
const MAX_ENTRIES = 0xffff

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)

  for (let n = 0; n < 256; n++) {
    let c = n

    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }

  return table
})()

/** Incremental CRC-32 (the ZIP polynomial). Start with 0. */
export const crc32 = (chunk: Uint8Array, previous = 0): number => {
  let crc = ~previous >>> 0

  for (let i = 0; i < chunk.length; i++) {
    crc = (CRC_TABLE[(crc ^ (chunk[i] as number)) & 0xff] as number) ^ (crc >>> 8)
  }

  return ~crc >>> 0
}

/** MS-DOS date and time, which is what ZIP headers store. */
const dosDateTime = (date: Date): { time: number; date: number } => ({
  time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
  date: (Math.max(0, date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
})

const fileCrc = async (path: string): Promise<number> => {
  let crc = 0

  for await (const chunk of createReadStream(path)) crc = crc32(chunk as Buffer, crc)

  return crc
}

/** Writes `entries` to `outputPath` as a ZIP archive. */
export const writeZip = async (outputPath: string, entries: readonly ZipEntry[]): Promise<void> => {
  if (entries.length > MAX_ENTRIES) throw new Error(`A zip holds at most ${MAX_ENTRIES} files`)

  const out = createWriteStream(outputPath)
  const failed = once(out, 'error').then(([error]) => {
    throw error
  })
  // Raced below at every await; this only stops an error that lands between
  // awaits from surfacing as an unhandled rejection.
  failed.catch(() => undefined)
  const write = async (chunk: Buffer): Promise<void> => {
    if (!out.write(chunk)) await Promise.race([once(out, 'drain'), failed])
  }

  const { time, date } = dosDateTime(new Date())
  const central: Buffer[] = []
  let offset = 0

  try {
    for (const entry of entries) {
      const name = Buffer.from(entry.name.replace(/\\/g, '/'), 'utf8')
      const text = 'text' in entry.source ? Buffer.from(entry.source.text, 'utf8') : null
      const size = text ? text.length : (await stat((entry.source as { path: string }).path)).size
      const crc = text ? crc32(text) : await fileCrc((entry.source as { path: string }).path)

      if (size >= ZIP32_LIMIT || offset >= ZIP32_LIMIT) {
        throw new Error(`${entry.name} is too large for a zip archive (4 GiB limit)`)
      }

      // Local file header. Flag bit 11: the name is UTF-8.
      const local = Buffer.alloc(30)
      local.writeUInt32LE(0x04034b50, 0)
      local.writeUInt16LE(20, 4)
      local.writeUInt16LE(0x0800, 6)
      local.writeUInt16LE(0, 8)
      local.writeUInt16LE(time, 10)
      local.writeUInt16LE(date, 12)
      local.writeUInt32LE(crc, 14)
      local.writeUInt32LE(size, 18)
      local.writeUInt32LE(size, 22)
      local.writeUInt16LE(name.length, 26)
      local.writeUInt16LE(0, 28)

      await write(local)
      await write(name)

      if (text) {
        await write(text)
      } else {
        for await (const chunk of createReadStream((entry.source as { path: string }).path)) {
          await write(chunk as Buffer)
        }
      }

      const header = Buffer.alloc(46)
      header.writeUInt32LE(0x02014b50, 0)
      header.writeUInt16LE(20, 4)
      header.writeUInt16LE(20, 6)
      header.writeUInt16LE(0x0800, 8)
      header.writeUInt16LE(0, 10)
      header.writeUInt16LE(time, 12)
      header.writeUInt16LE(date, 14)
      header.writeUInt32LE(crc, 16)
      header.writeUInt32LE(size, 20)
      header.writeUInt32LE(size, 24)
      header.writeUInt16LE(name.length, 28)
      header.writeUInt32LE(offset, 42)
      central.push(header, name)

      offset += local.length + name.length + size
    }

    const centralSize = central.reduce((sum, part) => sum + part.length, 0)

    if (offset + centralSize >= ZIP32_LIMIT) throw new Error('The zip would exceed 4 GiB')

    for (const part of central) await write(part)

    const end = Buffer.alloc(22)
    end.writeUInt32LE(0x06054b50, 0)
    end.writeUInt16LE(entries.length, 8)
    end.writeUInt16LE(entries.length, 10)
    end.writeUInt32LE(centralSize, 12)
    end.writeUInt32LE(offset, 16)
    await write(end)
  } catch (error) {
    out.destroy()
    throw error
  }

  out.end()
  await Promise.race([once(out, 'finish'), failed])
}
