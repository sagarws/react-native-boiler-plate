/**
 * The recorder → local server upload contract (VMS_PROGRESS.txt, 2026-11-18).
 *
 * Argos Watch posted ONE multipart form to the sidecar's POST /upload (multer).
 * The CMS's local server has no multipart parser, so the same request is made
 * in two steps:
 *
 *   1. POST /upload/file per file — the raw bytes as the body, the name in
 *      `x-file-name` (URI-encoded) — answers `{ id }`. Video first, then each
 *      screenshot in order.
 *   2. POST /upload with JSON `{ file, files, fields }` — `fields` are exactly
 *      the text fields Argos Watch appended to its FormData, as the same
 *      strings — answers what Argos Watch's /upload answered.
 *
 * Step 2's raw response is handed back untouched, so CaptureShell parses and
 * reacts to it exactly as Argos Watch did.
 */

export interface UploadFile {
  blob: Blob
  name: string
}

/** The text fields of Argos Watch's FormData, verbatim and as strings. */
export interface UploadFields {
  trackingId: string
  orderType: string
  size: string
  videoDuration: string
  start_time: string
  keepOld: string
  needRefund: string
  orderCondition: string
  eCommercePlatform: string
}

export interface UploadResponse {
  status: number
  ok: boolean
  rawText: string
}

/** A step-1 refusal, carrying the message the operator is shown. */
export class UploadStepError extends Error {}

const baseUrl = (port: number): string => `http://127.0.0.1:${port}`

const sendFile = async (port: number, file: UploadFile): Promise<string> => {
  const response = await fetch(`${baseUrl(port)}/upload/file`, {
    method: 'POST',
    headers: { 'x-file-name': encodeURIComponent(file.name) },
    body: file.blob
  })

  const rawText = await response.text()
  let body: { id?: unknown; data?: { id?: unknown }; error?: { message?: string } }

  try {
    body = JSON.parse(rawText) as typeof body
  } catch {
    throw new UploadStepError(`Sidecar returned non-JSON (HTTP ${response.status}): ${rawText.slice(0, 120)}`)
  }

  const id = typeof body.id === 'string' ? body.id : typeof body.data?.id === 'string' ? body.data.id : null

  if (!response.ok || !id) {
    throw new UploadStepError(body.error?.message ?? `Sidecar rejected ${file.name} (HTTP ${response.status})`)
  }

  return id
}

/**
 * Sends the video and the screenshots, then the order. Throws UploadStepError
 * when a file is refused, and whatever fetch throws when the server is
 * unreachable; otherwise resolves with /upload's raw answer.
 */
export const uploadOrder = async (
  port: number,
  video: UploadFile,
  screenshots: UploadFile[],
  fields: UploadFields
): Promise<UploadResponse> => {
  const file = await sendFile(port, video)
  const files: string[] = []

  for (const shot of screenshots) files.push(await sendFile(port, shot))

  const response = await fetch(`${baseUrl(port)}/upload`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ file, files, fields })
  })

  return { status: response.status, ok: response.ok, rawText: await response.text() }
}
