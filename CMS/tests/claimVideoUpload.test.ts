import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * A claim video goes to `/cms/storeVideo` exactly as the operator chose it.
 *
 * This machine does not re-encode it or cap its size: the backend re-encodes
 * every video itself, and a desktop-side shrink once refused to touch a long
 * video and then sent it anyway, so the operator got neither. The only thing
 * this side adds is time — a large file must not be cut off by the three-minute
 * default every other upload gets.
 */

const state = vi.hoisted(() => ({
  uploads: [] as { path: string; filename: string; contentType: string; size: number; timeoutMs: number | undefined; longRunning: boolean | undefined }[]
}))

vi.mock('@main/services/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))
vi.mock('@main/services/session.store', () => ({ getAccessToken: () => 'token' }))
vi.mock('@main/services/company.service', () => ({ company: vi.fn(), credentialsFor: vi.fn() }))
vi.mock('@main/automations/registry', () => ({ returnAwbLookup: vi.fn() }))
vi.mock('@main/services/automationScheduler.service', () => ({ requestTaskRun: vi.fn() }))
vi.mock('@main/services/httpClient', () => ({
  apiEnvelope: vi.fn(),
  apiRequest: vi.fn(),
  apiUpload: vi.fn(
    (
      path: string,
      options: { files: { filename: string; contentType: string; data: Uint8Array }[]; timeoutMs?: number; longRunning?: boolean }
    ) => {
      const [file] = options.files

      if (file) {
        state.uploads.push({
          path,
          filename: file.filename,
          contentType: file.contentType,
          size: file.data.byteLength,
          timeoutMs: options.timeoutMs,
          longRunning: options.longRunning
        })
      }

      return Promise.resolve({ success: true, data: { _id: 'video-1' } })
    }
  )
}))

const { storeClaimVideo } = await import('@main/services/claimCreate.service')

const send = (size: number, filename = 'recorded.webm', contentType = 'video/webm') =>
  storeClaimVideo({
    file: { fieldName: 'file', filename, contentType, bytes: new Uint8Array(size) },
    feedId: 'feed-1'
  })

beforeEach(() => {
  state.uploads = []
})

describe('uploading a claim video', () => {
  it('sends a small video untouched', async () => {
    await send(1_000_000, 'small.mp4', 'video/mp4')

    expect(state.uploads).toEqual([
      expect.objectContaining({ path: '/cms/storeVideo', filename: 'small.mp4', contentType: 'video/mp4', size: 1_000_000 })
    ])
  })

  it('sends a large video untouched — no re-encode, no size cap', async () => {
    await send(60_000_000, 'forward.webm', 'video/webm')

    expect(state.uploads).toEqual([
      expect.objectContaining({ filename: 'forward.webm', contentType: 'video/webm', size: 60_000_000 })
    ])
  })

  it('gives the upload longer than the three-minute default, past the five-minute cap of Node fetch', async () => {
    await send(1_000)

    expect(state.uploads[0]?.timeoutMs).toBeGreaterThan(300_000)
    expect(state.uploads[0]?.longRunning).toBe(true)
  })

  it('refuses a call with no video, without uploading anything', async () => {
    const result = await storeClaimVideo({ feedId: 'feed-1' })

    expect(result.success).toBe(false)
    expect(state.uploads).toHaveLength(0)
  })
})
