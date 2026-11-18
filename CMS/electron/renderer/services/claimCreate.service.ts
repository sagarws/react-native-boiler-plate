import { CLAIM_CREATE_CHANNELS, CLAIM_CREATE_EVENTS } from '@shared/constants/channels'
import type { BulkRefillProgress, BulkRefillRequest, BulkRefillResult } from '@shared/types/bulkRefill'
import type { ClaimFormCatalogue, CommonFeed, ReturnAwbAutofill } from '@shared/types/cmsCreate'
import type { BulkTemplateSpec, BulkWorkbook, IncreffResultsExport } from '@shared/types/bulkClaimSheet'
import type { Result } from '@shared/types/result'
import { invoke, subscribe } from './ipcClient'

/**
 * Everything Create Claim asks the backend, as one renderer-side module.
 *
 * The form cannot reach the network itself — the CSP allows `connect-src
 * 'self'` and the access token never leaves the main process — so each function
 * here is one IPC channel. The web CMS calls these same endpoints directly with
 * axios; this is the desktop's equivalent, and the shapes it returns are the
 * backend's own, untouched, so the ported form code reads them unchanged.
 */

export type OrderType = 'Return' | 'Forward'

/** A file on its way to the main process. See TransferFile in the service. */
export interface TransferFile {
  fieldName: string
  filename: string
  contentType: string
  bytes: ArrayBuffer
}

/**
 * Turns a browser File into something structured clone can carry.
 *
 * An `ArrayBuffer` is transferable and a `File` is not, so this is what makes
 * the upload possible at all. It reads the whole file into memory, which is
 * fine for a photograph and acceptable for a claim video — the same bytes were
 * already in memory as a Blob on this side.
 */
export const toTransferFile = async (file: File, fieldName = 'file'): Promise<TransferFile> => ({
  fieldName,
  filename: file.name || 'upload',
  contentType: file.type || 'application/octet-stream',
  bytes: await file.arrayBuffer()
})

export const claimFormCatalogue = (): Promise<Result<ClaimFormCatalogue>> =>
  invoke<ClaimFormCatalogue>(CLAIM_CREATE_CHANNELS.catalogue)

export const automationPlatforms = (): Promise<Result<string[]>> =>
  invoke<string[]>(CLAIM_CREATE_CHANNELS.automationPlatforms)

export const findClaimByAwb = (awb: string, platform: string): Promise<Result<unknown>> =>
  invoke<unknown>(CLAIM_CREATE_CHANNELS.findByAwb, { awb, platform })

export const accountByAwb = (
  awb: string,
  platform: string,
  type: OrderType
): Promise<Result<{ account: string | null }>> =>
  invoke<{ account: string | null }>(CLAIM_CREATE_CHANNELS.accountByAwb, { awb, platform, type })

export const orderByAwb = (awb: string, type: OrderType): Promise<Result<unknown>> =>
  invoke<unknown>(CLAIM_CREATE_CHANNELS.order, { awb, type })

export const orderScreenshots = (awb: string, type: OrderType): Promise<Result<unknown>> =>
  invoke<unknown>(CLAIM_CREATE_CHANNELS.screenshots, { awb, type })

export const productSkuMap = (awb: string, companyId: string): Promise<Result<unknown>> =>
  invoke<unknown>(CLAIM_CREATE_CHANNELS.skuMap, { awb, companyId })

export const masterOrderInfo = (
  platform: string,
  params: Record<string, string>
): Promise<Result<unknown>> =>
  invoke<unknown>(CLAIM_CREATE_CHANNELS.masterOrderInfo, { platform, params })

/**
 * Forward AWB, SKU and owning account for a return AWB, asked of the
 * marketplace with saved sessions. No `username` asks every account at once.
 */
export const returnAwbAutofill = (
  platform: string,
  awb: string,
  username?: string
): Promise<Result<ReturnAwbAutofill>> =>
  invoke<ReturnAwbAutofill>(CLAIM_CREATE_CHANNELS.returnAwbAutofill, { platform, awb, username })

export const commonFeeds = (): Promise<Result<CommonFeed[]>> =>
  invoke<CommonFeed[]>(CLAIM_CREATE_CHANNELS.feeds)

/** One VMS screenshot's bytes, by its key (a URL is cut to its key in main). */
export const orderImage = (key: string): Promise<Result<{ bytes: Uint8Array; contentType: string }>> =>
  invoke<{ bytes: Uint8Array; contentType: string }>(CLAIM_CREATE_CHANNELS.orderImage, { key })

/** Stores one image (or the six-side PDF) and answers with its S3 key. */
export const uploadClaimImage = async (file: File, feedId: string): Promise<Result<{ key: string }>> =>
  invoke<{ key: string }>(CLAIM_CREATE_CHANNELS.uploadImage, {
    file: await toTransferFile(file),
    feedId
  })

export const storeClaimVideo = async (
  file: File,
  feedId: string,
  fields: Record<string, string> = {}
): Promise<Result<unknown>> =>
  invoke<unknown>(CLAIM_CREATE_CHANNELS.storeVideo, {
    file: await toTransferFile(file),
    feedId,
    fields
  })

/**
 * Files the claim.
 *
 * `fields` is the flat, already-stringified body the web form builds into a
 * FormData — every image resolved to a key, every per-platform bundle
 * JSON-stringified. Keeping that shape means the submit code is the same on
 * both surfaces, and the backend cannot tell which one filed the claim.
 */
export const createClaim = (fields: Record<string, string>): Promise<Result<unknown>> =>
  invoke<unknown>(CLAIM_CREATE_CHANNELS.create, { fields })

/** Bulk Claim: match an uploaded Increff report against what VMS recorded. */
export const bulkClaimCheck = async (file: File): Promise<Result<unknown>> =>
  invoke<unknown>(CLAIM_CREATE_CHANNELS.bulkCheck, { file: await toTransferFile(file) })

/** Bulk Claim: ask each marketplace whether the matched rows can be filed. */
export const bulkClaimVerify = (rows: unknown[]): Promise<Result<unknown>> =>
  invoke<unknown>(CLAIM_CREATE_CHANNELS.bulkVerify, { rows })

/** Bulk Claim: file the verified rows. */
export const bulkClaimCreate = (rows: unknown[]): Promise<Result<unknown>> =>
  invoke<unknown>(CLAIM_CREATE_CHANNELS.bulkCreate, { rows })

/** Normal Bulk Claim: save the per-platform template the operator fills. */
export const bulkSheetTemplate = (spec: BulkTemplateSpec): Promise<Result<{ path: string }>> =>
  invoke<{ path: string }>(CLAIM_CREATE_CHANNELS.bulkSheetTemplate, spec)

/** Increff Bulk Claim: save a blank QC report with the columns the backend reads. */
export const bulkIncreffTemplate = (): Promise<Result<{ path: string }>> =>
  invoke<{ path: string }>(CLAIM_CREATE_CHANNELS.bulkIncreffTemplate)

/** Increff Bulk Claim: save the Success / Failed results as an .xlsx. */
export const bulkIncreffResults = (results: IncreffResultsExport): Promise<Result<{ path: string }>> =>
  invoke<{ path: string }>(CLAIM_CREATE_CHANNELS.bulkIncreffResults, results)

/**
 * Normal Bulk Claim: read a filled template — the dropped file when there is
 * one, otherwise through an open dialog in the main process.
 */
export const bulkSheetRead = async (file?: File): Promise<Result<BulkWorkbook>> =>
  invoke<BulkWorkbook>(
    CLAIM_CREATE_CHANNELS.bulkSheetRead,
    file ? { file: await toTransferFile(file) } : {}
  )

/**
 * Normal Bulk Claim: fill the blanks on one platform's rows — the local report
 * backup first, then the marketplace. Writes nothing.
 */
export const bulkRefill = (request: BulkRefillRequest): Promise<Result<BulkRefillResult[]>> =>
  invoke<BulkRefillResult[]>(CLAIM_CREATE_CHANNELS.bulkRefill, request)

/** Row-by-row progress of `bulkRefill`. Returns the unsubscribe. */
export const onBulkRefillProgress = (listener: (progress: BulkRefillProgress) => void): (() => void) =>
  subscribe(CLAIM_CREATE_EVENTS.bulkRefillProgress, payload => listener(payload as BulkRefillProgress))

/** Removes a stored file, when an operator clears a slot they had filled. */
export const deleteClaimFile = (fileKey: string): Promise<Result<unknown>> =>
  invoke<unknown>(CLAIM_CREATE_CHANNELS.deleteFile, { fileKey })

export const updateClaim = (payload: Record<string, unknown>): Promise<Result<unknown>> =>
  invoke<unknown>(CLAIM_CREATE_CHANNELS.update, payload)
