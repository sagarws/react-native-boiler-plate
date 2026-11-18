import { createReadStream, existsSync, statSync } from 'node:fs'
import { unlink } from 'node:fs/promises'
import { basename } from 'node:path'
import axios, { type AxiosError } from 'axios'
import FormData from 'form-data'
import { COMPRESSED_CONTENT_TYPE, normalizeCompressionLevel } from '@shared/vms/compression'
import { env } from '../config/env'
import { logger } from '../services/logger'
import { compressForUpload, isWebm, remuxWebm } from './ffmpeg.service'
import { feedTokenRefused, getFeedSession } from './feedSession.service'
import {
  counts,
  markFailed,
  markSynced,
  markSyncing,
  markUnsynced,
  nextUnsynced,
  requeue,
  type VmsQueueRow
} from './queue.store'

/**
 * Drains the VMS queue onto `${orderFileBaseUrl}/order/create-order` — Argos
 * Watch's uploadDriver.service, with three CMS differences:
 *
 *   - the token is the held FEED session's (the CMS admin token is refused by
 *     the file service), and only rows recorded under that feed are sent;
 *   - no feed session = paused (Argos: no sign-in = paused), same back-off;
 *   - ffmpeg is spawned directly, and a `.webm` is copy-remuxed first so the
 *     uploaded file carries its duration (Argos' renderer did that with
 *     fix-webm-duration before the file ever reached the queue).
 *
 * Retry / poison rules, timeouts, fields and cleanup are Argos' own.
 */

const POLL_MS = 5_000
const BACKOFF_NO_SESSION_MS = 30_000
const REQUEST_TIMEOUT_MS = 5 * 60_000

let running = false
let stopping = false
let busy = false
let tickTimer: NodeJS.Timeout | null = null

interface WireResponse {
  isSuccess?: boolean
  data?: unknown
  displayMessage?: string
  message?: string
}

export interface StoredFileRef {
  path?: string
  name?: string
  mimetype?: string
}

const LOG_BODY_LIMIT = 2000

const describeBody = (body: unknown): string => {
  try {
    const text = typeof body === 'string' ? body : JSON.stringify(body)
    if (!text) return '(empty)'
    return text.length > LOG_BODY_LIMIT ? `${text.slice(0, LOG_BODY_LIMIT)}… (${text.length} bytes)` : text
  } catch {
    return '(unserialisable)'
  }
}

/** `{AWB}_S{step}` → its parts, for the log (multi-step recording). */
const describeStep = (
  trackingId: string,
  totalFeed: number | undefined
): { awb: string; step: number | null; totalFeed: number | null; suffixed: boolean } => {
  const match = /^(.*)_S(\d+)$/.exec(trackingId)
  if (!match) return { awb: trackingId, step: null, totalFeed: totalFeed ?? null, suffixed: false }
  return { awb: match[1] ?? trackingId, step: Number(match[2]), totalFeed: totalFeed ?? null, suffixed: true }
}

const describeToken = (token: string): string =>
  token.length > 8 ? `…${token.slice(-6)} (${token.length} chars)` : '(short)'

const parseStoredFile = (raw: string): StoredFileRef | null => {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as StoredFileRef | null
    return typeof parsed?.path === 'string' && parsed.path.length > 0 ? parsed : null
  } catch {
    return null
  }
}

const parseStoredScreenshots = (raw: string | undefined): StoredFileRef[] => {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (item): item is StoredFileRef =>
        typeof item === 'object' && item !== null && typeof (item as StoredFileRef).path === 'string'
    )
  } catch {
    return []
  }
}

const scheduleNext = (delay = POLL_MS): void => {
  if (stopping) return
  if (tickTimer) clearTimeout(tickTimer)
  tickTimer = setTimeout(() => {
    void tick()
  }, delay)
}

const removeQuietly = async (target: string, uuid: string): Promise<void> => {
  try {
    await unlink(target)
  } catch (error) {
    logger.warn('[vms-upload] cleanup failed', {
      uuid,
      target,
      error: error instanceof Error ? error.message : String(error)
    })
  }
}

/** Retry, and poison at the cap — Argos' rule, scoped to the feed being drained. */
const retryOrPoison = async (row: VmsQueueRow, feedId: string, message: string): Promise<void> => {
  await markUnsynced(row.uuid)
  const post = await nextUnsynced(feedId)
  if (!post || post.uuid !== row.uuid) await markFailed(row.uuid, message)
}

const tick = async (): Promise<void> => {
  if (stopping || busy) return
  busy = true
  try {
    await drainOne()
  } catch (error) {
    logger.error('[vms-upload] tick failed', error)
    scheduleNext(POLL_MS)
  } finally {
    busy = false
  }
}

const drainOne = async (): Promise<void> => {
  const session = getFeedSession()
  if (!session) {
    scheduleNext(BACKOFF_NO_SESSION_MS)
    return
  }
  const { token, feedId, user } = session

  const row = await nextUnsynced(feedId)
  if (!row) {
    scheduleNext(POLL_MS)
    return
  }

  const stored = parseStoredFile(row.file)
  if (!stored?.path || !existsSync(stored.path)) {
    logger.warn('[vms-upload] queue row references a missing file - marking failed', {
      uuid: row.uuid,
      path: stored?.path
    })
    await markFailed(row.uuid, 'Recording file no longer on disk')
    scheduleNext(0)
    return
  }
  const sourcePath = stored.path

  await markSyncing(row.uuid)

  // WebM from MediaRecorder carries no duration; a stream copy writes it. A
  // remux that fails still leaves a playable recording, so it is sent as is.
  let basePath = sourcePath
  if (isWebm(sourcePath)) {
    try {
      basePath = await remuxWebm(sourcePath)
    } catch (error) {
      logger.warn('[vms-upload] remux failed - uploading the recording as recorded', {
        uuid: row.uuid,
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }
  const remuxed = basePath !== sourcePath

  const level = normalizeCompressionLevel(user.company?.compressPercentage)
  let uploadPath: string
  try {
    uploadPath = await compressForUpload(basePath, level)
  } catch (error) {
    logger.warn('[vms-upload] compression failed - retrying later', {
      uuid: row.uuid,
      level,
      error: error instanceof Error ? error.message : String(error)
    })
    if (remuxed) await removeQuietly(basePath, row.uuid)
    await retryOrPoison(row, feedId, 'Video compression failed')
    scheduleNext(POLL_MS)
    return
  }
  const wasCompressed = uploadPath !== basePath
  const uploadFilename = wasCompressed ? basename(uploadPath) : (stored.name ?? basename(sourcePath))
  const uploadContentType = wasCompressed ? COMPRESSED_CONTENT_TYPE : (stored.mimetype ?? 'video/webm')
  const intermediates = [...(remuxed ? [basePath] : []), ...(wasCompressed ? [uploadPath] : [])]

  const form = new FormData()
  form.append('file', createReadStream(uploadPath), { filename: uploadFilename, contentType: uploadContentType })
  const loggedFiles: Array<{ field: string; filename: string; bytes: number }> = [
    { field: 'file', filename: uploadFilename, bytes: existsSync(uploadPath) ? statSync(uploadPath).size : -1 }
  ]

  const screenshots = parseStoredScreenshots(row.files)
  for (const shot of screenshots) {
    if (!shot.path || !existsSync(shot.path)) {
      logger.warn('[vms-upload] screenshot missing on disk - skipping', { uuid: row.uuid, path: shot.path })
      continue
    }
    form.append('files', createReadStream(shot.path), {
      filename: shot.name ?? basename(shot.path),
      contentType: shot.mimetype ?? 'image/jpeg'
    })
    loggedFiles.push({ field: 'files', filename: shot.name ?? basename(shot.path), bytes: statSync(shot.path).size })
  }

  const fields: Record<string, string> = {
    trackingId: row.trackingId,
    feedId: user.feedId,
    size: String(row.size),
    orderType: row.orderType,
    start_time: row.start_time,
    videoDuration: String(row.length),
    compress: level,
    keepOld: row.keepOld ? 'true' : 'false',
    needRefund: row.needRefund ? 'true' : 'false',
    eCommercePlatform: row.eCommercePlatform ?? '',
    camera_type: user.feed?.cameraType ?? '',
    orderCondition: row.orderCondition === null ? '0' : String(row.orderCondition)
  }
  const backlog = await counts()
  fields['pending_AWB_numbers'] = String(backlog.unsynced)
  fields['pending_orders'] = String(backlog.unsynced)
  fields['failed_orders'] = String(backlog.failed)
  fields['isProcessOnCloud'] = 'false'

  for (const [key, value] of Object.entries(fields)) form.append(key, value)

  const missingRequired = ['trackingId', 'feedId', 'orderType', 'videoDuration'].filter((key) => !fields[key])
  if (missingRequired.length > 0) {
    logger.error('[vms-upload] payload is missing required fields', { uuid: row.uuid, missing: missingRequired })
  }

  const url = `${env.orderFileBaseUrl}/order/create-order`
  const multiStep = user.company?.multiStepRecording
  const stepInfo = describeStep(row.trackingId, multiStep?.totalFeed)
  logger.info('[vms-upload] POST create-order →', {
    uuid: row.uuid,
    url,
    auth: describeToken(token),
    multiStep: multiStep?.mode ? { ...stepInfo, mode: 'on' } : { awb: stepInfo.awb, mode: 'off' },
    fields,
    files: loggedFiles
  })
  if (multiStep?.mode && !stepInfo.suffixed) {
    logger.error('[vms-upload] multi-step is on but this upload has no step suffix', {
      uuid: row.uuid,
      trackingId: row.trackingId,
      feedId: user.feedId
    })
  }

  try {
    const startedAt = Date.now()
    const response = await axios.post<WireResponse>(url, form, {
      headers: { ...form.getHeaders(), Authorization: `Bearer ${token}` },
      timeout: REQUEST_TIMEOUT_MS,
      maxContentLength: Infinity,
      maxBodyLength: Infinity
    })
    const body = response.data ?? {}
    logger.info('[vms-upload] POST create-order ←', {
      uuid: row.uuid,
      trackingId: row.trackingId,
      step: stepInfo.step,
      totalFeed: stepInfo.totalFeed,
      status: response.status,
      durationMs: Date.now() - startedAt,
      isSuccess: body.isSuccess,
      body: describeBody(body)
    })

    if (body.isSuccess === true) {
      await markSynced(row.uuid)
      const cleanup = [
        sourcePath,
        ...intermediates,
        ...screenshots.map((s) => s.path).filter((p): p is string => Boolean(p))
      ]
      for (const target of cleanup) await removeQuietly(target, row.uuid)
      logger.info('[vms-upload] uploaded', { uuid: row.uuid, trackingId: row.trackingId, step: stepInfo.step })
      scheduleNext(0)
      return
    }

    const message = body.displayMessage ?? body.message ?? 'Upload rejected by server'
    logger.warn('[vms-upload] upload rejected', { uuid: row.uuid, status: response.status, message })
    for (const target of intermediates) await removeQuietly(target, row.uuid)
    await retryOrPoison(row, feedId, message)
    scheduleNext(POLL_MS)
  } catch (error) {
    for (const target of intermediates) await removeQuietly(target, row.uuid)
    const axiosError = error as AxiosError
    const status = axiosError.response?.status ?? 0
    const data = axiosError.response?.data as WireResponse | undefined
    const message =
      data && typeof data === 'object' ? (data.displayMessage ?? data.message ?? axiosError.message) : axiosError.message
    logger.warn('[vms-upload] POST create-order ← failed', {
      uuid: row.uuid,
      status,
      message,
      body: describeBody(axiosError.response?.data),
      code: axiosError.code ?? null
    })
    if (status === 401) {
      // The feed session is gone, not the upload: put the row back without
      // spending a retry, and stop until a feed is chosen again.
      await requeue(row.uuid)
      feedTokenRefused(token)
      scheduleNext(BACKOFF_NO_SESSION_MS)
      return
    }
    await retryOrPoison(row, feedId, message || 'Upload failed after 3 attempts')
    scheduleNext(POLL_MS)
  }
}

/** Idempotent. Started when a feed is first taken; a CMS-only run never starts it. */
export const startUploadDriver = (): void => {
  if (running) {
    // A feed was (re)taken: look at the queue now rather than after a back-off.
    scheduleNext(0)
    return
  }
  running = true
  stopping = false
  logger.info('[vms-upload] driver starting')
  scheduleNext(0)
}

export const stopUploadDriver = (): void => {
  if (!running) return
  stopping = true
  running = false
  if (tickTimer) clearTimeout(tickTimer)
  tickTimer = null
  logger.info('[vms-upload] driver stopped')
}
