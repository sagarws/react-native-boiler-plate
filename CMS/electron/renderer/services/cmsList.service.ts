import { CMS_LIST_CHANNELS, CMS_LIST_EVENTS } from '@shared/constants/channels'
import type {
  BulkFieldOption,
  BulkUpdateResult,
  CmsDriveStatusEvent,
  CmsCounts,
  CmsListPage,
  CmsListQuery,
  TicketUpdateInput,
  TicketUpdateResult
} from '@shared/types/cmsList'
import type { ClaimExportResult } from '@shared/types/claimExport'
import type { Result } from '@shared/types/result'
import { invoke, subscribe } from './ipcClient'

/** Renderer-side wrapper over the live CMS list channels. */

export const listCms = (query: CmsListQuery): Promise<Result<CmsListPage>> =>
  invoke<CmsListPage>(CMS_LIST_CHANNELS.list, query)

/** Counts must cover the SAME window as the list, or the tabs promise rows the table cannot show. */
export const cmsCounts = (query: CmsListQuery): Promise<Result<CmsCounts>> =>
  invoke<CmsCounts>(CMS_LIST_CHANNELS.counts, query)

/** The fields the server will set in bulk, and their vocabularies. */
export const bulkFieldOptions = (): Promise<Result<BulkFieldOption[]>> =>
  invoke<BulkFieldOption[]>(CMS_LIST_CHANNELS.bulkFields)

/**
 * Sets one field to one value on every selected claim.
 *
 * `field` is an allowlist KEY, not a document path — the server decides what it
 * writes, and refuses a key it does not know.
 */
export const bulkUpdateClaims = (
  cmsIds: string[],
  field: string,
  value: string
): Promise<Result<BulkUpdateResult>> =>
  invoke<BulkUpdateResult>(CMS_LIST_CHANNELS.bulkUpdate, { cmsIds, field, value })

/** Adds or corrects one claim's ticket number; the server moves it to In Review. */
export const updateClaimTicket = (input: TicketUpdateInput): Promise<Result<TicketUpdateResult>> =>
  invoke<TicketUpdateResult>(CMS_LIST_CHANNELS.updateTicket, input)

/** An AJIO claim's Drive conversion settled. Returns the unsubscribe. */
export const onDriveStatus = (listener: (event: CmsDriveStatusEvent) => void): (() => void) =>
  subscribe(CMS_LIST_EVENTS.driveStatus, payload => listener(payload as CmsDriveStatusEvent))

/** Re-queues one AJIO claim's failed Drive conversion; the server flips it to "pending". */
export const retryDriveConversion = (cmsId: string): Promise<Result<{ cmsId: string }>> =>
  invoke<{ cmsId: string }>(CMS_LIST_CHANNELS.retryDrive, { cmsId })

/**
 * Writes the claims on screen to an .xlsx the operator saves.
 *
 * `query` is the one that loaded the page and `ids` the rows still showing
 * after local filters; the main process refetches the page and keeps those.
 */
export const exportClaimsXlsx = (
  query: CmsListQuery,
  ids: string[],
  /** Every page the rows came from; defaults to the query's own. */
  pages?: number[]
): Promise<Result<ClaimExportResult>> =>
  invoke<ClaimExportResult>(CMS_LIST_CHANNELS.exportXlsx, { query, ids, pages })
