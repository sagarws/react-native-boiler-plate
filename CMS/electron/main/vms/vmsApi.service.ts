import { statfs } from 'node:fs/promises'
import { parse } from 'node:path'
import { app } from 'electron'
import { fail, ok, type Result } from '@shared/types/result'
import type { ApiProbeResult } from '@shared/vms/probe'
import type { DiskInfo, IstDate } from '@shared/vms/system'
import type { UsageSnapshot } from '@shared/vms/usage'
import { env } from '../config/env'
import { apiRequest } from '../services/httpClient'
import { logger } from '../services/logger'
import { feedTokenRefused, readToken } from './feedSession.service'

/**
 * Argos Watch's read-only system / order / usage calls, under `vms:*`.
 *
 * Where Argos sent its (feed) token, the held feed token is sent; with no feed
 * held these read-only calls fall back to the CMS admin token. A 401 on the
 * feed token drops the feed session (see feedSession.service).
 */

/** apiRequest with the VMS token, dropping the feed session if the backend refuses it. */
const vmsRequest = async <T>(path: string): Promise<Result<T>> => {
  const auth = readToken()
  if (!auth) return fail('VALIDATION_ERROR', 'Not signed in')
  const response = await apiRequest<T>(path, { token: auth.token })
  if (!response.success && response.error.sessionEnded && auth.isFeed) feedTokenRefused(auth.token)
  return response
}

// ---------------------------------------------------------------------------
// vms:disk-info — fs.statfs instead of systeminformation (no new dependency).
// ---------------------------------------------------------------------------

const toGB = (bytes: number): number => Number((bytes / 1e9).toFixed(2))

export const getDiskInfo = async (): Promise<Result<DiskInfo>> => {
  try {
    const userData = app.getPath('userData')
    const root = parse(userData).root
    const info = await statfs(userData)
    const size = info.blocks * info.bsize
    const available = info.bavail * info.bsize
    const used = Math.max(0, (info.blocks - info.bfree) * info.bsize)
    return ok<DiskInfo>({
      fs: root,
      mount: root,
      type: `0x${info.type.toString(16)}`,
      size,
      used,
      available,
      sizeGB: toGB(size),
      usedGB: toGB(used),
      availableGB: toGB(available),
      // systeminformation's `use`: used / size, as a percentage to 2 dp.
      use: size > 0 ? Math.round((used / size) * 10_000) / 100 : 0
    })
  } catch (error) {
    logger.warn('[vms] disk info probe failed', { error: error instanceof Error ? error.message : String(error) })
    return fail('INTERNAL_ERROR', 'Could not read disk information.')
  }
}

// ---------------------------------------------------------------------------
// vms:ist-date — server-authoritative IST clock (Argos called it without a token).
// ---------------------------------------------------------------------------

interface IstDateWire {
  day?: number
  month?: number
  year?: number
  hour?: number
  minute?: number
  second?: number
  iso?: string
}

export const getIstDate = async (): Promise<Result<IstDate>> => {
  const response = await apiRequest<IstDateWire>('/common/get-ist-date')
  if (!response.success) return response
  const data = response.data
  if (!data || typeof data.day !== 'number' || typeof data.month !== 'number' || typeof data.year !== 'number') {
    return fail('INTERNAL_ERROR', 'IST date server response was malformed.')
  }
  return ok<IstDate>({
    day: data.day,
    month: data.month,
    year: data.year,
    hour: typeof data.hour === 'number' ? data.hour : 0,
    minute: typeof data.minute === 'number' ? data.minute : 0,
    second: typeof data.second === 'number' ? data.second : 0,
    iso: typeof data.iso === 'string' ? data.iso : ''
  })
}

// ---------------------------------------------------------------------------
// vms:camera-date-permission
// ---------------------------------------------------------------------------

export const getCameraDatePermission = async (payload: unknown): Promise<Result<boolean>> => {
  const feedId = (payload as { feedId?: unknown } | null)?.feedId
  if (typeof feedId !== 'string') return fail('VALIDATION_ERROR', 'feedId is required')
  if (!feedId) return ok(false)
  // Fail-closed without a token, as Argos did: the date check then runs.
  if (!readToken()) return ok(false)
  const response = await vmsRequest<boolean>(`/feed/camera-date-change-permission/${encodeURIComponent(feedId)}`)
  if (!response.success) return response
  return ok(response.data === true)
}

// ---------------------------------------------------------------------------
// vms:probe-api — Argos' probe-api (payload { kind: 'probe' }, the default)
// and ping-api ({ kind: 'ping' }) on one channel.
// ---------------------------------------------------------------------------

const PROBE_TARGET_URL = 'https://api.parseapi.com/ip/8.8.8.8'
const PROBE_TARGET_HEADERS: Record<string, string> = { 'X-API-Key': 'parse_j57rvr7fd4wha3tzvhyq' }
const PROBE_TIMEOUT_MS = 10_000
const PING_TIMEOUT_MS = 4_000

export interface PingResult {
  reachable: boolean
  status: number
  latencyMs: number
}

const probeApi = async (): Promise<Result<ApiProbeResult>> => {
  const t0 = Date.now()
  try {
    const response = await fetch(PROBE_TARGET_URL, {
      method: 'GET',
      headers: PROBE_TARGET_HEADERS,
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS)
    })
    const body = await response.text()
    return ok({
      url: PROBE_TARGET_URL,
      status: response.status,
      statusText: response.statusText,
      body,
      contentType: response.headers.get('content-type') ?? '',
      latencyMs: Date.now() - t0,
      reachable: true
    })
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    return ok({
      url: PROBE_TARGET_URL,
      status: 0,
      statusText: err.name || 'Error',
      body: err.message,
      contentType: '',
      latencyMs: Date.now() - t0,
      reachable: false
    })
  }
}

/** Argos pinged https://api.trackvid.in/ — here the configured API host, so a staging build pings staging. */
const pingApi = async (): Promise<Result<PingResult>> => {
  const t0 = Date.now()
  try {
    const response = await fetch(`${env.apiBaseUrl}/`, { method: 'HEAD', signal: AbortSignal.timeout(PING_TIMEOUT_MS) })
    return ok({ reachable: true, status: response.status, latencyMs: Date.now() - t0 })
  } catch {
    return ok({ reachable: false, status: 0, latencyMs: Date.now() - t0 })
  }
}

export const probe = (payload: unknown): Promise<Result<ApiProbeResult | PingResult>> =>
  (payload as { kind?: unknown } | null)?.kind === 'ping' ? pingApi() : probeApi()

// ---------------------------------------------------------------------------
// vms:order-check-exists / vms:order-product-details
// ---------------------------------------------------------------------------

export interface CheckOrderResult {
  exists: boolean
  existsInLastTwoHour: boolean
}

export interface ProductDetail {
  sellerSkuCode: string
  quantity: number
  color: string
  size: string
  imageLink: string
}

interface WireProductSkuItem {
  sellerSkuCode?: string
  color?: string
  size?: string
  imageLink?: string
}

interface WireProductSkuMap {
  productSkucodeMap?: WireProductSkuItem[]
  quantity?: number
}

export const checkOrderExists = async (payload: unknown): Promise<Result<CheckOrderResult>> => {
  const input = payload as { trackingId?: unknown; orderType?: unknown } | null
  const trackingId = typeof input?.trackingId === 'string' ? input.trackingId.trim() : ''
  const orderType = typeof input?.orderType === 'string' ? input.orderType.trim() : ''
  if (!trackingId || !orderType) return fail('VALIDATION_ERROR', 'trackingId and orderType are required')
  if (!readToken()) return fail('VALIDATION_ERROR', 'Not signed in')

  const response = await vmsRequest<{ exists?: boolean; existsInLastTwoHour?: boolean }>(
    `/order/check-trackingId/${encodeURIComponent(trackingId)}/${encodeURIComponent(orderType)}`
  )
  if (!response.success) return response
  return ok({
    exists: response.data?.exists === true,
    existsInLastTwoHour: response.data?.existsInLastTwoHour === true
  })
}

export const fetchProductDetails = async (payload: unknown): Promise<Result<ProductDetail[]>> => {
  const input = payload as { trackingId?: unknown; companyId?: unknown } | null
  const trackingId = typeof input?.trackingId === 'string' ? input.trackingId.trim() : ''
  const companyId = typeof input?.companyId === 'string' ? input.companyId.trim() : ''
  if (!trackingId || !companyId) return fail('VALIDATION_ERROR', 'trackingId and companyId are required')
  if (!readToken()) return fail('VALIDATION_ERROR', 'Not signed in')

  const response = await vmsRequest<WireProductSkuMap>(
    `/product-skucode-map/${encodeURIComponent(trackingId)}/${encodeURIComponent(companyId)}`
  )
  if (!response.success) {
    // 404 = no SKU on file for this AWB: an empty panel, not an error.
    if (response.error.code === 'NOT_FOUND') return ok([])
    return response
  }
  const items = Array.isArray(response.data?.productSkucodeMap) ? response.data.productSkucodeMap : []
  const quantity = typeof response.data?.quantity === 'number' ? response.data.quantity : 0
  return ok(
    items.map((raw) => ({
      sellerSkuCode: typeof raw.sellerSkuCode === 'string' ? raw.sellerSkuCode : '',
      quantity,
      color: typeof raw.color === 'string' ? raw.color : '',
      size: typeof raw.size === 'string' ? raw.size : '',
      imageLink: typeof raw.imageLink === 'string' ? raw.imageLink : ''
    }))
  )
}

// ---------------------------------------------------------------------------
// vms:usage
// ---------------------------------------------------------------------------

interface WireQuota {
  used?: number
  total?: number
  remaining?: number
}

const numericField = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0)

const readQuota = (raw: WireQuota | undefined): { used: number; total: number; remaining: number } => ({
  used: numericField(raw?.used),
  total: numericField(raw?.total),
  remaining: numericField(raw?.remaining)
})

export const fetchUsage = async (): Promise<Result<UsageSnapshot>> => {
  if (!readToken()) return fail('VALIDATION_ERROR', 'Not signed in')
  const response = await vmsRequest<{ storage?: WireQuota; credit?: WireQuota }>('/account/usage')
  if (!response.success) return response
  return ok<UsageSnapshot>({ storage: readQuota(response.data?.storage), credit: readQuota(response.data?.credit) })
}
