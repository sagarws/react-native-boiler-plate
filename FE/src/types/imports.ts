/** Types copied from TrackVid-FE `slices/importsSlice.ts`, `slices/whatsappNumberSlice.ts` and the import dialogs. */

export interface ExternalOrder {
  _id: string;
  id?: string;
  userId: string;
  companyId: string;
  fileKey: string;
  return_awb: string;
  forward_awb: string;
  forward_video_link: string;
  return_video_link: string;
  import_platform: string;
  import_type: "forward" | "return";
  createdAt: string;
  updatedAt: string;
  __v: number;
}

export interface ExternalOrdersPayload {
  page: string;
  limit: string;
  searchInput?: string;
  import_platform?: string;
}

export interface ExternalOrdersResponse {
  orders: ExternalOrder[];
  metadata: {
    limit: number;
    page: number;
    total: number;
    totalPage: number;
  };
}

/** Result of any mocked file import (parse → queue → process). */
export interface ImportJobSummary {
  jobId: string;
  message: string;
  fileName: string;
  totalRecords: number;
  inserted: number;
  updated: number;
  failed: number;
  /** TrackVid returns HTTP 202 when another import is still running. */
  queued: boolean;
  errors: string[];
}

/** WhatsApp upload `data`; match fields are optional (older BEs / matchChecked false). */
export interface WhatsAppNumberUploadResult extends ImportJobSummary {
  matchChecked?: boolean;
  matchedRecords?: number;
  unmatchedRecords?: number;
  unmatchedIdentifiers?: string[];
}

export interface RetryAllD2CResponse {
  message: string;
  queued: number;
  remainingAfterBatch: number;
}

/** Values of the "Select Data Type" autocomplete on the imports page (same strings as TrackVid). */
export type ImportDataType =
  | "Master Data"
  | "Forward and Return AWB linking"
  | 'Change status from "Return Created" to "Return-Delivered"'
  | "SKU Data"
  | "Order Data"
  | "Customer WhatsApp Number Data";
