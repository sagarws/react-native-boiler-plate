import { app, dialog } from 'electron'
import { createWriteStream } from 'node:fs'
import { rm } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type {
  ClaimResourceRequest,
  ClaimResourceResult,
  VideoSizeChoice
} from '@shared/types/claimResources'
import { fail, ok, type Result } from '@shared/types/result'
import type { ClaimDocument } from '@main/automations/common/types'
import {
  supportingFiles,
  type ClaimResources,
  type ResourceFile
} from '@main/automations/common/claimResources'
import { withTempDir } from '@main/automations/common/tempDir'
import { writeZip, type ZipEntry } from '@main/automations/common/zipWriter'
import { claimResourceBuilder } from '@main/automations/registry'
import { loadCore } from '@main/automations/common/coreLoader'
import { apiRequest } from './httpClient'
import { getAccessToken } from './session.store'
import { env } from '../config/env'
import { logger } from './logger'

/**
 * "Download Resource" on a claim row: every piece of evidence that claim needs,
 * in one zip, named after the platform's claim form — for filing it by hand.
 *
 * Orchestration only. What goes in the zip and what each file is called is the
 * platform's (`registry.ts` → `CLAIM_RESOURCES`); this reads the claim, fetches
 * the files and writes the archive.
 *
 * Archive layout:
 *   claim_details.txt   the form's text fields, and which file goes in which slot
 *   description.txt     the claim description, ready to paste
 *   <form files>        named after the claim form's slots
 *   supporting/         evidence on the row the form has no slot for
 *   MISSING.txt         anything listed that could not be downloaded
 */

const DOWNLOAD_TIMEOUT_MS = 120_000

/** Extension for a download whose URL has none. */
const EXT_BY_TYPE: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/heic': '.heic',
  'video/mp4': '.mp4',
  'video/quicktime': '.mov',
  'video/webm': '.webm',
  'application/pdf': '.pdf'
}

const RESERVED = new Set('\\/:*?"<>|')

/** Characters no filename may hold on Windows or macOS — the reserved set and control characters. */
const safeName = (value: string): string =>
  Array.from(value, ch => (RESERVED.has(ch) || ch.charCodeAt(0) < 32 ? '_' : ch))
    .join('')
    .replace(/_+/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120) || 'file'

const validate = (payload: unknown): ClaimResourceRequest | null => {
  if (!payload || typeof payload !== 'object') return null

  const { cmsId, platform, awbNumber, video } = payload as Record<string, unknown>
  const str = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

  if (!str(platform) || !str(awbNumber)) return null

  return {
    cmsId: str(cmsId),
    platform: str(platform),
    awbNumber: str(awbNumber),
    // Anything other than the one word that means "make it fit" leaves the
    // file alone. A malformed choice must not silently re-encode evidence.
    video: video === 'fit' ? 'fit' : 'original'
  }
}

interface Fetched {
  file: ResourceFile
  path: string
  ext: string
}

/**
 * Downloads one file. Returns why it failed instead of throwing: one dead link
 * must not cost the operator the other nine files.
 */
const download = async (file: ResourceFile, dir: string, index: number): Promise<Fetched | string> => {
  try {
    const response = await fetch(file.url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) })

    if (!response.ok || !response.body) return `HTTP ${response.status}`

    const type = (response.headers.get('content-type') ?? '').split(';')[0]?.trim().toLowerCase() ?? ''

    // A Drive or preview link answers with a web page, not the file. Saving that
    // as "video.mp4" would hand the operator a broken attachment that looks fine.
    if (type === 'text/html') {
      await response.body.cancel()

      return 'the link opens a web page, not the file (e.g. Google Drive) — open it and download manually'
    }

    const fromUrl = extname(new URL(file.url).pathname).toLowerCase()
    const ext = /^\.[a-z0-9]{1,5}$/.test(fromUrl) ? fromUrl : (EXT_BY_TYPE[type] ?? '')
    const path = join(dir, `${index}${ext}`)

    await pipeline(
      Readable.fromWeb(response.body),
      createWriteStream(path)
    )

    return { file, path, ext }
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

/** Keeps names unique inside one folder of the archive: `evidence_1`, `evidence_1 (2)`. */
const uniqueNamer = (): ((name: string) => string) => {
  const used = new Set<string>()

  return name => {
    let candidate = name
    let n = 2

    while (used.has(candidate.toLowerCase())) candidate = name.replace(/(\.[^.]*)?$/, ` (${n++})$1`)
    used.add(candidate.toLowerCase())

    return candidate
  }
}

const detailsText = (
  platform: string,
  resources: ClaimResources,
  placed: { archiveName: string; field: string }[]
): string => {
  const width = Math.max(...resources.fields.map(([label]) => label.length), 10)
  const seen = new Set<string>()
  const fields = resources.fields.filter(([label, value]) => {
    if (!value || seen.has(label)) return false
    seen.add(label)

    return true
  })

  return [
    `${platform} claim — evidence for manual filing`,
    `Prepared ${new Date().toLocaleString()}`,
    '',
    'FORM FIELDS',
    ...(fields.length ? fields.map(([label, value]) => `  ${label.padEnd(width)}  ${value}`) : ['  (none on this row)']),
    '',
    'FILES → FORM FIELD',
    ...(placed.length ? placed.map(p => `  ${p.archiveName}  →  ${p.field}`) : ['  (no files)']),
    '',
    'The description to paste is in description.txt.',
    ''
  ].join('\n')
}

/** The video extensions this download may re-encode. */
const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.m4v', '.webm', '.avi', '.mkv'])

interface CoreUploadLimits {
  uploadLimitFor: (platform: string) => number | null
}

interface CoreVideoCompress {
  fitVideoToLimit: (
    input: string,
    options: { maxBytes: number; tempDir?: string; logger?: unknown }
  ) => Promise<{ path: string; compressed: boolean; from: number; to: number; reason: string | null }>
}

/**
 * Re-encodes the archive's video to fit the marketplace's cap, if asked.
 *
 * WHY THIS IS OFFERED AT ALL. "Download Resource" exists for filing a claim by
 * hand, and the portal that rejects an oversized video from the runner rejects
 * it from a person too — so a zip whose video cannot be uploaded is a zip that
 * does not finish the job. The operator is asked rather than assumed at,
 * because the full-quality file is the right one for everything that is not
 * that form.
 *
 * Mutates `fetched` in place: the entry keeps its name and its slot in the
 * claim form, and only the bytes behind it change. A reviewer opening the zip
 * should not have to work out which of two videos to attach.
 */
const fitArchiveVideo = async (
  fetched: Fetched[],
  platform: string,
  choice: VideoSizeChoice,
  dir: string
): Promise<ClaimResourceResult['video']> => {
  if (choice !== 'fit') return undefined

  const { uploadLimitFor } = loadCore<CoreUploadLimits>('common/uploadLimits')
  const maxBytes = uploadLimitFor(platform)

  // No stated cap means no target. Compressing against a number this app
  // invented would cost quality for a limit nobody has ever seen. Checked
  // BEFORE videoCompress is loaded, which pulls in ffmpeg's resolution.
  if (!maxBytes) return undefined

  const video = fetched.find(entry => VIDEO_EXTENSIONS.has(entry.ext))

  if (!video) return undefined

  const { fitVideoToLimit } = loadCore<CoreVideoCompress>('common/videoCompress')

  const fitted = await fitVideoToLimit(video.path, {
    maxBytes,
    tempDir: dir,
    logger: logger
  }).catch((error: unknown) => ({
    path: video.path,
    compressed: false,
    from: 0,
    to: 0,
    reason: error instanceof Error ? error.message : String(error)
  }))

  if (fitted.compressed) {
    video.path = fitted.path
    logger.info(
      `[claim-resources] ${platform}: video re-encoded ${(fitted.from / 1_000_000).toFixed(1)}MB → ` +
        `${(fitted.to / 1_000_000).toFixed(1)}MB to fit ${(maxBytes / 1_000_000).toFixed(1)}MB`
    )

    return { from: fitted.from, to: fitted.to, fitted: true }
  }

  // Already small enough is not a failure and must not be reported as one.
  if (!fitted.reason) return { from: fitted.from, to: fitted.from, fitted: false }

  logger.warn(`[claim-resources] ${platform}: video left as it is — ${fitted.reason}`)

  return { from: fitted.from, to: fitted.from, fitted: false, reason: fitted.reason }
}

export const downloadClaimResources = async (payload: unknown): Promise<Result<ClaimResourceResult>> => {
  const request = validate(payload)

  if (!request) return fail('VALIDATION_ERROR', 'A claim needs a platform and an AWB number')

  const token = getAccessToken()

  if (!token) return fail('VALIDATION_ERROR', 'Sign in to download claim resources')

  const found = await apiRequest<ClaimDocument | null>('/cms/find-by-awb', {
    method: 'POST',
    token,
    body: { awb: request.awbNumber, platform: request.platform }
  })

  if (!found.success) return fail(found.error.code, found.error.message)
  if (!found.data) return fail('NOT_FOUND', `No claim found for AWB ${request.awbNumber}`)

  const doc = found.data
  const config = doc.config && typeof doc.config === 'object' ? doc.config : {}
  const resources = claimResourceBuilder(request.platform)(doc, config)

  const formUrls = new Set(resources.files.map(file => file.url))
  const supporting = supportingFiles(doc).filter(file => !formUrls.has(file.url))
  const baseName = safeName(`${request.platform}_${request.awbNumber}_claim-resources`)

  // Asked BEFORE downloading, so cancelling costs nothing and the operator is
  // not waiting on a video they did not want.
  const chosen = await dialog.showSaveDialog({
    title: `Save the ${request.platform} claim resources for ${request.awbNumber}`,
    defaultPath: join(app.getPath('downloads'), `${baseName}.zip`),
    filters: [{ name: 'Zip archive', extensions: ['zip'] }]
  })

  if (chosen.canceled || !chosen.filePath) return fail('VALIDATION_ERROR', 'Cancelled')

  const target = chosen.filePath

  try {
    return await withTempDir(async dir => {
      const all = [...resources.files, ...supporting]
      const results = await Promise.all(all.map((file, i) => download(file, dir, i)))

      // Before the zip is written, and only on the files that actually
      // arrived: a re-encode of a failed download is a re-encode of nothing.
      const video = await fitArchiveVideo(
        results.filter((result): result is Fetched => typeof result !== 'string'),
        request.platform,
        request.video ?? 'original',
        dir
      )

      const entries: ZipEntry[] = []
      const placed: { archiveName: string; field: string }[] = []
      const missing: string[] = []
      const rootName = uniqueNamer()
      const supportName = uniqueNamer()

      results.forEach((result, i) => {
        const file = all[i] as ResourceFile
        const inSupporting = i >= resources.files.length

        if (typeof result === 'string') {
          missing.push(`${file.name} (${file.field}): ${result}\n    ${file.url}`)

          return
        }

        const leaf = (inSupporting ? supportName : rootName)(`${safeName(file.name)}${result.ext}`)
        const archiveName = inSupporting ? `supporting/${leaf}` : leaf

        entries.push({ name: archiveName, source: { path: result.path } })
        placed.push({ archiveName, field: file.field })
      })

      entries.unshift(
        { name: 'claim_details.txt', source: { text: detailsText(request.platform, resources, placed) } },
        { name: 'description.txt', source: { text: resources.description || '(this claim has no description)' } }
      )

      if (missing.length) {
        entries.push({
          name: 'MISSING.txt',
          source: { text: `These could not be downloaded:\n\n${missing.join('\n\n')}\n` }
        })
      }

      await writeZip(target, entries)

      logger.info(
        `[claim-resources] ${request.platform}/${request.awbNumber}: ${placed.length} file(s)` +
          `${missing.length ? `, ${missing.length} missing` : ''} → ${target}`
      )

      return ok({
        path: target,
        fileCount: entries.length,
        missing: missing.map(line => line.split('\n')[0] ?? line),
        ...(video ? { video } : {})
      })
    })
  } catch (error) {
    // A half-written zip reads as corrupt in every unzip tool; remove it.
    await rm(target, { force: true }).catch(() => undefined)
    logger.error(`[claim-resources] ${request.platform}/${request.awbNumber} failed`, error)

    return fail('INTERNAL_ERROR', error instanceof Error ? error.message : String(error))
  }
}

/**
 * One stored image, as a data URL the renderer can decode.
 *
 * THE SAME ROUTE THE ADMIN PANEL TAKES, deliberately. The FE builds this very
 * PDF from the same strings and it works, because it never fetches the image
 * from storage directly — it takes the LAST PATH SEGMENT as an S3 key and asks
 * the orders API for it (`/order/view/{key}`, see `fetchOrderImageBlob` in
 * TrackVid-FE's image-to-pdf helper).
 *
 * That detail is the whole bug. Fetching the URL as given is a cross-origin,
 * unauthenticated request: the browser renders it in an `<img>` quite happily
 * and cannot read the bytes. Going through the orders API makes it a normal
 * authenticated call, which is why the FE never had this problem and the app
 * did.
 *
 * A DATA URL rather than raw bytes: it crosses the bridge as a string, and
 * `createImageBitmap` takes the blob it decodes to without further ceremony.
 */
export const readRemoteImage = async (payload: unknown): Promise<Result<string>> => {
  const given = typeof (payload as { url?: unknown })?.url === 'string'
    ? String((payload as { url: string }).url).trim()
    : ''

  if (!given) return fail('VALIDATION_ERROR', 'No image given')

  // Already local — a capture this session. Nothing to fetch.
  if (given.startsWith('data:')) return ok(given)
  if (given.startsWith('blob:')) {
    return fail('VALIDATION_ERROR', 'that image is only available in the window that captured it')
  }

  /*
   * THE KEY, FROM WHICHEVER SHAPE THE STRING TAKES.
   *
   * `/order/screenshot` returns a stored url untouched when it already starts
   * with http, and builds an S3 url from the key otherwise (see
   * `getScreenshotLinks` in the backend) — so BOTH arrive here:
   *
   *   https://file.trackvid.in/order/view/abc.jpg   already the file service
   *   https://s3.{region}.amazonaws.com/{bucket}/{key}   built from a key
   *
   * Matching only the second is how this went wrong: "everything after the
   * bucket" turns the FIRST into `view/abc.jpg`, and the request becomes
   * /order/view/view/abc.jpg. The two shapes need telling apart, not one rule
   * stretched over both.
   */
  const path = given.split('?')[0] ?? given
  const alreadyServed = /\/order\/view\/(.+)$/.exec(path)
  const underBucket = /^https?:\/\/[^/]+\/[^/]+\/(.+)$/.exec(path)
  const key = alreadyServed?.[1] ?? underBucket?.[1] ?? path.split('/').pop() ?? path

  if (!key) return fail('VALIDATION_ERROR', `could not read an image key out of "${given}"`)

  if (!env.ordersBaseUrl) {
    return fail(
      'INTERNAL_ERROR',
      'the image service address is not configured — set MAIN_VITE_ORDER_BASE_URL (the FE calls it VITE_APP_ORDER_BASE_URL) and restart'
    )
  }

  const asDataUrl = async (response: Response): Promise<string> => {
    const type = response.headers.get('content-type') ?? 'image/jpeg'
    const bytes = Buffer.from(await response.arrayBuffer())

    return `data:${type};base64,${bytes.toString('base64')}`
  }

  const viaOrders = async (): Promise<string> => {
    // The key keeps its slashes: the route is `/view/:key(*)`, which is
    // declared to match them. encodeURIComponent would send %2F instead.
    const response = await fetch(`${env.ordersBaseUrl}/order/view/${key}`, {
      headers: { Authorization: `Bearer ${getAccessToken() ?? ''}` },
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS)
    })

    if (!response.ok) throw new Error(`the image service answered HTTP ${response.status} for ${key}`)

    const type = response.headers.get('content-type') ?? ''

    // An HTML or JSON body is an error page, not an image — this route reports
    // a missing key as a JSON 404/500 rather than a failed request.
    if (type.includes('text/html') || type.includes('application/json')) {
      throw new Error(`the image service has no file at ${key}`)
    }

    return asDataUrl(response)
  }

  /*
   * STRAIGHT AT THE URL WE WERE GIVEN, which only this process can do.
   *
   * CORS is a browser rule and there is no browser here — the renderer could
   * not read these bytes, and the main process simply can. Worth having as a
   * fallback because it needs no key extraction to be right: whatever the
   * string points at, it is fetched as-is.
   */
  const direct = async (): Promise<string> => {
    // `given`, not `path`: the query string is dropped when extracting a KEY,
    // but it is the signature on a presigned url and dropping it there would
    // turn a working link into a 403.
    const response = await fetch(given, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) })

    if (!response.ok) throw new Error(`the file host answered HTTP ${response.status}`)

    return asDataUrl(response)
  }

  /*
   * DIRECT FIRST, then the orders route.
   *
   * When the string is already a file-service url it just works, with no key
   * extraction to get wrong. The S3 shape fails fast — that bucket is private
   * and answers 403 to anyone — and the orders route handles it, which is the
   * whole reason that route exists.
   */
  try {
    return ok(await direct())
  } catch (directError) {
    const first = directError instanceof Error ? directError.message : String(directError)

    try {
      return ok(await viaOrders())
    } catch (viaOrdersError) {
      const second = viaOrdersError instanceof Error ? viaOrdersError.message : String(viaOrdersError)

      // BOTH reasons: one of them is the real one, and which depends on how
      // the image was stored. Reporting only the first sent us looking at the
      // image service when the key was the problem.
      // Logged here too: the renderer's console is gone once the window
      // closes, and this is the only place both reasons are known.
      logger.warn(`[claim-resources] could not read image ${given}: ${first}; via the image service: ${second}`)

      return fail('INTERNAL_ERROR', `${first}; and via the image service: ${second}`)
    }
  }
}
