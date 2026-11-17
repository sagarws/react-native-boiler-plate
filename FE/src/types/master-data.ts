/** Types copied from TrackVid-FE `slices/masterSlice.ts`, `helper/types/types.ts` (IFilter) and `container/*MasterData/types.ts`. */

export interface MasterOrder {
  _id: string;
  id?: string;
  order_no: string;
  companyId: string;
  fileKey: string;
  userId: string;
  order_date: string;
  order_status: string;
  order_jioCode: number | null;
  order_seller_style_code: string;
  order_seller_SKU: string;
  order_FWD_Shipment_ID: string;
  order_Carrier: string;
  order_FWD_AWB_no: string;
  order_Brand: string;
  order_Seller_Name: string;
  import_platform: string;
  ajio_account_email: string;
  isDeleted: boolean;
  isFavorite: boolean;
  is_imported: boolean;
  return_order_AWB_no: string;
  return_order_Carrier: string;
  return_order_date: string;
  return_order_no: string;
  return_order_reason: string;
  return_order_type: string;
  return_jioCode: number | null;
  return_quantity: number | null;
  return_shipment_id: string;
  tpl_delivery_status: string;
  return_fwd_carrier_name: string;
  return_brand: string;
  return_delivered_date: string;
  fwd_seller_order_no: string;
  order_quantity: number | null;
  /** 1 = GOOD, 2 = BAD, missing = not scanned. */
  orderCondition: number | null;
  is_m_not_delivered: boolean | null;
  good_quantity: number | null;
  bad_quantity: number | null;
  /** Claim status (Pending / In Review / Approved / Rejected). */
  status: string;
  ticketNumber: string;
  rejectReason: string;
  POB_ID: string;
  forward_video_link: string;
  return_video_link: string;
  /** History document id (claim history). */
  history: string;
  // D2C WhatsApp fields — populated only on D2C MasterImport rows.
  // messageSent: true = sent, false = failed (retry available), missing = never attempted.
  messageSent?: boolean;
  cust_whatsapp_number?: string;
  cust_name?: string;
  createdAt: string;
  updatedAt: string;
  __v: number;
}

/** `IFilter` from TrackVid `helper/types/types.ts` (distinct values per filterable column). */
export interface IFilter {
  orderStatus: string[];
  return_order_Carrier: string[];
  claimStatus: string[];
  importPlatForm: string[];
  returnOrderType: string[];
  brand: string[];
  carrier: string[];
  sellerName: string[];
  parcelCondition: string[];
}

export type MasterFilterKey = keyof IFilter;

export interface ListMetadata {
  limit: number;
  page: number;
  total: number;
  totalPage: number;
  /** Set when the server capped an "all rows" request. */
  limitCapped?: boolean;
}

export interface MasterImportResponse {
  order: MasterOrder[];
  metadata: ListMetadata;
  filters: IFilter;
}

/** Body of `/master/fillMasterImportOrderReports`. "Null" filters rows where the field is empty. */
export interface MasterOrderReportPayload {
  startDate?: string | Date;
  endDate?: string | Date;
  limit: number;
  page: number;
  searchInput: string;
  status?: string;
  import_platform?: string;
  order_status?: string;
  orderCondition?: number | string;
  order_Carrier?: string;
  return_order_Carrier?: string;
  return_order_type?: string;
  order_Brand?: string;
  order_Seller_Name?: string;
  sortField?: string;
  sortOrder?: "asc" | "desc";
}

export interface MasterExportPayload {
  selectedOrders: string[];
  page: number;
  limit: number;
  searchInput: string;
  startDate: string | Date;
  endDate: string | Date;
  import_platform: string;
  order_status: string;
  status: string;
}

/** TrackVid returns `{ fileUrl }`; the mock builds the sheet locally, so it returns the CSV text too. */
export interface MasterExportResponse {
  fileUrl: string | null;
  fileName: string;
  csv: string;
  count: number;
}

export interface MasterStatusPayload {
  _id: string;
  status: string;
  reason?: string;
}

export interface MasterTicketPayload {
  _id: string;
  ticket: string;
}

/** `{ displayMessage, isSuccess }` shape used by the master status / ticket middlewares. */
export interface DisplayMessageResponse {
  displayMessage: string;
}

export interface MasterHistoryEvent {
  _id: string;
  date: string;
  description: string;
  action_type: "IMPORT" | "SCAN" | "STATUS" | "TICKET" | "CLAIM";
  by: string;
}

export interface MasterHistory {
  _id: string;
  claimId: string;
  history: MasterHistoryEvent[];
  createdAt: string;
  updatedAt: string;
}

export interface IMasterHistoryData extends MasterHistory {
  returnAWB: string;
  forwardAWB: string;
}

// ---------- platform masters (container/*MasterData/types.ts) ----------

export interface MeeshoOrder {
  _id: string;
  id?: string;
  companyId: string;
  subOrderNo: string;
  orderDate: string;
  skuForward: string;
  quantityForward: number;
  packetId: string;
  skuReturn: string;
  orderNumber: string;
  qtyReturn: number;
  returnCreatedDate: string;
  typeOfReturn: string;
  returnAwbNo: string;
  supplierEmailId: string;
  import_platform: string;
  forwardFileKey?: string;
  returnFileKey?: string;
  is_imported?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface MeeshoListPayload {
  searchInput: string;
  startDate?: string;
  endDate?: string;
  typeOfReturn?: string;
  supplierEmailId?: string;
  limit: number;
  page: number;
}

export interface MeeshoListFilters {
  typeOfReturn: string[];
  supplierEmailId: string[];
}

export interface PlatformListResponse<T, F> {
  metadata: ListMetadata;
  order: T[];
  filters: F;
}

export type MeeshoListResponse = PlatformListResponse<MeeshoOrder, MeeshoListFilters>;

export interface SnapdealOrder {
  _id: string;
  id?: string;
  companyId: string;
  subOrderNo: string;
  orderCode: string;
  orderCreatedDate: string;
  skuCode: string;
  packageId: string;
  referenceCode: string;
  forwardAwbNo: string;
  returnAwbNo: string;
  returnInitiatedOn: string;
  returnDeliveredOn: string | null;
  reverseCourierCode: string;
  shippingProvider: string;
  status: string;
  snapdeal_account_username: string;
  fileKey: string;
  import_platform: string;
  is_imported?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SnapdealListPayload {
  searchInput: string;
  startDate?: string;
  endDate?: string;
  status?: string;
  snapdeal_account_username?: string;
  limit: number;
  page: number;
}

export interface SnapdealListFilters {
  status: string[];
  snapdeal_account_username: string[];
}

export type SnapdealListResponse = PlatformListResponse<SnapdealOrder, SnapdealListFilters>;

export interface MyntraOrder {
  _id: string;
  id?: string;
  companyId: string;
  returnTrackingNumber: string;
  forwardTrackingNumber: string;
  orderDeliveredDate: string | null;
  returnCreatedDate: string | null;
  status: string;
  skuId: string;
  model: string;
  myntra_account_username: string;
  fileKey: string;
  import_platform: string;
  is_imported?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface MyntraListPayload {
  searchInput: string;
  startDate?: string;
  endDate?: string;
  status?: string;
  myntra_account_username?: string;
  limit: number;
  page: number;
}

export interface MyntraListFilters {
  status: string[];
  myntra_account_username: string[];
}

export type MyntraListResponse = PlatformListResponse<MyntraOrder, MyntraListFilters>;

// ---------- scan return parcel ----------

export interface ScanReturnParcelPayload {
  awbNumber: string;
  /** 1 = good, 2 = bad. */
  parcelCondition: 1 | 2;
}

export interface ScanReturnParcelResponse {
  isSuccess: boolean;
  message: string;
  data: { matched?: boolean; staged?: boolean } | null;
}

export interface ScanParcelNotificationPayload {
  failedParcels: string[];
  successParcels: string[];
  parcelCondition: "good" | "bad";
}

export interface ScannedParcelOrders {
  notificationId: string;
  parcelCondition: "good" | "bad";
  failedOrders: string[];
  successfulOrders: string[];
  createdAt: string;
}

export interface BulkStatusUpdateResult {
  total: number;
  updated: number;
  notFound: string[];
  skipped: number;
}

export interface TriggerClaimResponse {
  message: string;
  displayMessage: string;
  data: { queued: number } | null;
}
