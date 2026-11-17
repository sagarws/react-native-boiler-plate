import { forwardScreenshotsFor, masterOrders, returnScreenshotsFor } from "@/mocks/cms-create";
import { sampleClaims, sampleMasterRecords } from "@/mocks/cms";
import { delay } from "@/mocks/delay";
import { CmsService } from "@/services/cms-service";
import { getCreatedClaims } from "@/services/cms-create-service";
import type { FileMetadata, ICms } from "@/types/cms";
import type {
  AccountByAwbResponse,
  ExistingCmsPreview,
  FindCmsByAwbResponse,
  MasterInfoResponse,
  MeeshoOrderInfo,
  MyntraOrderInfo,
  OrderLookupItem,
  OrderLookupRecord,
  OrderLookupResponse,
  OrderScreenshotsResponse,
  OrderType,
  ProductSkuMapResponse,
  SnapdealOrderInfo,
  StoredFile,
} from "@/types/cms-create";

/**
 * Mock of TrackVid-FE `api/cms-autofetch-service.ts` (same exported function names). Each resolves to the response
 * body. A lookup miss throws `LookupNotFoundError` (TrackVid reads `err.response.status === 404`).
 */

export class LookupNotFoundError extends Error {
  readonly status = 404;
}

const norm = (v: string) => v.toLowerCase().trim().replace(/[\s_-]+/g, "");

/** GET /order/:awb?typeOfOrder= — video links, cross-side AWBs, SKUs and master-data records. */
export const getOrderByAwb = async (awb: string, type: OrderType): Promise<OrderLookupResponse> => {
  await delay(500);
  const value = awb.trim();
  const claims = sampleClaims.filter((c) => (type === "Return" ? c.AWBNumber === value : c.forwardAWB === value));
  const masters = sampleMasterRecords.filter((m) => (type === "Return" ? m.awb === value : m.forwardAWB === value));
  if (!claims.length && !masters.length) throw new LookupNotFoundError("Video not found");
  const first = claims[0];
  const item: OrderLookupItem = first
    ? { return_video_link: first.returnVideoLink, forward_video_link: first.forwardVideoLink, return_awb: first.AWBNumber, forward_awb: first.forwardAWB || undefined, customerOrderNumber: first.customerOrderNumber }
    : { return_awb: masters[0].awb, forward_awb: masters[0].forwardAWB };
  const records: OrderLookupRecord[] = masters.map((m) => ({ _id: m._id, sku: m.sku, returnAwb: m.awb, forwardAwb: m.forwardAWB, pobId: m.pobId }));
  return { data: [item], skus: [...new Set(records.map((r) => r.sku).filter(Boolean))], records };
};

/** GET /order/screenshot/:awb?orderType= — VMS frame grabs for the AWB. */
export const getOrderScreenshots = async (awb: string, type: OrderType): Promise<OrderScreenshotsResponse> => {
  await delay(600);
  const value = awb.trim();
  if (value.length < 6) return { isSuccess: true, data: [] };
  return { isSuccess: true, data: type === "Return" ? returnScreenshotsFor(value) : forwardScreenshotsFor(value) };
};

/** GET /product-skucode-map/:awb/:companyId */
export const getProductSkuMap = async (awb: string, companyId: string): Promise<ProductSkuMapResponse> => {
  await delay(300);
  const skus = sampleMasterRecords.filter((m) => m.awb === awb.trim()).map((m) => m.sku);
  return { isSuccess: Boolean(companyId), data: { awb, skus: [...new Set(skus)] } };
};

type SubOrderParams = { subOrderNo?: string; forwardAwbNo?: string; returnAwbNo?: string };

function findMaster(platform: string, params: SubOrderParams) {
  const t = (v?: string) => (v ?? "").trim();
  return masterOrders.find(
    (m) =>
      m.platform === platform &&
      ((t(params.subOrderNo) && m.subOrderNo === t(params.subOrderNo)) ||
        (t(params.returnAwbNo) && m.returnAwb === t(params.returnAwbNo)) ||
        (t(params.forwardAwbNo) && m.forwardAwb === t(params.forwardAwbNo))),
  );
}

/** GET /master/meesho-order-info */
export const getMeeshoOrderInfo = async (params: SubOrderParams): Promise<MasterInfoResponse<MeeshoOrderInfo>> => {
  await delay(450);
  const m = findMaster("meesho", params);
  if (!m) return { isSuccess: false, displayMessage: "Order not found in Meesho master data", data: null };
  return { isSuccess: true, data: { subOrderNo: m.subOrderNo, returnAwbNo: m.returnAwb, forwardAwbNo: m.forwardAwb, courierPartner: m.courierPartner } };
};

/** GET /master/snapdeal-order-info */
export const getSnapdealOrderInfo = async (params: SubOrderParams): Promise<MasterInfoResponse<SnapdealOrderInfo>> => {
  await delay(450);
  const m = findMaster("snapdeal", params);
  if (!m) return { isSuccess: false, displayMessage: "Order not found in Snapdeal master data", data: null };
  return { isSuccess: true, data: { subOrderNo: m.subOrderNo, returnAwbNo: m.returnAwb, forwardAwbNo: m.forwardAwb } };
};

/** GET /master/myntra-order-info */
export const getMyntraOrderInfo = async (params: { returnTrackingNumber?: string; forwardTrackingNumber?: string }): Promise<MasterInfoResponse<MyntraOrderInfo>> => {
  await delay(450);
  const m = findMaster("myntra", { returnAwbNo: params.returnTrackingNumber, forwardAwbNo: params.forwardTrackingNumber });
  if (!m) return { isSuccess: false, displayMessage: "Order not found in Myntra master data", data: null };
  return { isSuccess: true, data: { returnTrackingNumber: m.returnAwb, forwardTrackingNumber: m.forwardAwb, returnVideoLink: m.returnVideoLink, forwardVideoLink: m.forwardVideoLink } };
};

const withUrl = (f: FileMetadata | string | null | undefined): StoredFile | null => {
  if (!f) return null;
  if (typeof f === "string") return { fileKey: f, url: f };
  return { fileKey: f.fileKey, url: f.fileKey };
};
const urlOf = (f: FileMetadata | null | undefined): string => f?.fileKey ?? "";

/** List row (`@/types/cms` ICms) → the BE `findCmsByAwb` preview shape. */
function toPreview(row: ICms): ExistingCmsPreview {
  const o = row.otherClaimDetails;
  const m = row.myntraClaimDetails;
  return {
    _id: row._id,
    eCommercePlatform: row.eCommercePlatform,
    AWBNumber: row.AWBNumber,
    typeOfClaim: row.typeOfClaim ?? "",
    forwardAWB: row.forwardAWB ?? "",
    customerOrderNumber: row.customerOrderNumber ?? "",
    remark: row.remark ?? "",
    status: row.status,
    ticketNumber: row.ticketNumber ?? "",
    returnVideoLink: row.returnVideoLink ?? "",
    forwardVideoLink: row.forwardVideoLink ?? "",
    returnProductImage: urlOf(row.returnProductImage),
    forwardSentProductImage: urlOf(row.forwardSentProductImage),
    sixSideImages: urlOf(row.sixSideImages),
    podProof: urlOf(row.podProof),
    myntraClaimDetails: m
      ? {
          shippingLabelImage: withUrl(m.shippingLabelImage),
          packingImages: (m.packingImages ?? []).map(withUrl),
          damagedProductVideo: withUrl(m.damagedProductVideo),
          damagedProductVideoLink: m.damagedProductVideoLink ?? "",
          disputedAmount: m.disputedAmount === undefined ? "" : String(m.disputedAmount),
          physicalReceivedSku: m.physicalReceivedSku ?? "",
          username: m.username ?? "",
        }
      : null,
    nykaaClaimDetails: row.nykaaClaimDetails ? { ...row.nykaaClaimDetails } : null,
    otherClaimDetails: o
      ? {
          parentSelection: o.parentSelection ?? "",
          claimArea: o.claimArea ?? "",
          domestic: o.domestic ?? "",
          fulfillmentChannel: o.fulfillmentChannel ?? "",
          disputeAmount: o.disputeAmount ?? "",
          username: o.username ?? "",
          shippingLabelImage: withUrl(o.shippingLabelImage),
          serialNumberImage: withUrl(o.serialNumberImage),
          packingImages: (o.packingImages ?? []).map(withUrl),
          contentsOfReturnImages: (o.contentsOfReturnImages ?? []).map(withUrl),
        }
      : null,
    barcodeImage: withUrl(row.barcodeImage),
    receivedProductImage_1: withUrl(row.receivedProductImage_1),
    reverseWayBillImage: withUrl(row.reverseWayBillImage),
    outerPackageImage_1: withUrl(row.outerPackageImage_1),
    outerPackageImage_2: withUrl(row.outerPackageImage_2),
    innerPackageImage_1: withUrl(row.innerPackageImage_1),
    innerPackageImage_2: withUrl(row.innerPackageImage_2),
    productImage_1: withUrl(row.productImage_1),
    productImage_2: withUrl(row.productImage_2),
    podImage_1: withUrl(row.podImage_1),
    podImage_2: withUrl(row.podImage_2),
    subOrderNumber: row.subOrderNumber ?? "",
    packetId: row.packetId ?? "",
    logisticsPartnerName: "",
    stateOfThePacket: row.stateOfThePacket === undefined ? "" : String(row.stateOfThePacket),
    createdAt: row.createdAt,
    updatedAt: null,
    ajio_account_email: row.ajio_account_email ?? "",
    meesho_account_email: row.meesho_account_email ?? "",
    snapdeal_account_username: row.snapdeal_account_username ?? "",
    pobid: row.pobid && row.pobid !== "undefined" ? row.pobid : "",
    skuName: row.seller_sku ?? "",
  };
}

const samePlatform = (a: string, b: string) => {
  const x = norm(a);
  const y = norm(b);
  return x === y || (x.startsWith("nykaa") && y.startsWith("nykaa"));
};

/** POST /cms/find-by-awb — the live claim for this AWB + platform, or `data: null`. */
export const findCmsByAwb = async (awb: string, platform: string): Promise<FindCmsByAwbResponse> => {
  const value = awb.trim();
  const session = getCreatedClaims().find((c) => c.AWBNumber === value && samePlatform(c.eCommercePlatform, platform));
  if (session) {
    await delay(300);
    return { isSuccess: true, data: session };
  }
  const list = await CmsService.getCmsList({ page: 1, limit: 50, search: value, startDate: "", endDate: "", feedId: [], brand: [], eCommercePlatform: [], username: "", status: "" });
  const hit = list.data.cms.find((c) => c.AWBNumber === value && samePlatform(c.eCommercePlatform, platform));
  return hit ? { isSuccess: true, data: toPreview(hit) } : { isSuccess: true, data: null, displayMessage: "No claim for this AWB" };
};

/** GET /cms/account-by-awb — seller-portal account in the platform's master data (AJIO, Meesho, Snapdeal, Myntra). */
export const getAccountByAwb = async (awb: string, platform: string, type: OrderType): Promise<AccountByAwbResponse> => {
  await delay(350);
  const p = norm(platform);
  if (!["ajio", "meesho", "snapdeal", "myntra"].includes(p)) return { isSuccess: true, data: { account: null } };
  const row = sampleClaims.find((c) => norm(c.eCommercePlatform) === p && (type === "Return" ? c.AWBNumber === awb.trim() : c.forwardAWB === awb.trim()));
  const account =
    p === "ajio" ? row?.ajio_account_email : p === "meesho" ? row?.meesho_account_email : p === "snapdeal" ? row?.snapdeal_account_username : row?.myntraClaimDetails?.username;
  return { isSuccess: true, data: { account: account || null } };
};
