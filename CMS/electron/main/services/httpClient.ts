import { fail, type Result } from '@shared/types/result'
import { env } from '../config/env'
import { logger } from './logger'

/**
 * Thin JSON client over Node's built-in fetch (Electron 43 ships Node 22, so
 * global fetch and AbortSignal.timeout are available). No axios: the project
 * rule is built-ins first, and the only thing this app needs is JSON in, JSON
 * out with a timeout.
 *
 * All network access lives in the main process. The renderer's CSP restricts it
 * to `connect-src 'self'`, and the access token must never be readable from
 * renderer JavaScript, so there is no second HTTP client on the other side.
 */

/** The envelope every TrackVid endpoint returns. */
export interface ApiEnvelope<T> {
  isSuccess: boolean
  data: T | null
  message?: string
  displayMessage?: string
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  body?: unknown
  /** Bearer token; omitted for unauthenticated endpoints such as login. */
  token?: string
  /**
   * Overrides the default budget for calls that are legitimately slow.
   *
   * Session renewal drives a real browser login server-side and routinely takes
   * over a minute; the 20s default would abort it while the server is still
   * working, leaving the app reporting a timeout for a renewal that succeeded.
   */
  timeoutMs?: number
  /**
   * Answer with the whole envelope instead of its `data`.
   *
   * Set by `apiEnvelope`; no caller should pass it directly.
   */
  keepEnvelope?: boolean
  /**
   * Accept a body that is plain JSON rather than the `{ isSuccess, data }`
   * envelope, and answer with it whole.
   *
   * For the few routes written without the envelope — the mailbox and email
   * routes answer `{ mailboxes }`, `{ items, total }` and report a failure as
   * `{ error, code }`. Off by default, so every other caller still treats an
   * envelope-less body as the unexpected response it is.
   */
  bare?: boolean
}

const isEnvelope = (value: unknown): value is ApiEnvelope<unknown> =>
  typeof value === 'object' && value !== null && 'isSuccess' in value

/**
 * Performs the call and normalises everything - transport failure, non-2xx,
 * and a well-formed `isSuccess: false` - into a Result. Nothing throws.
 */
export const apiRequest = async <T>(path: string, options: RequestOptions = {}): Promise<Result<T>> => {
  const { method = 'GET', body, token, timeoutMs, keepEnvelope = false, bare = false } = options
  const url = `${env.apiUrl}${path}`

  const headers: Record<string, string> = { Accept: 'application/json' }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (token) headers['Authorization'] = `Bearer ${token}`

  let response: Response
  try {
    response = await fetch(url, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      // Bounded so a hung server can never leave the UI spinning forever.
      signal: AbortSignal.timeout(timeoutMs ?? env.apiTimeoutMs)
    })
  } catch (error) {
    // Path is logged, never surfaced: the user-facing copy stays generic.
    logger.warn('API request failed', { path, error: error instanceof Error ? error.message : String(error) })
    const timedOut = error instanceof Error && error.name === 'TimeoutError'
    return fail(
      'INTERNAL_ERROR',
      timedOut
        ? 'The server took too long to respond. Please try again.'
        : 'Cannot reach the TrackVid server. Check your internet connection.'
    )
  }

  return interpret<T>(path, response, keepEnvelope, bare, Boolean(token))
}

/**
 * The same call, answering with the WHOLE envelope rather than its `data`.
 *
 * A few TrackVid endpoints put more than one thing at the top level:
 * `/order/{awb}` answers `{ isSuccess, data: [...], skus: [...], records: [...] }`,
 * and the claim form reads all three. `apiRequest` hands back `data` alone, so
 * those siblings would be dropped somewhere between the server and the screen —
 * silently, as a SKU picker that never appears on a multi-line order.
 */
export const apiEnvelope = async <T>(
  path: string,
  options: RequestOptions = {}
): Promise<Result<ApiEnvelope<T>>> => {
  const result = await apiRequest<T>(path, { ...options, keepEnvelope: true })

  return result as Result<ApiEnvelope<T>>
}

/**
 * Turns a response into a Result. Shared by `apiRequest` and `apiUpload` so a
 * JSON call and a multipart upload report a failure identically — the same
 * codes, the same wording, the same log line.
 */
const interpret = async <T>(
  path: string,
  response: Response,
  keepEnvelope = false,
  bare = false,
  authenticated = false
): Promise<Result<T>> => {
  let payload: unknown = null
  try {
    payload = await response.json()
  } catch {
    // A non-JSON body (HTML error page, empty 204) is handled by the checks below.
  }

  const envelope = isEnvelope(payload) ? payload : null

  if (!response.ok || envelope?.isSuccess === false) {
    // A bare route reports a failure as `{ error }`; read it only when asked
    // to, so no enveloped route changes the words it shows.
    const bareError =
      bare && typeof (payload as { error?: unknown } | null)?.error === 'string'
        ? ((payload as { error: string }).error)
        : undefined
    const message =
      envelope?.displayMessage ?? envelope?.message ?? bareError ?? 'The request could not be completed.'

    // BOTH, and the technical one in the log.
    //
    // `displayMessage` is written for somebody looking at a dialog — "Could not
    // read the Tata CliQ one-time code." — while `message` carries the cause:
    // which host refused the connection, which variable is unset. Logging only
    // the first turned a server that was simply not running into two minutes of
    // guesswork.
    logger.warn('API responded with an error', {
      path,
      status: response.status,
      ...(envelope?.message && envelope.message !== message ? { cause: envelope.message } : {})
    })

    // 401 ON A CALL THAT CARRIED A TOKEN is the token being refused — expired,
    // revoked, or ended by a password change — and is flagged so a caller can
    // send the operator to sign in. Without a token (login itself) a 401 is a
    // wrong password, and a 403 is a permission, not a dead session.
    if (response.status === 401 && authenticated) {
      return { success: false, error: { code: 'VALIDATION_ERROR', message, sessionEnded: true } }
    }
    if (response.status === 401 || response.status === 403) return fail('VALIDATION_ERROR', message)
    if (response.status === 404) return fail('NOT_FOUND', message)
    if (response.status >= 400 && response.status < 500) return fail('VALIDATION_ERROR', message)
    return fail('INTERNAL_ERROR', message)
  }

  if (!envelope) {
    if (bare && payload !== null && typeof payload === 'object') return { success: true, data: payload as T }

    return fail('INTERNAL_ERROR', 'The server returned an unexpected response.')
  }

  return { success: true, data: (keepEnvelope ? envelope : envelope.data) as T }
}

/** One text field of a multipart body. */
export interface UploadField {
  name: string
  value: string
}

/** One file part of a multipart body. */
export interface UploadFile {
  name: string
  filename: string
  contentType: string
  data: Uint8Array
}

export interface UploadOptions {
  fields?: UploadField[]
  files?: UploadFile[]
  token?: string
  timeoutMs?: number
  /** Return the whole `{ isSuccess, data, displayMessage, … }` body. */
  keepEnvelope?: boolean
  /**
   * The server may take longer than five minutes to answer — see
   * `sendUpload`. Without it a `timeoutMs` above five minutes is a promise
   * Node's fetch does not keep.
   */
  longRunning?: boolean
}

/**
 * Sends one upload, through Chromium's network stack when the answer may be slow.
 *
 * Node's global fetch (undici) drops any request whose response HEADERS have
 * not arrived within five minutes (`headersTimeout`, 300 s), whatever the
 * AbortSignal says — and it reports that as a bare "fetch failed". The backend
 * re-encodes a claim video before it answers, which for a long 1080p video is
 * more than five minutes: the server finished, stored the video and charged
 * for it, and the app had already hung up, so the claim had no video.
 *
 * Electron's `net.fetch` has no such cap — the AbortSignal is the only budget —
 * and takes the same FormData body, so the multipart encoding is unchanged.
 * It is opt-in because it needs the app to be ready and every other call here
 * answers in seconds.
 */
const sendUpload = async (url: string, init: RequestInit, longRunning: boolean): Promise<Response> => {
  if (!longRunning) return fetch(url, init)

  const { net } = await import('electron')

  return net.fetch(url, init)
}

/**
 * The multipart half of the client, for the three endpoints that take files:
 * `/cms/createCMS`, `/cms/uploadImage` and `/cms/storeVideo`.
 *
 * Node 22 ships `FormData` and `Blob` as globals and `fetch` sets the boundary
 * itself, so there is no multipart encoder here and no new dependency — which
 * is the whole reason this sits beside `apiRequest` rather than pulling in a
 * second HTTP stack. `Content-Type` is deliberately NOT set: setting it by hand
 * omits the boundary and the server reads the body as empty.
 *
 * A DIFFERENT DEFAULT TIMEOUT. A claim carries a video and up to ten
 * photographs, and 20 seconds is a budget for a JSON round trip, not for an
 * upload over an operator's office broadband. Aborting mid-upload loses work
 * that cannot be recovered by retrying — the files are gone from the form —
 * so uploads get three minutes unless the caller says otherwise.
 */
const UPLOAD_TIMEOUT_MS = 180_000

export const apiUpload = async <T>(path: string, options: UploadOptions = {}): Promise<Result<T>> => {
  const { fields = [], files = [], token, timeoutMs, keepEnvelope = false, longRunning = false } = options
  const url = `${env.apiUrl}${path}`

  const body = new FormData()
  for (const field of fields) body.append(field.name, field.value)
  for (const file of files) {
    // A fresh ArrayBuffer per part: a Uint8Array that is a VIEW onto a larger
    // buffer (which is what `subarray` and most decoders return) would
    // otherwise upload the whole backing buffer.
    const bytes = new Uint8Array(file.data)
    body.append(file.name, new Blob([bytes], { type: file.contentType }), file.filename)
  }

  const headers: Record<string, string> = { Accept: 'application/json' }
  if (token) headers['Authorization'] = `Bearer ${token}`

  let response: Response
  try {
    response = await sendUpload(
      url,
      { method: 'POST', headers, body, signal: AbortSignal.timeout(timeoutMs ?? UPLOAD_TIMEOUT_MS) },
      longRunning
    )
  } catch (error) {
    // `cause` is where undici puts the real reason behind "fetch failed".
    const cause = error instanceof Error && error.cause instanceof Error ? error.cause.message : undefined
    logger.warn('API upload failed', {
      path,
      error: error instanceof Error ? error.message : String(error),
      ...(cause ? { cause } : {})
    })
    const timedOut = error instanceof Error && error.name === 'TimeoutError'

    return fail(
      'INTERNAL_ERROR',
      timedOut
        ? 'The upload took too long and was stopped. Check the connection and try again.'
        : 'Cannot reach the TrackVid server. Check your internet connection.'
    )
  }

  return interpret<T>(path, response, keepEnvelope, false, Boolean(token))
}
