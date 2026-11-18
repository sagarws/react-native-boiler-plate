import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Which network stack an upload goes through.
 *
 * Node's fetch hangs up on any response that takes more than five minutes to
 * start (undici's `headersTimeout`), whatever the AbortSignal allows. A claim
 * video the backend re-encoded for six minutes was stored and charged for while
 * the app reported "fetch failed" and the claim kept no video. An upload marked
 * `longRunning` therefore goes through Electron's `net.fetch`, which has no such
 * cap; everything else stays on Node's fetch.
 */

const netFetch = vi.hoisted(() => vi.fn())

vi.mock('electron', () => ({ net: { fetch: netFetch } }))
vi.mock('@main/services/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))

const { apiUpload } = await import('@main/services/httpClient')

const ok = () =>
  new Response(JSON.stringify({ isSuccess: true, data: { _id: 'video-1' } }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  })

const file = { name: 'file', filename: 'forward.mp4', contentType: 'video/mp4', data: new Uint8Array(16) }

let nodeFetch: ReturnType<typeof vi.fn>

beforeEach(() => {
  netFetch.mockReset()
  netFetch.mockImplementation(() => Promise.resolve(ok()))
  nodeFetch = vi.fn(() => Promise.resolve(ok()))
  vi.stubGlobal('fetch', nodeFetch)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('apiUpload transport', () => {
  it('sends a long-running upload through net.fetch, with the multipart body and the timeout signal', async () => {
    const result = await apiUpload('/cms/storeVideo', { files: [file], token: 't', longRunning: true, timeoutMs: 1_800_000 })

    expect(result.success).toBe(true)
    expect(nodeFetch).not.toHaveBeenCalled()
    expect(netFetch).toHaveBeenCalledTimes(1)

    const [, init] = netFetch.mock.calls[0] as [string, RequestInit]
    expect(init.method).toBe('POST')
    expect(init.body).toBeInstanceOf(FormData)
    expect((init.body as FormData).get('file')).toBeInstanceOf(Blob)
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })

  it('keeps every other upload on Node fetch', async () => {
    await apiUpload('/cms/uploadImage', { files: [file], token: 't' })

    expect(nodeFetch).toHaveBeenCalledTimes(1)
    expect(netFetch).not.toHaveBeenCalled()
  })

  it('reports a dropped long-running upload as a failure, not a throw', async () => {
    netFetch.mockImplementation(() => Promise.reject(new TypeError('net::ERR_CONNECTION_RESET')))

    const result = await apiUpload('/cms/storeVideo', { files: [file], longRunning: true })

    expect(result.success).toBe(false)
  })
})
