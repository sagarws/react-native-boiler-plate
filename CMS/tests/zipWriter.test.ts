import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { crc32 as zlibCrc32 } from 'node:zlib'
import { afterEach, describe, expect, it } from 'vitest'
import { crc32, writeZip } from '@main/automations/common/zipWriter'

/**
 * The claim-resource zip is read by whatever unzip tool the operator has, on
 * Windows or macOS. These tests parse the archive back the way those tools do
 * — from the central directory at the END — and check every byte and CRC.
 */

let dir = ''

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true })
})

interface Parsed {
  name: string
  data: Buffer
  crc: number
  flags: number
}

const readZip = (archive: Buffer): Parsed[] => {
  const eocd = archive.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
  expect(eocd).toBeGreaterThan(-1)

  const count = archive.readUInt16LE(eocd + 10)
  let at = archive.readUInt32LE(eocd + 16)
  const entries: Parsed[] = []

  for (let i = 0; i < count; i++) {
    expect(archive.readUInt32LE(at)).toBe(0x02014b50)
    const flags = archive.readUInt16LE(at + 8)
    const method = archive.readUInt16LE(at + 10)
    const crc = archive.readUInt32LE(at + 16)
    const size = archive.readUInt32LE(at + 24)
    const nameLength = archive.readUInt16LE(at + 28)
    const localOffset = archive.readUInt32LE(at + 42)
    const name = archive.subarray(at + 46, at + 46 + nameLength).toString('utf8')

    expect(method).toBe(0)
    expect(archive.readUInt32LE(localOffset)).toBe(0x04034b50)

    const localNameLength = archive.readUInt16LE(localOffset + 26)
    const start = localOffset + 30 + localNameLength

    entries.push({ name, data: archive.subarray(start, start + size), crc, flags })
    at += 46 + nameLength
  }

  return entries
}

describe('crc32', () => {
  it('matches zlib, including when fed in chunks', () => {
    const data = Buffer.from('The quick brown fox jumps over the lazy dog')

    expect(crc32(data)).toBe(zlibCrc32(data))
    expect(crc32(data.subarray(10), crc32(data.subarray(0, 10)))).toBe(zlibCrc32(data))
  })
})

describe('writeZip', () => {
  it('stores files and text so they read back byte for byte', async () => {
    dir = mkdtempSync(join(tmpdir(), 'zip-test-'))
    const image = Buffer.from(Array.from({ length: 5000 }, (_, i) => i % 256))
    writeFileSync(join(dir, 'a.jpg'), image)

    await writeZip(join(dir, 'out.zip'), [
      { name: 'claim_details.txt', source: { text: 'Return AWB  SDLC1078334569\n' } },
      { name: 'outer_packaging_packslip_image1.jpg', source: { path: join(dir, 'a.jpg') } },
      { name: 'supporting/return_video.mp4', source: { path: join(dir, 'a.jpg') } },
      // Non-ASCII survives because the UTF-8 flag is set.
      { name: 'SDLC1078334569 - Side Images ₹.pdf', source: { text: '%PDF' } }
    ])

    const entries = readZip(readFileSync(join(dir, 'out.zip')))

    expect(entries.map(e => e.name)).toEqual([
      'claim_details.txt',
      'outer_packaging_packslip_image1.jpg',
      'supporting/return_video.mp4',
      'SDLC1078334569 - Side Images ₹.pdf'
    ])
    expect(entries[0]?.data.toString()).toBe('Return AWB  SDLC1078334569\n')
    expect(entries[1]?.data.equals(image)).toBe(true)

    for (const entry of entries) {
      expect(entry.crc).toBe(zlibCrc32(entry.data))
      expect(entry.flags & 0x0800).toBe(0x0800)
    }
  })

  it('streams a file larger than one read chunk', async () => {
    dir = mkdtempSync(join(tmpdir(), 'zip-test-'))
    const big = Buffer.alloc(3 * 1024 * 1024 + 17, 7)
    big[123456] = 1
    writeFileSync(join(dir, 'video.mp4'), big)

    await writeZip(join(dir, 'out.zip'), [{ name: 'video.mp4', source: { path: join(dir, 'video.mp4') } }])

    const [entry] = readZip(readFileSync(join(dir, 'out.zip')))

    expect(entry?.data.equals(big)).toBe(true)
    expect(entry?.crc).toBe(zlibCrc32(big))
  })
})
