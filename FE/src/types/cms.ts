/**
 * CMS (Manage SPF Claims) types. Field names follow TrackVid-FE `helper/types/types.ts` (ICms, ProductClaim,
 * IClaimHistory), `api/cms-service.ts` payloads and the CMS modals.
 */

/** Response body shape TrackVid's BE returns (`{ isSuccess, displayMessage, data }`). */
export interface ApiBody<T> {
  isSuccess: boolean;
  displayMessage: string;
  data: T;
}

export interface FileMetadata {
  fileKey: string;
  createdAt?: string;
  /** Xbees packing images carry an explicit side tag. */
  side?: string;
}

export interface IEmailTemplate {
  body: string;
  subject: string;
  _id: string;
}

export type ScriptProcessingStatus = "Not Started" | "Queued" | "Running" | "Success" | "Failed" | "Help Center Failed" | "Completed";
export type ProcessingMode = "automated" | "manual" | "desktop";
export type DriveStatus = "pending" | "uploaded" | "failed";

export interface MyntraClaimDetails {
  shippingLabelImage?: FileMetadata | null;
  packingImages?: (FileMetadata | null)[] | null;
  damagedProductVideo?: FileMetadata | null;
  damagedProductVideoLink?: string;
  username?: string;
  disputedAmount?: number | string;
  physicalReceivedSku?: string;
}

export interface NykaaClaimDetails {
  vendorCode?: string;
  skuId?: string;
  returnType?: "RTO" | "DTO" | "REPL";
  username?: string;
}

/** Shared bundle used by Amazon / Flipkart / Tata CliQ / Delhivery / Xbees. */
export interface OtherClaimDetails {
  username?: string;
  shippingLabelImage?: FileMetadata | null;
  packingImages?: (FileMetadata | string | null)[] | null;
  contentsOfReturnImages?: (FileMetadata | string | null)[] | null;
  serialNumberImage?: FileMetadata | null;
  fulfillmentChannel?: string;
  claimArea?: string;
  domestic?: string;
  disputeAmount?: string;
  parentSelection?: string;
}

export interface AdditionalField {
  key: string;
  value: string;
  _id: string;
}

/** One SPF claim row as the list endpoint returns it (ICms + ProductClaim fields CMS.tsx reads). */
export interface ICms {
  _id: string;
  eCommercePlatform: string;
  AWBNumber: string;
  forwardAWB?: string;
  subOrderNumber?: string;
  customerOrderNumber?: string;
  seller_sku?: string;
  pobid?: string;
  ticketNumber?: string;
  typeOfClaim?: string;
  returnDeliveryDate?: string;
  forwardOrderDate?: string;
  remark?: string;
  status: string;
  rejectReason?: string;
  compensationAmount?: number | null;
  createdAt: string;
  history: string;
  feedId?: string;
  feed?: { name: string } | null;
  order_Brand?: string;
  accountType?: string;
  emailTemplate?: IEmailTemplate;
  scriptProcessingStatus?: ScriptProcessingStatus;
  scriptProcessingError?: string | null;
  processCount?: number;
  processingMode?: ProcessingMode;
  driveStatus?: DriveStatus;
  driveError?: string;
  spfClaimTatPeriod?: number;
  ajio_account_email?: string;
  meesho_account_email?: string;
  snapdeal_account_username?: string;
  myntraClaimDetails?: MyntraClaimDetails | null;
  nykaaClaimDetails?: NykaaClaimDetails | null;
  otherClaimDetails?: OtherClaimDetails | null;
  packetId?: string;
  stateOfThePacket?: string | number;
  returnVideoLink?: string;
  forwardVideoLink?: string;
  additionalFields?: AdditionalField[];
  sixSideImages?: FileMetadata | null;
  returnProductImage?: FileMetadata | null;
  forwardSentProductImage?: FileMetadata | null;
  podProof?: FileMetadata | null;
  barcodeImage?: FileMetadata | null;
  receivedProductImage_1?: FileMetadata | null;
  receivedProductImage_2?: FileMetadata | null;
  receivedProductImage_3?: FileMetadata | null;
  reverseWayBillImage?: FileMetadata | null;
  outerPackageImage_1?: FileMetadata | null;
  outerPackageImage_2?: FileMetadata | null;
  innerPackageImage_1?: FileMetadata | null;
  innerPackageImage_2?: FileMetadata | null;
  productImage_1?: FileMetadata | null;
  productImage_2?: FileMetadata | null;
  podImage_1?: FileMetadata | null;
  podImage_2?: FileMetadata | null;
}

export interface IMetadata {
  total: number;
  page: number;
  limit: number;
}

/** POST /cms body (same keys as CMS.tsx `fetchData`). Dates are `yyyy-MM-dd`. */
export interface CmsListPayload {
  page: number;
  limit: number;
  search: string;
  startDate: string;
  endDate: string;
  feedId: string[];
  brand: string[];
  eCommercePlatform: string[];
  username: string;
  /** "" = every status ("All" tab). */
  status: string;
  /** Counts only: the company's non-named platforms that make up the "Other" bucket. */
  otherPlatforms?: string[];
}

export interface CmsListData {
  cms: ICms[];
  metadata: IMetadata;
}

export interface CmsListResponse extends ApiBody<CmsListData> {
  filters: { brand: string[]; usernames: string[] };
}

export interface CmsCounts {
  statusCounts: Record<string, number>;
  platformCounts: Record<string, number>;
}

export interface CmsExportPayload extends Omit<CmsListPayload, "brand" | "otherPlatforms"> {
  selectedClaims: string[];
}

export interface RunReturnScriptPayload {
  ids: string[];
  accountType?: string;
  overrideRetryLimit?: boolean;
}

export interface RunReturnScriptData {
  jobId?: string;
  status?: "queued" | "active";
  queuePosition?: number;
  totalInQueue?: number;
  existing?: boolean;
  routedToDesktop?: number;
  drivePending?: boolean;
}

export interface EditTicketPayload {
  _id: string;
  ticket: string;
}

export interface UpdateCmsStatusPayload {
  _id: string;
  status: string;
  reason?: string;
}

export interface ChangeCmsStatusPayload {
  ids: string[];
  status: string;
}

/** POST /cms/updateCMS. Known keys from the edit modal + `/cms/update`; the create form may send more. */
export interface UpdateCmsPayload {
  cmsId: string;
  eCommercePlatform?: string;
  username?: string;
  clearUsername?: boolean;
  AWBNumber?: string;
  forwardAWB?: string;
  subOrderNumber?: string;
  ticketNumber?: string;
  typeOfClaim?: string;
  disputedAmount?: number;
  physicalReceivedSku?: string;
  disputeAmount?: string;
  domestic?: string;
  skuName?: string;
  pobId?: string;
  sixSideImages?: string;
  remark?: string;
  [extra: string]: unknown;
}

export interface BulkStatusResult {
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

// ----- Master Sync -----
export type MasterSyncField = "forwardAWB" | "skuName" | "pobId";

export interface MasterSyncCandidateRow {
  cmsId: string;
  eligible: boolean;
  reason?: string;
  AWBNumber?: string;
  forwardAWB?: string;
  seller_sku?: string;
  pobid?: string;
  status?: string;
  eCommercePlatform?: string;
  missing?: Record<MasterSyncField, boolean>;
  candidates?: Record<MasterSyncField, string[]>;
}

export interface MasterSyncApplyPayload {
  cmsId: string;
  forwardAWB?: string;
  skuName?: string;
  pobId?: string;
}

export interface MasterSyncApplyData {
  cmsId: string;
  applied: Partial<Record<MasterSyncField, string>>;
  skipped: { field: string; reason: string }[];
  forwardAWB: string;
  seller_sku: string;
  pobid: string;
}

// ----- AJIO SKU + POB sync -----
export type AjioSyncOutcome = "filled" | "choose_sku" | "differs" | "not_claimable" | "not_found" | "error";

export interface AjioArticle {
  returnItemId: string;
  sku: string;
  identifiers: string[];
  productName: string;
  color: string;
  imageUrl: string;
  quantity: number;
}

export interface AjioSyncRow {
  cmsId: string;
  awb: string;
  outcome: AjioSyncOutcome;
  pobId: string;
  storeName: string;
  returnOrderId?: string;
  currentPobId: string;
  currentSku: string;
  articles: AjioArticle[];
  resolvedSku?: string;
  selectedReturnItemId?: string;
  skuUnchanged?: boolean;
  reason?: string;
  account?: string;
  credentialId?: string;
}

export interface AjioSyncPayload {
  credentialId: string;
  ids: string[];
  budgetMs?: number;
}

export interface AjioSyncData {
  username: string;
  results: AjioSyncRow[];
  unresolved: { cmsId: string }[];
  skipped: { cmsId: string; reason: string }[];
  partial: boolean;
}

export interface AjioApplyPayload {
  credentialId: string;
  updates: { cmsId: string; pobId?: string; skuName?: string; overwrite?: boolean }[];
}

export interface AjioApplyData {
  wrote: number;
  failed: { cmsId: string; reason: string }[];
}

// ----- Company credentials / sessions (Integrations uses these) -----
/** Mirrors TrackVid-FE `components/Integrations/sessionState.ts` CredentialSession. */
export interface CredentialSession {
  savedAt?: string | null;
  expiresAt?: string | null;
  ip?: string | null;
  source?: string | null;
  cookieNames?: string[];
  /** AJIO only: the seller's activeSellerProfileId. */
  userId?: string | null;
  /** AJIO only: how many POB IDs the login resolved. */
  pobCount?: number;
}

export type CredentialProvider = "ajio" | "meesho" | "snapdeal" | "myntra" | "nykaa" | "flipkart" | "delhivery" | "xbees" | "tatacliq";

export interface CompanyCredential {
  credentialId: string;
  username: string;
  is_verified: boolean;
  ajioSession?: CredentialSession | null;
  meeshoSession?: CredentialSession | null;
  snapdealSession?: CredentialSession | null;
  myntraSession?: CredentialSession | null;
  nykaaSession?: CredentialSession | null;
  flipkartSession?: CredentialSession | null;
  delhiverySession?: CredentialSession | null;
  xbeesSession?: CredentialSession | null;
}

export type CompanyCredentials = Partial<Record<CredentialProvider, CompanyCredential[]>>;

/** Per-provider key the credentials endpoint nests the session under (TrackVid SESSION_KEY_BY_PROVIDER). */
export const SESSION_KEY_BY_PROVIDER: Partial<Record<CredentialProvider, keyof CompanyCredential>> = {
  ajio: "ajioSession",
  meesho: "meeshoSession",
  snapdeal: "snapdealSession",
  myntra: "myntraSession",
  nykaa: "nykaaSession",
  flipkart: "flipkartSession",
  delhivery: "delhiverySession",
  xbees: "xbeesSession",
};

export interface RenewSessionPayload {
  platform: string;
  credentialId: string;
}

// ----- Claim history -----
export interface IHistory {
  _id: string;
  action_type: number;
  date: string;
  description: string;
  user?: { _id: string; name: { fullName: string }; email: string } | null;
  feed?: { _id: string; feedName: string } | null;
}

export interface IClaimHistory {
  _id: string;
  claimId: string;
  history: IHistory[];
  createdAt: string;
  updatedAt: string;
}

export interface IHistoryData extends IClaimHistory {
  returnAWB: string;
  forwardAWB: string;
}
