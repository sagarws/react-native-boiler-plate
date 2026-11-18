import { createServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from 'node:http'
import type { Socket } from 'node:net'
import { WebSocketServer } from 'ws'
import { fail, ok, type Result } from '@shared/types/result'
import { vmsUploadsDirectory } from '../database'
import { logger } from '../services/logger'
import { getFeedSession } from './feedSession.service'
import { enqueue, referencedPaths } from './queue.store'
import { attachClient, stopAllBridges } from './rtspBridge.service'
import {
  getStaged,
  MAX_SCREENSHOTS,
  releaseStaged,
  stageFile,
  sweepOrphans,
  toQueueInput,
  UploadTooLargeError,
  type StagedFile
} from './uploadFiles'

/**
 * The VMS local server — Argos Watch's Express sidecar on plain `node:http` +
 * `ws`, bound to 127.0.0.1 only.
 *
 *   GET  /health                 { ok: true, port }
 *   POST /upload/file            raw body → Result<{ id }> (and `id` at the top level)
 *   POST /upload                 JSON { file, files, fields } → Argos' Result<{ uuid, storedPath, size }>
 *   WS   /rtsp?url=<rtsp://…>    camera preview (fMP4 chunks)
 *
 * Port: Argos' strategy — 8002, walking up past occupied ports, at most 20.
 * Started LAZILY by the first `vms:sidecar-port` call, so a CMS-only run opens
 * no port at all.
 *
 * Origin: Argos reflected every origin (cors origin:true) and relied on the
 * loopback bind alone. Here a request is served only when it has no Origin, or
 * the app's own (a file:// page sends "null"; the dev server's origin in dev),
 * and only when its Host names the loopback port — so a web page in a browser
 * on the same machine cannot post into the queue or open a camera.
 */

const PREFERRED_PORT = 8002
const MAX_PORT_WALK = 20
const MAX_JSON_BYTES = 4 * 1024 * 1024
/** Uploads folder files nobody owns are removed once this old. */
const ORPHAN_MIN_AGE_MS = 6 * 60 * 60 * 1000

let httpServer: HttpServer | null = null
let wss: WebSocketServer | null = null
let boundPort: number | null = null
let starting: Promise<number> | null = null

export const getSidecarPort = (): number | null => boundPort

const devOrigin = (): string | null => {
  const devServer = process.env['ELECTRON_RENDERER_URL']
  if (!devServer) return null
  try {
    return new URL(devServer).origin
  } catch {
    return null
  }
}

/** No Origin (a non-browser client on this machine), or the app's own. */
export const isAllowedOrigin = (origin: string | undefined, dev: string | null = devOrigin()): boolean => {
  if (origin === undefined || origin === '') return true
  if (origin === 'null' || origin === 'file://') return true
  return dev !== null && origin === dev
}

const isLoopbackHost = (host: string | undefined): boolean => {
  if (!host || boundPort === null) return false
  return host === `127.0.0.1:${boundPort}` || host === `localhost:${boundPort}`
}

const corsHeaders = (origin: string | undefined): Record<string, string> =>
  origin
    ? {
        'Access-Control-Allow-Origin': origin,
        Vary: 'Origin',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, X-File-Name',
        'Access-Control-Max-Age': '600'
      }
    : {}

const sendJson = (res: ServerResponse, status: number, body: unknown, origin: string | undefined): void => {
  if (res.headersSent) return
  const text = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
    'Cache-Control': 'no-store',
    ...corsHeaders(origin)
  })
  res.end(text)
}

const readJson = (req: IncomingMessage): Promise<unknown> =>
  new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let bytes = 0
    req.on('data', (chunk: Buffer) => {
      bytes += chunk.length
      if (bytes > MAX_JSON_BYTES) {
        reject(new Error('Request body too large'))
        req.resume()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown)
      } catch {
        reject(new Error('Body is not JSON'))
      }
    })
    req.on('error', reject)
  })

const handleStageFile = async (req: IncomingMessage, res: ServerResponse, origin: string | undefined): Promise<void> => {
  const declared = Number(req.headers['content-length'])
  if (Number.isFinite(declared) && declared > 500 * 1024 * 1024) {
    req.resume()
    sendJson(res, 413, fail('VALIDATION_ERROR', 'File exceeds 500 MB (LIMIT_FILE_SIZE)'), origin)
    return
  }
  try {
    const staged = await stageFile(vmsUploadsDirectory(), req, req.headers['x-file-name'], req.headers['content-type'])
    if ('error' in staged) {
      req.resume()
      sendJson(res, 400, fail('VALIDATION_ERROR', staged.error), origin)
      return
    }
    logger.info('[vms-sidecar] file staged', { id: staged.id, name: staged.name, size: staged.size })
    sendJson(res, 200, { ...ok({ id: staged.id }), id: staged.id }, origin)
  } catch (error) {
    if (error instanceof UploadTooLargeError) {
      sendJson(res, 413, fail('VALIDATION_ERROR', `${error.message} (LIMIT_FILE_SIZE)`), origin)
      return
    }
    logger.error('[vms-sidecar] staging failed', error)
    sendJson(res, 500, fail('INTERNAL_ERROR', 'The recording could not be saved to disk.'), origin)
  }
}

interface UploadResponse {
  uuid: string
  storedPath: string
  size: number
}

const handleUpload = async (req: IncomingMessage, res: ServerResponse, origin: string | undefined): Promise<void> => {
  let body: unknown
  try {
    body = await readJson(req)
  } catch (error) {
    sendJson(res, 400, fail('VALIDATION_ERROR', error instanceof Error ? error.message : 'Bad request'), origin)
    return
  }
  const input = (body && typeof body === 'object' ? body : {}) as { file?: unknown; files?: unknown; fields?: unknown }

  const video = getStaged(input.file)
  if (!video) {
    sendJson(res, 400, fail('VALIDATION_ERROR', 'file field is required'), origin)
    return
  }
  const ids = Array.isArray(input.files) ? input.files : []
  if (ids.length > MAX_SCREENSHOTS) {
    sendJson(res, 400, fail('VALIDATION_ERROR', 'Too many files (LIMIT_FILE_COUNT)'), origin)
    return
  }
  const screenshots: StagedFile[] = []
  for (const id of ids) {
    const shot = getStaged(id)
    if (!shot || shot.id === video.id) {
      sendJson(res, 400, fail('VALIDATION_ERROR', 'files names a file that was not uploaded'), origin)
      return
    }
    screenshots.push(shot)
  }

  const session = getFeedSession()
  if (!session) {
    sendJson(res, 400, fail('VALIDATION_ERROR', 'Choose a feed before recording.'), origin)
    return
  }

  const fields = (input.fields && typeof input.fields === 'object' ? input.fields : {}) as Record<string, unknown>
  const payload = toQueueInput(fields, video, screenshots)
  if ('error' in payload) {
    sendJson(res, 400, fail('VALIDATION_ERROR', payload.error), origin)
    return
  }

  try {
    const uuid = await enqueue(payload, session.feedId)
    releaseStaged([video.id, ...screenshots.map((shot) => shot.id)])
    logger.info('[vms-sidecar] upload enqueued', {
      uuid,
      trackingId: payload.trackingId,
      orderType: payload.orderType,
      feedId: session.feedId,
      size: video.size,
      screenshots: screenshots.length
    })
    const response: Result<UploadResponse> = ok({ uuid, storedPath: video.path, size: video.size })
    sendJson(res, 200, response, origin)
  } catch (error) {
    logger.error('[vms-sidecar] enqueue failed', error)
    sendJson(
      res,
      500,
      fail('INTERNAL_ERROR', 'Recording saved to disk but could not be queued. See main-process log.'),
      origin
    )
  }
}

const handleRequest = (req: IncomingMessage, res: ServerResponse): void => {
  const origin = typeof req.headers.origin === 'string' ? req.headers.origin : undefined
  if (!isLoopbackHost(req.headers.host) || !isAllowedOrigin(origin)) {
    logger.warn('[vms-sidecar] request refused', { origin: origin ?? null, host: req.headers.host ?? null })
    req.resume()
    res.writeHead(403).end()
    return
  }

  const url = new URL(req.url ?? '/', 'http://127.0.0.1')
  if (req.method === 'OPTIONS') {
    const headers: Record<string, string> = { ...corsHeaders(origin) }
    if (req.headers['access-control-request-private-network'] === 'true') {
      headers['Access-Control-Allow-Private-Network'] = 'true'
    }
    res.writeHead(204, headers).end()
    return
  }
  if (req.method === 'GET' && url.pathname === '/health') {
    sendJson(res, 200, { ok: true, port: boundPort }, origin)
    return
  }
  if (req.method === 'POST' && url.pathname === '/upload/file') {
    void handleStageFile(req, res, origin)
    return
  }
  if (req.method === 'POST' && url.pathname === '/upload') {
    void handleUpload(req, res, origin)
    return
  }
  req.resume()
  sendJson(res, 404, fail('NOT_FOUND', 'Not found'), origin)
}

const isSafeRtspUrl = (raw: string): boolean => raw.length > 0 && raw.length <= 2048 && /^rtsp:\/\//i.test(raw)

const handleUpgrade = (req: IncomingMessage, socket: Socket, head: Buffer): void => {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1')
  const origin = typeof req.headers.origin === 'string' ? req.headers.origin : undefined
  if (url.pathname !== '/rtsp' || !wss) {
    socket.write('HTTP/1.1 404 Not Found\r\n\r\n')
    socket.destroy()
    return
  }
  if (!isLoopbackHost(req.headers.host) || !isAllowedOrigin(origin)) {
    logger.warn('[vms-sidecar] RTSP socket refused', { origin: origin ?? null })
    socket.write('HTTP/1.1 403 Forbidden\r\n\r\n')
    socket.destroy()
    return
  }
  const rtspUrl = url.searchParams.get('url')
  if (!rtspUrl || !isSafeRtspUrl(rtspUrl)) {
    logger.warn('[vms-sidecar] RTSP socket rejected: missing or unsafe url param')
    socket.write('HTTP/1.1 400 Bad Request\r\n\r\n')
    socket.destroy()
    return
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    attachClient(rtspUrl, ws)
  })
}

const tryListen = (server: HttpServer, port: number): Promise<boolean> =>
  new Promise((resolve, reject) => {
    const onError = (error: NodeJS.ErrnoException): void => {
      server.removeListener('listening', onListening)
      if (error.code === 'EADDRINUSE') {
        resolve(false)
        return
      }
      reject(error)
    }
    const onListening = (): void => {
      server.removeListener('error', onError)
      resolve(true)
    }
    server.once('error', onError)
    server.once('listening', onListening)
    server.listen(port, '127.0.0.1')
  })

const boot = async (): Promise<number> => {
  const server = createServer(handleRequest)
  wss = new WebSocketServer({ noServer: true })
  server.on('upgrade', handleUpgrade)

  for (let offset = 0; offset < MAX_PORT_WALK; offset += 1) {
    const candidate = PREFERRED_PORT + offset
    if (await tryListen(server, candidate)) {
      httpServer = server
      boundPort = candidate
      logger.info('[vms-sidecar] listening', { port: candidate, walked: offset })
      void sweepUploads()
      return candidate
    }
  }
  wss.close()
  wss = null
  throw new Error(`No free port in [${PREFERRED_PORT}, ${PREFERRED_PORT + MAX_PORT_WALK})`)
}

const sweepUploads = async (): Promise<void> => {
  try {
    const removed = await sweepOrphans(vmsUploadsDirectory(), await referencedPaths(), ORPHAN_MIN_AGE_MS)
    if (removed > 0) logger.info('[vms-sidecar] removed orphaned upload files', { removed })
  } catch (error) {
    logger.warn('[vms-sidecar] upload sweep failed', error)
  }
}

/** Idempotent; concurrent callers share one start. */
export const startSidecar = (): Promise<number> => {
  if (boundPort !== null) return Promise.resolve(boundPort)
  if (!starting) {
    starting = boot().finally(() => {
      starting = null
    })
  }
  return starting
}

export const stopSidecar = async (): Promise<void> => {
  stopAllBridges()
  if (wss) {
    try {
      wss.close()
    } catch (error) {
      logger.warn('[vms-sidecar] WS close failed', error)
    }
    wss = null
  }
  const server = httpServer
  httpServer = null
  boundPort = null
  if (!server) return
  server.closeAllConnections()
  await new Promise<void>((resolve) => {
    server.close(() => resolve())
  })
  logger.info('[vms-sidecar] stopped')
}
