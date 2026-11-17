/** RMS (TrackVid `pages/RMS.tsx`) types. Master order rows themselves are `MasterOrder` from `@/types/master-data`. */

/** Body TrackVid builds in `handleRunClaim`. */
export interface RmsTriggerPayload {
  ids?: string[];
  order_status?: string;
  startDate?: string;
  endDate?: string;
  searchInput?: string;
  import_platform?: string;
  status?: string;
  orderCondition?: number;
  return_order_Carrier?: string;
  return_order_type?: string;
  order_Carrier?: string;
  order_Brand?: string;
  order_Seller_Name?: string;
}

export interface RmsClaimJob {
  jobId: string;
  totalRecords: number;
  displayMessage: string;
}

export type RmsClaimOutcome = { ok: true; ticket: string } | { ok: false; error: string };

/** `bulkResult` state of RMS.tsx (Return Dispute bulk status update). */
export interface RmsBulkResult {
  marketplace: string;
  totalRows: number;
  scannedRows?: number;
  ignoredCount?: number;
  updatedCount: number;
  skippedCount: number;
  notFoundCount: number;
  updated: { rowNumber: number; ticketId: string; newStatus: string }[];
  skipped: { rowNumber: number; ticketId: string; reason: string }[];
  notFound: { rowNumber: number; ticketId: string }[];
}

/** RMS.tsx `filterOptions` (column filters; "Null" matches empty values). */
export interface RmsFilterOptions {
  parcelCondition: string;
  return_order_Carrier: string;
  carrier: string;
  importPlatForm: string;
  returnOrderType: string;
  brand: string;
  sellerName: string;
  claimStatus: string;
}
