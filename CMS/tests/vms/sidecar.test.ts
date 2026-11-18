import { mkdtempSync } from 'node:fs'
import { readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

/**
 * The local server end to end on loopback: stage a recording and a
 * screenshot, commit them with Argos' fields, and read Argos' /upload answer.
 * No ffmpeg, no camera, no network beyond 127.0.0.1.
 */

interface State {
  userData: string
  feed: { feedId: string } | null
}

const state = vi.hoisted<State>(() => ({ userData: '', feed: { feedId: 'feed-a' } }))

vi.mock('electron', () => ({ app: { getPath: () => state.userData } }))
vi.mock('@main/services/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))
vi.mock('@main/ipc/broadcast', () => ({ broadcast: vi.fn() }))
vi.mock('@main/vms/feedSession.service', () => ({ getFeedSession: () => state.feed }))

state.userData = mkdtempSync(join(tmpdir(), 'vms-sidecar-'))

const { JsonCollection } = await import('@main/database/jsonStore')
const queue = await import('@main/vms/queue.store')
const sidecar = await import('@main/vms/sidecar.service')

let base = ''

beforeAll(async () => {
  queue.useQueueCollection(new JsonCollection({ name: queue.QUEUE_COLLECTION, directory: join(state.userData, 'data') }))
  base = `http://127.0.0.1:${await sidecar.startSidecar()}`
})

afterAll(async () => {
  await sidecar.stopSidecar()
  queue.useQueueCollection(null)
  await rm(state.userData, { recursive: true, force: true })
})

const stage = async (name: string, type: string, bytes: string): Promise<Response> =>
  fetch(`${base}/upload/file`, {
    method: 'POST',
    headers: { 'x-file-name': encodeURIComponent(name), 'content-type': type },
    body: bytes
  })

describe('local server', () => {
  it('answers /health', async () => {
    const response = await fetch(`${base}/health`)
    expect(await response.json()).toEqual({ ok: true, port: sidecar.getSidecarPort() })
  })

  it('stages files and queues them with Argos’ fields and response', async () => {
    const video = (await (await stage('recording-1.webm', 'video/webm', 'videobytes')).json()) as {
      success: boolean
      data: { id: string }
      id: string
    }
    const shot = (await (await stage('screenshot-1.jpg', 'image/jpeg', 'jpg')).json()) as { id: string }
    expect(video.success).toBe(true)
    expect(video.data.id).toBe(video.id)

    const response = await fetch(`${base}/upload`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'null' },
      body: JSON.stringify({
        file: video.id,
        files: [shot.id],
        fields: {
          trackingId: 'AWB1',
          orderType: 'Forward',
          size: '10',
          videoDuration: '3',
          start_time: '1700000000000',
          keepOld: 'false',
          needRefund: 'false',
          orderCondition: '',
          eCommercePlatform: 'Meesho'
        }
      })
    })
    expect(response.headers.get('access-control-allow-origin')).toBe('null')
    const body = (await response.json()) as { success: boolean; data: { uuid: string; storedPath: string; size: number } }
    expect(body.success).toBe(true)
    expect(body.data.size).toBe(10)
    expect(body.data.storedPath.startsWith(join(state.userData, 'vms-uploads'))).toBe(true)

    const [row] = await queue.listPending()
    expect(row).toMatchObject({ uuid: body.data.uuid, trackingId: 'AWB1', feedId: 'feed-a', size: 10, length: 3 })
    expect(JSON.parse(row!.files)).toHaveLength(1)
    expect(await readdir(join(state.userData, 'vms-uploads'))).toHaveLength(2)

    // One use only: the same id cannot be committed twice.
    const again = await fetch(`${base}/upload`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ file: video.id, fields: { trackingId: 'A', orderType: 'Forward' } })
    })
    expect(again.status).toBe(400)
  })

  it('refuses a foreign origin and a path trick', async () => {
    const foreign = await fetch(`${base}/health`, { headers: { origin: 'https://evil.example' } })
    expect(foreign.status).toBe(403)
    const trick = await stage('../../escape.webm', 'video/webm', 'x')
    expect(trick.status).toBe(400)
  })

  it('refuses to queue with no feed held', async () => {
    const video = (await (await stage('r.webm', 'video/webm', 'v')).json()) as { id: string }
    state.feed = null
    const response = await fetch(`${base}/upload`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ file: video.id, fields: { trackingId: 'A', orderType: 'Forward' } })
    })
    expect(response.status).toBe(400)
    state.feed = { feedId: 'feed-a' }
  })
})
