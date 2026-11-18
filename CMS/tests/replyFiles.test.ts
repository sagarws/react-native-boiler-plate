import { existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'

/** A ticket reply's files exist on disk only while they are being uploaded. */

vi.mock('electron', () => ({ app: { getPath: () => tmpdir() } }))

const { withReplyFilesOnDisk } = await import('@main/automations/common/replyFiles')

const file = (name: string, text: string) => ({
  name,
  mimeType: 'image/png',
  data: new TextEncoder().encode(text),
  video: false
})

describe('withReplyFilesOnDisk', () => {
  it('writes each file under its own name, then removes them all', async () => {
    let seen: string[] = []

    await withReplyFilesOnDisk([file('1.png', 'a'), file('1.png', 'b')], (onDisk) => {
      seen = onDisk.map((entry) => entry.path)

      // The same name twice, and neither overwrote the other.
      expect(onDisk.map((entry) => path.basename(entry.path))).toEqual(['1.png', '1.png'])
      expect(onDisk.map((entry) => readFileSync(entry.path, 'utf8'))).toEqual(['a', 'b'])

      return Promise.resolve()
    })

    expect(seen.length).toBe(2)
    expect(seen.every((entry) => !existsSync(entry))).toBe(true)
  })

  it('cleans up when the upload fails', async () => {
    let seen = ''

    await expect(
      withReplyFilesOnDisk([file('x.png', 'a')], (onDisk) => {
        seen = onDisk[0]?.path ?? ''

        return Promise.reject(new Error('upload refused'))
      })
    ).rejects.toThrow('upload refused')

    expect(seen).not.toBe('')
    expect(existsSync(seen)).toBe(false)
  })
})
