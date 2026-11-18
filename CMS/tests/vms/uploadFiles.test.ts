import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  getStaged,
  pathInside,
  resolveMimetype,
  sanitiseUploadName,
  stageFile,
  toQueueInput,
  type StagedFile
} from '@main/vms/uploadFiles'
import { isAllowedOrigin } from '@main/vms/sidecar.service'

/**
 * The recorder → local server contract that replaced Argos' multer: file
 * names, the staging write, and the text fields read into the queue row.
 */

describe('sanitiseUploadName', () => {
  it('keeps a recorder name and applies Argos’ character rule', () => {
    expect(sanitiseUploadName(encodeURIComponent('recording-1700000000000.webm'))).toEqual({
      original: 'recording-1700000000000.webm',
      safe: 'recording-1700000000000.webm'
    })
    expect(sanitiseUploadName(encodeURIComponent('screen shot (1).jpg'))?.safe).toBe('screen_shot__1_.jpg')
    expect(sanitiseUploadName('.hidden.jpg')?.safe).toBe('hidden.jpg')
  })

  it('refuses path tricks, NULs, empties and undecodable values', () => {
    for (const bad of [
      encodeURIComponent('../etc/passwd'),
      encodeURIComponent('..\\boot.ini'),
      encodeURIComponent('a/b.webm'),
      encodeURIComponent('C:\\x.webm'),
      encodeURIComponent('x\0.webm'),
      encodeURIComponent('..'),
      '%E0%A4%A',
      '',
      undefined,
      ['a']
    ]) {
      expect(sanitiseUploadName(bad)).toBeNull()
    }
  })

  it('never resolves outside the uploads folder', () => {
    expect(pathInside('/data/vms-uploads', 'x.webm')).toBe(join('/data/vms-uploads', 'x.webm'))
    expect(pathInside('/data/vms-uploads', '../x.webm')).toBeNull()
  })

  it('keeps the part’s media type, else guesses from the extension', () => {
    expect(resolveMimetype('video/webm;codecs=vp9,opus', 'a.webm')).toBe('video/webm;codecs=vp9,opus')
    expect(resolveMimetype('text/html', 'a.jpg')).toBe('image/jpeg')
    expect(resolveMimetype(undefined, 'a.bin')).toBe('application/octet-stream')
  })
})

describe('stageFile', () => {
  let directory = ''
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'vms-stage-'))
  })
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true })
  })

  it('writes the body under a fresh id and remembers it once', async () => {
    const staged = await stageFile(directory, Readable.from([Buffer.from('abc'), Buffer.from('de')]), 'clip.webm', 'video/webm')
    if ('error' in staged) throw new Error(staged.error)
    expect(staged.size).toBe(5)
    expect(staged.name).toBe('clip.webm')
    expect(await readdir(directory)).toEqual([`${staged.id}-clip.webm`])
    expect(getStaged(staged.id)?.path).toBe(staged.path)
    expect(getStaged('not-an-id')).toBeNull()
  })

  it('refuses a bad name before writing anything', async () => {
    const staged = await stageFile(directory, Readable.from([Buffer.from('x')]), encodeURIComponent('../x'), '')
    expect(staged).toEqual({ error: 'x-file-name is missing or not a plain file name' })
    expect(await readdir(directory)).toEqual([])
  })
})

describe('toQueueInput (Argos /upload fields)', () => {
  const video: StagedFile = { id: 'v', path: '/u/v.webm', name: 'recording-1.webm', mimetype: 'video/webm', size: 1234, stagedAt: 0 }
  const shot: StagedFile = { id: 's', path: '/u/s.jpg', name: 'screenshot-1.jpg', mimetype: 'image/jpeg', size: 9, stagedAt: 0 }

  it('reads the fields exactly as Argos did', () => {
    expect(
      toQueueInput(
        {
          trackingId: ' AWB1_S2 ',
          orderType: 'Return',
          size: '999',
          videoDuration: '12.7',
          start_time: '1700000000000',
          keepOld: 'false',
          needRefund: 'true',
          orderCondition: '2',
          eCommercePlatform: 'Meesho'
        },
        video,
        [shot]
      )
    ).toEqual({
      file: { path: '/u/v.webm', name: 'recording-1.webm', mimetype: 'video/webm' },
      files: [{ path: '/u/s.jpg', name: 'screenshot-1.jpg', mimetype: 'image/jpeg' }],
      trackingId: 'AWB1_S2',
      size: 1234,
      length: 12,
      orderType: 'Return',
      orderCondition: 2,
      start_time: '1700000000000',
      keepOld: false,
      needRefund: true,
      eCommercePlatform: 'Meesho'
    })
  })

  it('maps an empty orderCondition to null and requires trackingId + orderType', () => {
    const parsed = toQueueInput({ trackingId: 'A', orderType: 'Forward', orderCondition: '' }, video, [])
    expect('error' in parsed ? null : parsed.orderCondition).toBeNull()
    expect(toQueueInput({ trackingId: 'A' }, video, [])).toEqual({ error: 'trackingId and orderType are required' })
  })
})

describe('isAllowedOrigin', () => {
  it('accepts no origin, a file:// page and the dev server only', () => {
    expect(isAllowedOrigin(undefined, null)).toBe(true)
    expect(isAllowedOrigin('null', null)).toBe(true)
    expect(isAllowedOrigin('file://', null)).toBe(true)
    expect(isAllowedOrigin('http://localhost:5173', 'http://localhost:5173')).toBe(true)
    expect(isAllowedOrigin('http://localhost:5173', null)).toBe(false)
    expect(isAllowedOrigin('https://evil.example', 'http://localhost:5173')).toBe(false)
  })
})
