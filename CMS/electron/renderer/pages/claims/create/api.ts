import type { CommonFeed } from '@shared/types/cmsCreate'
import type { Result } from '@shared/types/result'
import * as claimCreate from '@renderer/services/claimCreate.service'
import type {
  ExistingCmsPreview,
  OrderLookupRecord,
  OrderLookupResponse,
  OrderType
} from './types'

/**
 * The web app's API surface, spelled the way the ported form expects it.
 *
 * WHY A SHIM AND NOT A REWRITE. Create Claim is TrackVid-FE's page, brought
 * over so the two surfaces file identical claims. There, every call is axios
 * and every call site reads `res?.data?.data` and catches
 * `error.response.data.displayMessage`. Here, every call is IPC and answers a
 * `Result`. Translating at ~25 call sites would touch the files in exactly the
 * places a future change to the web form will touch them, and each one is a
 * chance to drop an error branch nobody notices until a claim fails to save.
 *
 * So the translation happens ONCE, here. Above this line the desktop's rules
 * hold — one HTTP client, in the main process, behind a validated channel.
 * Below it the ported code reads what it has always read.
 *
 * FAILURES THROW, exactly as axios throws on a 4xx, and carry the backend's
 * message where the ported `catch` already looks for it. A shim that returned a
 * quiet empty answer would turn "the server refused this claim" into "the
 * server saved it and returned nothing", which is the one outcome an operator
 * must never be shown.
 */

/** The envelope the ported code destructures. */
interface Envelope<T> {
  isSuccess: boolean
  data: T | null
  displayMessage?: string
  /** Set by `/cms/createCMS` when a dispatch was asked for. */
  autoClaim?: { requested?: boolean; dispatched?: boolean }
  /**
   * `/order/{awb}` puts these BESIDE `data`, not inside it — the SKUs on the
   * order and one record per matched master row. The multi-line SKU picker is
   * built from `records`.
   */
  skus?: string[]
  records?: OrderLookupRecord[]
}

/** What axios hands back, as far as this form is concerned. */
export interface ApiResponse<T> {
  status: number
  data: Envelope<T>
}

/** An axios-shaped rejection, so the ported `catch` blocks read it unchanged. */
export class ApiError extends Error {
  readonly response: { data: { displayMessage: string; message: string } }

  constructor(message: string) {
    super(message)
    this.name = 'ApiError'
    this.response = { data: { displayMessage: message, message } }
  }
}

const unwrap = <T,>(result: Result<T>): ApiResponse<T> => {
  if (!result.success) throw new ApiError(result.error.message)

  return { status: 200, data: { isSuccess: true, data: result.data } }
}

/**
 * The same, for the two endpoints whose own envelope the caller reads.
 *
 * `/cms/createCMS` answers `{ displayMessage, autoClaim }` alongside its data,
 * and the submit renders both — a dispatch that did not start is a warning
 * printed from `autoClaim`, not an error. The main process passes the envelope
 * body through as the result's data, so it is lifted back up here.
 */
const unwrapEnvelope = <T,>(result: Result<unknown>): ApiResponse<T> => {
  if (!result.success) throw new ApiError(result.error.message)

  const body = (result.data ?? {}) as Record<string, unknown>

  return {
    status: 200,
    data: {
      isSuccess: true,
      data: (body.data ?? body) as T,
      displayMessage: typeof body.displayMessage === 'string' ? body.displayMessage : undefined,
      autoClaim: body.autoClaim as Envelope<T>['autoClaim']
    }
  }
}

// ── Lookups ────────────────────────────────────────────────────────────────

/**
 * The master-data rows behind one AWB.
 *
 * The main process passes this endpoint's envelope through whole, because the
 * caller reads `skus` and `records` from beside `data`.
 */
export const getOrderByAwb = async (awb: string, type: OrderType) => {
  const result = await claimCreate.orderByAwb(awb, type)

  if (!result.success) throw new ApiError(result.error.message)

  const envelope = (result.data ?? {}) as Envelope<OrderLookupResponse['data']>

  return { status: 200, data: { ...envelope, isSuccess: true } }
}

/** The VMS screenshots captured against one AWB, as URLs. */
export const getOrderScreenshots = async (awb: string, type: OrderType) =>
  unwrap<string[]>((await claimCreate.orderScreenshots(awb, type)) as Result<string[]>)

export const getProductSkuMap = async (awb: string, companyId: string) =>
  unwrap<unknown>(await claimCreate.productSkuMap(awb, companyId))

export const getMeeshoOrderInfo = async (params: {
  subOrderNo?: string
  forwardAwbNo?: string
  returnAwbNo?: string
}) => unwrap<any>(await claimCreate.masterOrderInfo('meesho', params as Record<string, string>))

export const getSnapdealOrderInfo = async (params: {
  subOrderNo?: string
  forwardAwbNo?: string
  returnAwbNo?: string
}) => unwrap<any>(await claimCreate.masterOrderInfo('snapdeal', params as Record<string, string>))

export const getMyntraOrderInfo = async (params: {
  returnTrackingNumber?: string
  forwardTrackingNumber?: string
}) => unwrap<any>(await claimCreate.masterOrderInfo('myntra', params as Record<string, string>))

export const findCmsByAwb = async (awb: string, platform: string) =>
  unwrap<ExistingCmsPreview | null>(
    (await claimCreate.findClaimByAwb(awb, platform)) as Result<ExistingCmsPreview | null>
  )

export const getAccountByAwb = async (awb: string, platform: string, type: OrderType) =>
  unwrap<{ account: string | null }>(await claimCreate.accountByAwb(awb, platform, type))

export const getAutomationPlatforms = async () =>
  unwrap<{ platforms: string[] }>(
    await (async (): Promise<Result<{ platforms: string[] }>> => {
      const response = await claimCreate.automationPlatforms()

      return response.success ? { success: true, data: { platforms: response.data } } : response
    })()
  )

export const getCommonFeeds = async () => unwrap<CommonFeed[]>(await claimCreate.commonFeeds())

// ── Writes ─────────────────────────────────────────────────────────────────

/**
 * Stores one image and answers with its key.
 *
 * `FormData` in, as the web app builds it — the file under `file`, the feed
 * under `feedId` — so a call site that appends a field keeps working. The parts
 * are read back out here because a FormData cannot cross IPC.
 */
export const uploadCmsImage = async (form: FormData) => {
  const file = form.get('file')
  const feedId = form.get('feedId')

  if (!(file instanceof File)) throw new ApiError('No file was provided to upload.')

  return unwrap<{ key: string }>(
    await claimCreate.uploadClaimImage(file, typeof feedId === 'string' ? feedId : '')
  )
}

export const storeCmsVideo = async (form: FormData) => {
  const file = form.get('file')
  const feedId = form.get('feedId')
  const extra: Record<string, string> = {}

  for (const [key, value] of form.entries()) {
    if (key === 'file' || key === 'feedId') continue
    if (typeof value === 'string') extra[key] = value
  }

  if (!(file instanceof File)) throw new ApiError('No video was provided to upload.')

  return unwrapEnvelope<any>(
    await claimCreate.storeClaimVideo(file, typeof feedId === 'string' ? feedId : '', extra)
  )
}

/**
 * Files the claim.
 *
 * Every image is already a key by the time this runs, so the FormData holds
 * text only and is flattened into a plain record for the crossing. A non-string
 * part would be a file nobody uploaded — dropped rather than sent, because the
 * backend would store the claim with a `[object File]` where a key belongs.
 */
export const createCMS = async (form: FormData) => {
  const fields: Record<string, string> = {}

  for (const [key, value] of form.entries()) {
    if (typeof value === 'string') fields[key] = value
  }

  return unwrapEnvelope<any>(await claimCreate.createClaim(fields))
}

// ── Bulk Claim ─────────────────────────────────────────────────────────────

/**
 * The three bulk steps, shaped like the web app's axios calls.
 *
 * `signal` is accepted and ignored: an IPC call cannot be cancelled mid-flight,
 * and the caller already discards a stale answer by comparing its own request
 * token (`isCurrent()`). What is lost is the saved round trip when an operator
 * uploads a second report over the first, not correctness.
 */
export const bulkClaimCheck = async (form: FormData, _options?: { signal?: AbortSignal }) => {
  const file = form.get("file");

  if (!(file instanceof File)) throw new ApiError("No report was provided.");

  return unwrapEnvelope<any>(await claimCreate.bulkClaimCheck(file));
};

export const bulkClaimVerify = async (rows: unknown[], _options?: { signal?: AbortSignal }) =>
  unwrapEnvelope<any>(await claimCreate.bulkClaimVerify(rows));

export const bulkClaimCreate = async (rows: unknown[]) =>
  unwrapEnvelope<any>(await claimCreate.bulkClaimCreate(rows));

export const deleteCmsFile = async (fileKey: string) =>
  unwrap<unknown>(await claimCreate.deleteClaimFile(fileKey))

export const updateCMS = async (payload: Record<string, unknown>) =>
  unwrapEnvelope<any>(await claimCreate.updateClaim(payload))

/** Named as the web app's service names it, so the ported submit reads the same. */
export const CmsService = { updateCMS }

/** Re-exported so a ported call site can keep importing its types from here. */
export type { ExistingCmsPreview, OrderLookupItem, OrderLookupRecord, OrderLookupResponse, OrderType } from './types'
