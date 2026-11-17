/**
 * CMS create / update types. Field names follow TrackVid-FE `helper/types/cms-create.types.ts`,
 * `api/cms-create-service.ts`, `api/cms-autofetch-service.ts` and `components/Cms/create/BulkClaimModal.tsx`.
 *
 * `ICmsCreate` is TrackVid's `ICms` (the create form values). It is renamed here because `@/types/cms` already
 * exports the list row as `ICms`.
 */

export interface INykaaClaimDetails {
  vendorCode: string;
  skuId: string;
  returnType: "" | "RTO" | "DTO" | "REPL";
  username?: string;
}

export const NYKAA_INITIAL_CLAIM_DETAILS: INykaaClaimDetails = { vendorCode: "", skuId: "", returnType: "", username: "" };

export interface IMyntraClaimDetails {
  shippingLabelImage: string;
  packingImages: string[];
  damagedProductVideo: string;
  damagedProductVideoLink: string;
  disputedAmount?: string;
  physicalReceivedSku?: string;
  username?: string;
}

export const MYNTRA_INITIAL_CLAIM_DETAILS: IMyntraClaimDetails = {
  shippingLabelImage: "",
  packingImages: [],
  damagedProductVideo: "",
  damagedProductVideoLink: "",
  disputedAmount: "",
  physicalReceivedSku: "",
  username: "",
};

export const AMAZON_FULFILLMENT_CHANNEL_OPTIONS = ["Easy Ship/ Self Ship/ Seller Flex", "Fee related disputes"] as const;
export const FLIPKART_CLAIM_AREA_OPTIONS = ["Issue(s) with a received return packet", "Did not receive a return packet"] as const;
/** Delhivery routes every claim through this one shipment issue (rendered disabled, still persisted). */
export const DELHIVERY_SHIPMENT_ISSUE = "Damage / Missing / Mismatch";
export const DELHIVERY_SUBCATEGORY_OPTIONS = [
  "Damage in delivered/returned shipment",
  "Missing shipment delivered/returned",
  "Mismatch in delivered/returned shipment",
] as const;
export const DELHIVERY_DOMESTIC_OPTIONS = ["EXPRESS", "SURFACE"] as const;

export const PACKING_SIDES = ["top", "right", "bottom", "left"] as const;
export type PackingSide = (typeof PACKING_SIDES)[number];

/** Xbees positional package photo: each slot carries its own side. */
export interface XbeesPackingImage {
  fileKey: string;
  side: PackingSide;
}

/** Shared bundle for Flipkart / Tata CliQ / Delhivery / Amazon / Xbees / Shopify. */
export interface IOtherClaimDetails {
  parentSelection: string;
  claimArea: string;
  shipmentIssue: string;
  subcategory: string;
  domestic: string;
  shippingLabelImage: string;
  /** Flipkart / Tata CliQ / Delhivery: `string[]`. Xbees: `XbeesPackingImage[]`. */
  packingImages: string[] | XbeesPackingImage[];
  fulfillmentChannel: string;
  contentsOfReturnImages: string[];
  serialNumberImage: string;
  disputeAmount: string;
  username?: string;
  /** Tata CliQ QC Fail: reason code ("06", "10" …), the Wrong Product sub-reason, the six named slots, video URLs. */
  qcReason?: string;
  qcSubReason?: string;
  qcImages?: Record<string, string>;
  packagingVideoUrl?: string;
  unboxingVideoUrl?: string;
}

export const OTHER_INITIAL_CLAIM_DETAILS: IOtherClaimDetails = {
  parentSelection: "",
  claimArea: "",
  shipmentIssue: "",
  subcategory: "",
  domestic: "",
  shippingLabelImage: "",
  packingImages: [],
  qcReason: "",
  qcSubReason: "",
  qcImages: {},
  packagingVideoUrl: "",
  unboxingVideoUrl: "",
  fulfillmentChannel: "",
  contentsOfReturnImages: [],
  serialNumberImage: "",
  disputeAmount: "",
  username: "",
};

/** TrackVid `ICms` — the create / update form values. */
export interface ICmsCreate {
  eCommercePlatform: string;
  AWBNumber: string;
  typeOfClaim: string;
  costOfMissingArticle?: string;
  customerOrderNumber?: string;
  returnOrderId?: string;
  forwardAWB?: string;
  remark?: string;
  skuName?: string;
  /** AJIO POB ID (optional at create time). */
  pobId?: string;
  returnVideo?: string;
  returnVideoLink?: string;
  forwardVideo?: string;
  forwardVideoLink?: string;
  returnProductImage: string;
  forwardSentProductImage?: string;
  sideImages?: string;
  podProof?: string;
  eitherVideoOrLink?: string;
  additionalFieldTitle: string;
  additionalFieldValue: string;
  myntraClaimDetails?: IMyntraClaimDetails;
  nykaaClaimDetails?: INykaaClaimDetails;
  otherClaimDetails?: IOtherClaimDetails;
  subOrderNumber?: string;
  packetId?: string;
  stateOfThePacket?: string;
  barcodeImage?: string;
  receivedProductImage_1?: string;
  reverseWayBillImage?: string;
  logisticsPartnerName?: string;
  typeOfClaimName?: string;
  ajio_account_email?: string;
  meesho_account_email?: string;
  snapdeal_account_username?: string;
  outerPackageImage_1?: string;
  outerPackageImage_2?: string;
  innerPackageImage_1?: string;
  innerPackageImage_2?: string;
  productImage_1?: string;
  productImage_2?: string;
  podImage_1?: string;
  podImage_2?: string;
}

export interface IECommercePlatformClaim {
  _id?: string;
  name: string;
  description: string;
  key?: string;
  isDisable?: boolean;
  parentSelection?: string;
}

export interface IECommercePlatform {
  _id: string;
  name: string;
  typeOfClaims: IECommercePlatformClaim[];
}

// ----- api/cms-create-service.ts -----

export interface UploadImageData {
  key: string;
  url: string;
}

export interface StoreVideoData {
  _id: string;
  key: string;
  url: string;
}

export interface AutomationPlatformsData {
  platforms: string[];
}

export interface CreateCmsBody {
  isSuccess: boolean;
  displayMessage: string;
  data: { _id: string; AWBNumber: string; eCommercePlatform: string };
  /** Present when the request asked for `autoClaim`. `dispatched: false` = saved, not filed. */
  autoClaim?: { requested: boolean; dispatched: boolean; jobId?: string; reason?: string };
}

// ----- api/cms-autofetch-service.ts -----

export type OrderType = "Return" | "Forward";

export interface OrderLookupItem {
  return_video_link?: string;
  forward_video_link?: string;
  return_awb?: string;
  forward_awb?: string;
  customerOrderNumber?: string;
}

export interface OrderLookupRecord {
  _id: string;
  sku: string;
  returnAwb?: string;
  forwardAwb?: string;
  orderNo?: string;
  pobId?: string;
}

export interface OrderLookupResponse {
  data: OrderLookupItem[];
  skus?: string[];
  records?: OrderLookupRecord[];
}

export interface OrderScreenshotsResponse {
  isSuccess: boolean;
  data: string[];
}

export interface ProductSkuMapResponse {
  isSuccess: boolean;
  data: { awb: string; skus: string[] };
}

export interface MeeshoOrderInfo {
  subOrderNo?: string;
  returnAwbNo?: string;
  forwardAwbNo?: string;
  courierPartner?: string;
}

export interface SnapdealOrderInfo {
  subOrderNo?: string;
  returnAwbNo?: string;
  forwardAwbNo?: string;
}

export interface MyntraOrderInfo {
  returnTrackingNumber?: string;
  forwardTrackingNumber?: string;
  returnVideoLink?: string;
  forwardVideoLink?: string;
}

export interface MasterInfoResponse<T> {
  isSuccess: boolean;
  displayMessage?: string;
  data: T | null;
}

/** BE `withUrl` image shape. */
export interface StoredFile {
  fileKey?: string;
  url?: string;
}

export interface ExistingMyntraDetails {
  shippingLabelImage?: StoredFile | null;
  packingImages?: (StoredFile | null)[];
  damagedProductVideo?: StoredFile | null;
  damagedProductVideoLink?: string;
  disputedAmount?: string;
  physicalReceivedSku?: string;
  username?: string;
}

export interface ExistingOtherDetails {
  parentSelection?: string;
  claimArea?: string;
  shipmentIssue?: string;
  subcategory?: string;
  domestic?: string;
  shippingLabelImage?: StoredFile | null;
  packingImages?: (StoredFile | null)[];
  contentsOfReturnImages?: (StoredFile | null)[];
  serialNumberImage?: StoredFile | null;
  fulfillmentChannel?: string;
  disputeAmount?: string;
  username?: string;
  qcReason?: string;
  qcSubReason?: string;
  qcImages?: Record<string, StoredFile | string>;
  packagingVideoUrl?: string;
  unboxingVideoUrl?: string;
}

/** Shape of the BE `findCmsByAwb` payload. */
export interface ExistingCmsPreview {
  _id: string;
  eCommercePlatform: string;
  AWBNumber: string;
  typeOfClaim: string;
  forwardAWB: string;
  customerOrderNumber: string;
  remark: string;
  status: string;
  ticketNumber: string;
  returnVideoLink: string;
  forwardVideoLink: string;
  returnProductImage: string;
  forwardSentProductImage: string;
  sixSideImages: string;
  podProof: string;
  myntraClaimDetails: ExistingMyntraDetails | null;
  nykaaClaimDetails: Partial<INykaaClaimDetails> | null;
  otherClaimDetails: ExistingOtherDetails | null;
  barcodeImage?: StoredFile | null;
  receivedProductImage_1?: StoredFile | null;
  reverseWayBillImage?: StoredFile | null;
  outerPackageImage_1?: StoredFile | null;
  outerPackageImage_2?: StoredFile | null;
  innerPackageImage_1?: StoredFile | null;
  innerPackageImage_2?: StoredFile | null;
  productImage_1?: StoredFile | null;
  productImage_2?: StoredFile | null;
  podImage_1?: StoredFile | null;
  podImage_2?: StoredFile | null;
  subOrderNumber: string;
  packetId: string;
  logisticsPartnerName: string;
  stateOfThePacket?: string;
  costOfMissingArticle?: number | string;
  createdAt: string | null;
  updatedAt: string | null;
  ajio_account_email?: string;
  meesho_account_email?: string;
  snapdeal_account_username?: string;
  pobid?: string;
  skuName?: string;
}

export interface FindCmsByAwbResponse {
  isSuccess: boolean;
  data: ExistingCmsPreview | null;
  displayMessage?: string;
}

export interface AccountByAwbResponse {
  isSuccess: boolean;
  data: { account: string | null } | null;
  displayMessage?: string;
}

// ----- Bulk claim (Increff QC report) -----

export interface BulkClaimVmsRow {
  _id: string;
  awbNo: string;
  eCommercePlatform: string;
  orderType: string;
  orderCondition?: number;
  createdAt?: string;
}

export interface BulkClaimCsvRow {
  rowNumber: number;
  returnOrderType: string;
  salesChannel: string;
  returnGateEntryAwb: string;
  qcReason: string;
  clientSkuIdEan: string;
  forwardAwbNumber: string;
  forwardUnitBasePrice: string;
}

export interface BulkClaimCheckResponse {
  totalRows: number;
  matchedCount: number;
  unmatchedCount: number;
  matched: { csvRow: BulkClaimCsvRow; vmsList: BulkClaimVmsRow[] }[];
  unmatched: { csvRow: BulkClaimCsvRow; reason: string }[];
  skippedByPlatform?: number;
}

export interface BulkClaimVerifyPayloadRow {
  rowNumber: number;
  returnGateEntryAwb: string;
  qcReason: string;
  salesChannel: string;
  vmsId: string;
  platform: string;
  clientSkuIdEan: string;
  returnOrderType: string;
  forwardAwbNumber: string;
}

export interface BulkClaimVerifyRow {
  rowNumber: number;
  isValid: boolean;
  resolvedTypeOfClaim: string | null;
  missingFields: string[];
}

export interface BulkClaimCreateRow {
  rowNumber: number;
  isSuccess: boolean;
  cmsId?: string;
  error?: string;
}

export interface ApiEnvelope<T> {
  isSuccess: boolean;
  displayMessage: string;
  data: T;
}
