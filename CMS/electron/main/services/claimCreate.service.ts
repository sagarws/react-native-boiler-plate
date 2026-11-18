import type {
  ClaimFormCatalogue,
  ECommercePlatformRecord,
  CommonFeed,
  ReturnAwbAccountFailure,
  ReturnAwbAutofill
} from '@shared/types/cmsCreate'
import { fail, ok, type Result } from '@shared/types/result'
import { apiEnvelope, apiRequest, apiUpload, type UploadField, type UploadFile } from './httpClient'
import { getAccessToken } from './session.store'
import { company, credentialsFor } from './company.service'
import { returnAwbLookup } from '@main/automations/registry'
import { platformKey } from '@shared/utils/platformKey'
import { logger } from './logger'
import { requestTaskRun } from './automationScheduler.service'
import { env } from '../config/env'

/**
 * Filing a claim by hand, from the desktop.
 *
 * ORCHESTRATION ONLY — no marketplace logic lives here. Every call below is the
 * same endpoint the web CMS's Create Claim page calls, with the same payload,
 * because the two surfaces write the same Mongo documents and the same claim is
 * later picked up by whichever runner the company is routed to. A field renamed
 * on this side is a claim the server stores without it.
 *
 * WHY THE MAIN PROCESS AT ALL. The renderer's CSP is `connect-src 'self'` and
 * the access token never leaves this process, so the form cannot reach the
 * backend itself. Each function here is one channel the form invokes.
 */

const token = (): string => getAccessToken() ?? ''

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

// ── The company's own catalogue ────────────────────────────────────────────

const settingsOf = (doc: Record<string, unknown>): Record<string, unknown> =>
  (doc.settings as Record<string, unknown>) ?? {}

/**
 * The platforms this company files under, each with its claim types.
 *
 * Read from the LOCAL company document rather than fetched: it is the same
 * `GET /cms/company` payload the web app reads `company.settings` out of, it is
 * already refreshed at sign-in and on every Sync, and reading it here means the
 * form opens on a machine that has lost the network.
 */
const platformsOf = (doc: Record<string, unknown>): ECommercePlatformRecord[] => {
  const raw = settingsOf(doc).eCommercePlatform

  if (!Array.isArray(raw)) return []

  return raw
    .map((entry): ECommercePlatformRecord | null => {
      if (!entry || typeof entry !== 'object') return null

      const record = entry as Record<string, unknown>
      const name = text(record.name)

      if (!name) return null

      const claims = Array.isArray(record.typeOfClaims) ? record.typeOfClaims : []

      return {
        _id: text(record._id),
        name,
        typeOfClaims: claims
          .map((claim) => {
            if (!claim || typeof claim !== 'object') return null

            const row = claim as Record<string, unknown>
            const claimName = text(row.name)

            if (!claimName) return null

            const key = text(row.key)
            const parentSelection = text(row.parentSelection)

            return {
              _id: text(row._id),
              name: claimName,
              description: typeof row.description === 'string' ? row.description : '',
              isDisable: row.isDisable === true,
              ...(key ? { key } : {}),
              ...(parentSelection ? { parentSelection } : {})
            }
          })
          .filter((claim): claim is NonNullable<typeof claim> => claim !== null)
      }
    })
    .filter((entry): entry is ECommercePlatformRecord => entry !== null)
}

/**
 * The seller accounts held per platform, keyed by the platform's stored name.
 *
 * De-duplicated case-insensitively, because the same login typed twice into
 * Integrations is one account and an operator picking between two identical
 * rows is being asked a question with no answer.
 */
const accountsOf = (doc: Record<string, unknown>): Record<string, string[]> => {
  const raw = settingsOf(doc).eCommercePlatformLoginInfo
  const out: Record<string, string[]> = {}

  if (!Array.isArray(raw)) return out

  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue

    const bucket = entry as Record<string, unknown>
    const platform = text(bucket.eComPlatform)

    if (!platform) continue

    const info = Array.isArray(bucket.info) ? (bucket.info as Record<string, unknown>[]) : []
    const seen = new Set<string>()
    const usernames: string[] = []

    for (const account of info) {
      const username = text(account?.username)

      if (!username || seen.has(username.toLowerCase())) continue

      seen.add(username.toLowerCase())
      usernames.push(username)
    }

    out[platformKey(platform)] = usernames
  }

  return out
}

/** Each Delhivery login's synced Domestic names, keyed by lowercased username; logins with none are left out. */
const delhiveryDomesticsByAccount = async (): Promise<Record<string, string[]>> => {
  const out: Record<string, string[]> = {}

  for (const credential of await credentialsFor('delhivery')) {
    const names = [...new Set(credential.domestics.map(domestic => domestic.name))]

    if (credential.username && names.length > 0) out[credential.username.trim().toLowerCase()] = names
  }

  return out
}

export const claimFormCatalogue = async (): Promise<Result<ClaimFormCatalogue>> => {
  const doc = await company()

  if (!doc.success) return doc

  const settings = settingsOf(doc.data)
  const allocation = settings.increffAllocation

  return ok({
    platforms: platformsOf(doc.data),
    accounts: accountsOf(doc.data),
    delhiveryDomestics: await delhiveryDomesticsByAccount(),
    increffBulkClaim: settings.increffBulkClaim === true,
    hasIncreffAllocation:
      Array.isArray(allocation) &&
      allocation.some(
        (entry) =>
          entry &&
          typeof entry === 'object' &&
          (entry as Record<string, unknown>).allowed === true &&
          text((entry as Record<string, unknown>).platform) !== ''
      )
  })
}

// ── Reads that back the form ───────────────────────────────────────────────

/**
 * Which platforms have a runner, so the toolbar knows whether to offer
 * "Create Ticket" beside "Save".
 *
 * Fetched, never hard-coded: the list lives in the backend's
 * `validations/claimAutomation.validation.ts`, and a copy here would rot the
 * day a platform's automation is switched on or off — leaving a button that
 * does nothing, or hiding one that works.
 */
export const automationPlatforms = async (): Promise<Result<string[]>> => {
  const response = await apiRequest<{ platforms?: unknown }>('/cms/automation-platforms', {
    token: token()
  })

  if (!response.success) return response

  const list = response.data?.platforms

  return ok(Array.isArray(list) ? list.filter((entry): entry is string => typeof entry === 'string') : [])
}

interface FindByAwbRequest {
  awb: string
  platform: string
}

/** The live claim already filed under this AWB on this platform, or null. */
export const findClaimByAwb = async (payload: unknown): Promise<Result<unknown>> => {
  const { awb, platform } = (payload ?? {}) as Partial<FindByAwbRequest>

  if (!text(awb) || !text(platform)) return ok(null)

  return apiRequest<unknown>('/cms/find-by-awb', {
    method: 'POST',
    body: { awb: text(awb), platform: text(platform) },
    token: token()
  })
}

interface AccountByAwbRequest {
  awb: string
  platform: string
  type: 'Return' | 'Forward'
}

/** The seller account linked to this AWB in the platform's master collection. */
export const accountByAwb = async (payload: unknown): Promise<Result<{ account: string | null }>> => {
  const { awb, platform, type } = (payload ?? {}) as Partial<AccountByAwbRequest>

  if (!text(awb) || !text(platform)) return ok({ account: null })

  const query = new URLSearchParams({
    awb: text(awb),
    platform: text(platform),
    type: type === 'Forward' ? 'Forward' : 'Return'
  })

  return apiRequest<{ account: string | null }>(`/cms/account-by-awb?${query.toString()}`, {
    token: token()
  })
}

interface OrderLookupRequest {
  awb: string
  type: 'Return' | 'Forward'
}

/** The master-data rows behind one AWB — video links, the sibling AWB, SKUs. */
export const orderByAwb = async (payload: unknown): Promise<Result<unknown>> => {
  const { awb, type } = (payload ?? {}) as Partial<OrderLookupRequest>

  if (!text(awb)) return ok(null)

  const query = new URLSearchParams({ typeOfOrder: type === 'Forward' ? 'Forward' : 'Return' })

  // THE WHOLE ENVELOPE. `skus` and `records` sit beside `data`, not inside it,
  // and the multi-line SKU picker is built from `records` — dropping them would
  // leave an operator filing a claim against whichever line happened to be
  // first.
  return apiEnvelope<unknown>(`/order/${encodeURIComponent(text(awb))}?${query.toString()}`, {
    token: token()
  })
}

/** The VMS screenshots captured against one AWB. */
export const orderScreenshots = async (payload: unknown): Promise<Result<unknown>> => {
  const { awb, type } = (payload ?? {}) as Partial<OrderLookupRequest>

  if (!text(awb)) return ok(null)

  const query = new URLSearchParams({ orderType: type === 'Forward' ? 'Forward' : 'Return' })

  return apiRequest<unknown>(
    `/order/screenshot/${encodeURIComponent(text(awb))}?${query.toString()}`,
    { token: token() }
  )
}

/** Larger than any VMS still; a reply bigger than this is not a screenshot. */
const ORDER_IMAGE_MAX_BYTES = 25 * 1024 * 1024

/**
 * One VMS screenshot's bytes, by key — what TrackVid-FE's
 * `createPdfFromImages_old` fetches from `${ORDER_BASE_URL}/order/view/<key>`
 * for every grid entry that is a key rather than a file.
 *
 * TAKES A KEY, NOT A URL. A full URL is accepted and cut to its last segment,
 * exactly as the web app does, so the renderer can never point this at another
 * host.
 */
export const orderImage = async (
  payload: unknown
): Promise<Result<{ bytes: Uint8Array; contentType: string }>> => {
  const raw = text((payload as { key?: unknown } | null)?.key)
  const key = (raw.split('?')[0] ?? '').split('/').pop() ?? ''

  if (!/^[\w.-]+$/.test(key)) return fail('VALIDATION_ERROR', 'That is not an image key.')

  const url = `${env.orderFileBaseUrl}/order/view/${encodeURIComponent(key)}`

  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(env.apiTimeoutMs) })

    if (!response.ok) {
      logger.warn(`[claim-upload] order image ${key}: HTTP ${response.status}`)

      return fail('INTERNAL_ERROR', `Could not load image ${key} (HTTP ${response.status}).`)
    }

    const bytes = new Uint8Array(await response.arrayBuffer())

    if (bytes.byteLength === 0 || bytes.byteLength > ORDER_IMAGE_MAX_BYTES) {
      return fail('INTERNAL_ERROR', `Image ${key} came back empty or too large.`)
    }

    return ok({ bytes, contentType: response.headers.get('content-type') || 'image/jpeg' })
  } catch (error) {
    logger.warn(`[claim-upload] order image ${key} could not be fetched`, error)

    return fail('INTERNAL_ERROR', `Could not load image ${key}. Check the connection.`)
  }
}

/** The SKU-code map for one AWB, scoped to the signed-in company. */
export const productSkuMap = async (payload: unknown): Promise<Result<unknown>> => {
  const { awb, companyId } = (payload ?? {}) as { awb?: string; companyId?: string }

  if (!text(awb) || !text(companyId)) return ok(null)

  return apiRequest<unknown>(
    `/product-skucode-map/${encodeURIComponent(text(awb))}/${encodeURIComponent(text(companyId))}`,
    { token: token() }
  )
}

/**
 * One marketplace's master row for an order.
 *
 * Three endpoints behind one channel, picked by `platform` — the alternative is
 * three near-identical channels, and the form asks the same question of each.
 * An unknown platform answers null rather than erroring: not every marketplace
 * has a master lookup, and the form treats "nothing to prefill" as normal.
 */
export const masterOrderInfo = async (payload: unknown): Promise<Result<unknown>> => {
  const { platform, params } = (payload ?? {}) as {
    platform?: string
    params?: Record<string, string>
  }

  const path: Record<string, string> = {
    meesho: '/master/meesho-order-info',
    snapdeal: '/master/snapdeal-order-info',
    myntra: '/master/myntra-order-info'
  }

  const endpoint = path[platformKey(text(platform))]

  if (!endpoint) return ok(null)

  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(params ?? {})) {
    if (typeof value === 'string' && value.trim()) query.set(key, value.trim())
  }

  if ([...query.keys()].length === 0) return ok(null)

  return apiRequest<unknown>(`${endpoint}?${query.toString()}`, { token: token() })
}

/** A tracking number: one token, no spaces, of a sane length. */
const AWB_SHAPE = /^[A-Za-z0-9-]{6,40}$/

const reasonOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

/**
 * Create Claim's return-AWB autofill: forward AWB, SKU and owning account.
 *
 * WHICH ACCOUNTS. The one the operator chose, when they chose one. Otherwise
 * every account the company holds for the platform, asked AT ONCE — each ask
 * is one HTTP call on a saved session, so four accounts cost what one does,
 * and the operator is waiting on the form.
 *
 * NO SIGN-IN, NO AUTOMATION LOCK. Both would put a typing operator behind
 * whatever hour-long run holds the browser, for a question a saved session
 * answers in a second. An account whose session is dead is reported as a
 * failure, so the toast can say which login needs re-capturing.
 */
export const returnAwbAutofill = async (payload: unknown): Promise<Result<ReturnAwbAutofill>> => {
  const request = (payload ?? {}) as { platform?: unknown; awb?: unknown; username?: unknown }
  const platform = text(request.platform)
  const awb = text(request.awb)
  const chosen = text(request.username)

  const lookup = returnAwbLookup(platform)

  if (!lookup) return fail('VALIDATION_ERROR', `Return AWB autofill is not available for ${platform || 'this platform'}`)
  if (!AWB_SHAPE.test(awb)) return fail('VALIDATION_ERROR', `"${awb}" is not a tracking number`)

  const accounts = chosen
    ? [chosen]
    : (await credentialsFor(platform))
        .map(credential => credential.username.trim())
        .filter(username => username.length > 0)

  const empty: ReturnAwbAutofill = {
    found: false,
    username: null,
    forwardAwb: null,
    sku: null,
    price: null,
    subOrderNumber: null,
    orderId: null,
    logisticsPartner: null,
    asked: accounts.length,
    failures: []
  }

  if (accounts.length === 0) return ok(empty)

  const answers = await Promise.allSettled(accounts.map(username => lookup({ awb, username })))
  const failures: ReturnAwbAccountFailure[] = []
  let hit: ReturnAwbAutofill | null = null

  answers.forEach((answer, index) => {
    const username = accounts[index] ?? ''

    if (answer.status === 'rejected') {
      failures.push({ username, reason: reasonOf(answer.reason) })

      return
    }

    // First account in stored order wins. Two accounts holding one return AWB
    // is not something Myntra does; if it ever did, stored order is at least
    // the same answer every time.
    if (answer.value && !hit) {
      hit = {
        ...empty,
        found: true,
        username,
        forwardAwb: answer.value.forwardAwb,
        sku: answer.value.sku,
        price: answer.value.price ?? null,
        subOrderNumber: answer.value.subOrderNumber ?? null,
        orderId: answer.value.orderId ?? null,
        logisticsPartner: answer.value.logisticsPartner ?? null
      }
    }
  })

  for (const failure of failures) {
    logger.warn(`[return-awb] ${platform}/${failure.username}: could not ask about ${awb} — ${failure.reason}`)
  }

  const result: ReturnAwbAutofill = hit ? { ...(hit as ReturnAwbAutofill), failures } : { ...empty, failures }

  logger.info(
    `[return-awb] ${platform} ${awb}: ` +
      (result.found
        ? `found on ${result.username}` +
          // The ids the form will fill — so a blank one on the saved claim can
          // be told apart from one the marketplace never gave.
          (result.orderId !== null || result.subOrderNumber !== null
            ? ` (order ${result.orderId ?? '—'}, item/sub-order ${result.subOrderNumber ?? '—'})`
            : '')
        : 'not found') +
      ` — asked ${accounts.length} account(s), ${failures.length} could not answer`
  )

  return ok(result)
}

/** The company's capture feeds, active ones only. */
export const commonFeeds = async (): Promise<Result<CommonFeed[]>> => {
  const response = await apiRequest<unknown>('/feed/common-feed', { token: token() })

  if (!response.success) return response

  // The endpoint has answered both `{ data: [...] }` and a bare array over its
  // life; the web app tolerates both, so this does too.
  const raw = Array.isArray(response.data)
    ? response.data
    : ((response.data as { data?: unknown })?.data ?? [])

  if (!Array.isArray(raw)) return ok([])

  return ok(
    raw
      .map((entry): CommonFeed | null => {
        if (!entry || typeof entry !== 'object') return null

        const record = entry as Record<string, unknown>
        const id = text(record._id)

        if (!id) return null

        return {
          _id: id,
          feedName: text(record.feedName) || text(record.name),
          isDisable: record.isDisable === true,
          isDeleted: record.isDeleted === true
        }
      })
      .filter((feed): feed is CommonFeed => feed !== null && !feed.isDisable && !feed.isDeleted)
  )
}

// ── Writes ─────────────────────────────────────────────────────────────────

/**
 * One file on its way to the server, as the renderer hands it over.
 *
 * The bytes cross IPC as a plain array because that is what structured clone
 * carries reliably from a renderer `File`; they are turned back into a
 * `Uint8Array` here, once, rather than by every caller.
 */
export interface TransferFile {
  fieldName: string
  filename: string
  contentType: string
  bytes: ArrayBuffer | Uint8Array | number[]
}

const toBytes = (value: TransferFile['bytes']): Uint8Array => {
  if (value instanceof Uint8Array) return value
  if (value instanceof ArrayBuffer) return new Uint8Array(value)

  return Uint8Array.from(Array.isArray(value) ? value : [])
}

const toUploadFiles = (files: unknown): UploadFile[] => {
  if (!Array.isArray(files)) return []

  return files
    .map((entry): UploadFile | null => {
      if (!entry || typeof entry !== 'object') return null

      const file = entry as TransferFile
      const fieldName = text(file.fieldName)
      const filename = text(file.filename)

      if (!fieldName || !filename) return null

      return {
        name: fieldName,
        filename,
        contentType: text(file.contentType) || 'application/octet-stream',
        data: toBytes(file.bytes)
      }
    })
    .filter((file): file is UploadFile => file !== null)
}

const toUploadFields = (fields: unknown): UploadField[] => {
  if (!fields || typeof fields !== 'object') return []

  return Object.entries(fields as Record<string, unknown>)
    .filter(([name, value]) => name.length > 0 && typeof value === 'string')
    .map(([name, value]) => ({ name, value: value as string }))
}

/**
 * Stores one image (or the six-side PDF) and answers with its S3 key.
 *
 * Every image on the form goes through here FIRST, and only the key it returns
 * is put on the claim — which is why `/cms/createCMS` carries text fields and a
 * single PDF rather than a dozen photographs. It also means a failed upload is
 * reported while the operator is still looking at the slot that failed.
 */
export const uploadClaimImage = async (payload: unknown): Promise<Result<{ key: string }>> => {
  const { file, feedId } = (payload ?? {}) as { file?: unknown; feedId?: string }
  const files = toUploadFiles(file ? [file] : [])

  if (files.length === 0) return fail('VALIDATION_ERROR', 'No file was provided to upload.')

  // Omitted when empty: the backend stores it as an ObjectId, and "" fails the
  // cast inside a catch that answers success with a null key.
  const feed = text(feedId)

  const response = await apiUpload<{ key?: string }>('/cms/uploadImage', {
    files: [{ ...(files[0] as UploadFile), name: 'file' }],
    fields: feed ? [{ name: 'feedId', value: feed }] : [],
    token: token()
  })

  const sent = files[0] as UploadFile
  const what = `${sent.filename} (${sent.contentType}, ${sent.data.byteLength} bytes)`

  // Logged, because the renderer's toast is one line and the six-side PDF's
  // failures were reaching nobody — not the log, not the operator.
  if (!response.success) {
    logger.warn(`[claim-upload] ${what} was refused: ${response.error.message}`)

    return response
  }

  const key = text(response.data?.key)

  if (!key) {
    // The backend answers success with a null key when storing the file failed
    // on its side (its createFile swallows the error).
    logger.warn(`[claim-upload] ${what}: the server answered without a key`)

    return fail('INTERNAL_ERROR', 'The server accepted the file but could not store it.')
  }

  return ok({ key })
}

/**
 * How long one claim video may take to reach the server and be stored.
 *
 * The video goes up exactly as the operator chose it — no re-encode, no size
 * cap on this machine. The backend re-encodes it before it answers, so a large
 * file is minutes of upload and then minutes of server work; the three-minute
 * default every other upload gets would cut that off part-way.
 *
 * `longRunning` on the upload is what makes this number real: Node's fetch
 * hangs up after five minutes without a response whatever the timeout says
 * (see `sendUpload` in httpClient).
 */
const CLAIM_VIDEO_UPLOAD_TIMEOUT_MS = 30 * 60 * 1000

/** Stores one recorded video and answers with the id the claim references. */
export const storeClaimVideo = async (payload: unknown): Promise<Result<unknown>> => {
  const { file, feedId, fields } = (payload ?? {}) as {
    file?: unknown
    feedId?: string
    fields?: Record<string, unknown>
  }
  const files = toUploadFiles(file ? [file] : [])

  if (files.length === 0) return fail('VALIDATION_ERROR', 'No video was provided to upload.')

  return apiUpload<unknown>('/cms/storeVideo', {
    files: [{ ...(files[0] as UploadFile), name: 'file' }],
    fields: [{ name: 'feedId', value: text(feedId) }, ...toUploadFields(fields)],
    token: token(),
    timeoutMs: CLAIM_VIDEO_UPLOAD_TIMEOUT_MS,
    longRunning: true
  })
}

/**
 * Bulk Claim step one: the uploaded report, matched against what VMS recorded.
 *
 * The file itself crosses IPC as bytes, the same way a claim photograph does.
 */
export const bulkClaimCheck = async (payload: unknown): Promise<Result<unknown>> => {
  const { file } = (payload ?? {}) as { file?: unknown }
  const files = toUploadFiles(file ? [file] : [])

  if (files.length === 0) return fail('VALIDATION_ERROR', 'No report was provided.')

  return apiUpload<unknown>('/cms/bulk-claim-check', {
    files: [{ ...(files[0] as UploadFile), name: 'file' }],
    token: token()
  })
}

/** Step two: can each matched row actually be filed? */
export const bulkClaimVerify = async (payload: unknown): Promise<Result<unknown>> => {
  const { rows } = (payload ?? {}) as { rows?: unknown }

  if (!Array.isArray(rows) || rows.length === 0) return ok({ results: [] })

  // Longer than the default: this fans out to one marketplace lookup per row,
  // and a report is hundreds of rows.
  return apiRequest<unknown>('/cms/bulk-claim-verify', {
    method: 'POST',
    body: { rows },
    token: token(),
    timeoutMs: 300_000
  })
}

/** Step three: file the rows the operator kept. */
export const bulkClaimCreate = async (payload: unknown): Promise<Result<unknown>> => {
  const { rows } = (payload ?? {}) as { rows?: unknown }

  if (!Array.isArray(rows) || rows.length === 0) {
    return fail('VALIDATION_ERROR', 'No verified rows to create.')
  }

  logger.info('Filing claims in bulk from the desktop form', { rows: rows.length })

  return apiRequest<unknown>('/cms/bulk-claim-create', {
    method: 'POST',
    body: { rows },
    token: token(),
    timeoutMs: 300_000
  })
}

/**
 * Removes a stored file.
 *
 * An operator who clears an image slot has decided that photograph is not
 * evidence. Deleting it keeps the bucket from filling with objects no claim
 * references — and keeps a photograph of the wrong parcel from staying
 * retrievable against a claim it was never part of.
 */
export const deleteClaimFile = async (payload: unknown): Promise<Result<unknown>> => {
  const { fileKey } = (payload ?? {}) as { fileKey?: string }

  if (!text(fileKey)) return fail('VALIDATION_ERROR', 'No file was named to delete.')

  return apiRequest<unknown>(`/files/${encodeURIComponent(text(fileKey))}`, {
    method: 'DELETE',
    token: token()
  })
}

/**
 * Creates the claim.
 *
 * The renderer has already resolved every image to a key, so the body is text
 * fields — which is why this is `apiUpload` with no files at all: the endpoint
 * is multipart (multer), and a JSON body would be read as empty. `autoClaim` is
 * sent as the string "true"; the backend accepts either.
 */
export const createClaim = async (payload: unknown): Promise<Result<unknown>> => {
  const { fields } = (payload ?? {}) as { fields?: Record<string, unknown> }
  const parts = toUploadFields(fields)

  if (parts.length === 0) return fail('VALIDATION_ERROR', 'The claim had no fields to save.')

  logger.info('Creating a claim from the desktop form', {
    platform: fields?.eCommercePlatform,
    awb: fields?.AWBNumber
  })

  // The whole envelope, so the form can show the backend's `displayMessage`
  // and `autoClaim` outcome rather than a generic "created".
  const response = await apiUpload<unknown>('/cms/createCMS', {
    fields: parts,
    token: token(),
    keepEnvelope: true
  })

  /*
   * A SAVED CLAIM WAKES AUTO CLAIM.
   *
   * After the save, never during it: the row is on Pending by the time the
   * task reads its list. The task files only what `selectionBlockReason`
   * passes — a claim missing its account, POB ID or sub-order number is
   * skipped as "not yet fileable", exactly as on the schedule — and it is never
   * started twice: a save during a run queues ONE more run after it, which
   * reads the list again and so covers every claim saved in the meantime.
   */
  if (response.success) void requestTaskRun('auto-claim', 'a claim was saved')

  return response
}

/**
 * Writes back to a claim that already exists.
 *
 * JSON, not multipart — `/cms/updateCMS` takes a plain body, and it accepts a
 * SUBSET of the create fields: anything absent keeps its stored value. That is
 * what lets an operator open a filed claim, fix its remark, and save without
 * re-uploading ten photographs.
 */
export const updateClaim = async (payload: unknown): Promise<Result<unknown>> => {
  const body = (payload ?? {}) as Record<string, unknown>

  if (!text(body.cmsId)) return fail('VALIDATION_ERROR', 'Which claim to update was not given.')

  logger.info('Updating a claim from the desktop form', { cmsId: body.cmsId })

  return apiRequest<unknown>('/cms/updateCMS', { method: 'POST', body, token: token() })
}
