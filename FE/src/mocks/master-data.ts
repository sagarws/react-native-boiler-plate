import { daysAgo, seeded } from "@/mocks/delay";
import type { MasterHistoryEvent, MasterOrder, MeeshoOrder, MyntraOrder, SnapdealOrder } from "@/types/master-data";

/** Sample master data for the Master Data screen (AJIO + D2C rows) and the Meesho / Snapdeal / Myntra masters. */

export const MASTER_COMPANY_ID = "64f0c0ffee0000000000c001";
const USER_ID = "64f0c0ffee0000000000a001";
export const SAMPLE_VIDEO_URL = "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4";

const pick = <T,>(rand: () => number, list: readonly T[]): T => list[Math.floor(rand() * list.length) % list.length];
const digits = (rand: () => number, n: number): string => Array.from({ length: n }, () => Math.floor(rand() * 10)).join("");
const hexId = (prefix: string, i: number): string => `${prefix}${i.toString(16)}`.padStart(24, "0").slice(-24);

const ORDER_STATUSES = [
  "Return Created",
  "Return Cancelled",
  "Return Delivered",
  "Return Delivered",
  "Return Not Delivered",
  "Return Dispute",
  "Return Dispute",
  "Physically Return Received",
  "Marketplace Delivered",
  "",
] as const;
const CLAIM_STATUSES = ["Pending", "In Review", "In Review", "Approved", "Rejected"] as const;
const CARRIERS = ["Delhivery", "Xpressbees", "Ekart", "Shadowfax", "Ecom Express", ""] as const;
const RETURN_CARRIERS = ["Delhivery", "Xpressbees", "Shadowfax", "Blue Dart"] as const;
const BRANDS = ["Urban Threads", "Kalki Weaves", "Roadster Lane", "Mitti Home", ""] as const;
const SELLERS = ["Urban Threads Pvt Ltd", "UT Retail LLP", ""] as const;
const RETURN_TYPES = ["Customer Return", "RTO", "Courier Return", ""] as const;
const REASONS = [
  "Size too small",
  "Colour different from image",
  "Damaged product received",
  "Wrong item delivered",
  "Quality not as expected",
  "Received used product",
] as const;
const REJECT_REASONS = [
  "Parcel weight matches the dispatch weight; no evidence of tampering.",
  "Video does not clearly show the product label.",
  "Claim raised after the 30 day window.",
] as const;
const NAMES = ["Aarav Sharma", "Priya Nair", "Rohan Gupta", "Ananya Iyer", "Kabir Mehta", "Sneha Reddy", "Vikram Singh", "Isha Patel", "Arjun Rao", "Meera Joshi"] as const;
const SKU_STYLES = ["UTK-KURTA", "UTD-DRESS", "UTJ-JEANS", "UTS-SAREE", "UTT-TOP", "UTC-COORD"] as const;

function buildAjioRows(count: number): MasterOrder[] {
  const rand = seeded(4021);
  return Array.from({ length: count }, (_, i) => {
    const orderStatus = pick(rand, ORDER_STATUSES);
    const isReturnDelivered = orderStatus === "Return Delivered";
    const condition = isReturnDelivered ? (rand() > 0.45 ? 2 : 1) : orderStatus === "Return Dispute" ? 2 : null;
    const claimRelevant = (isReturnDelivered && condition === 2) || orderStatus === "Return Dispute";
    const claimStatus = claimRelevant ? pick(rand, CLAIM_STATUSES) : "";
    const orderDay = 3 + Math.floor(rand() * 40);
    const style = pick(rand, SKU_STYLES);
    const qty = 1 + Math.floor(rand() * 2);
    const good = condition === 1 ? qty : condition === 2 ? Math.floor(rand() * qty) : null;
    return {
      _id: hexId("ma", i + 1),
      order_no: `FN${digits(rand, 10)}`,
      companyId: MASTER_COMPANY_ID,
      fileKey: `master/ajio/dropship-order-${(i % 4) + 1}.xlsx`,
      userId: USER_ID,
      order_date: daysAgo(orderDay, 9 + (i % 9)),
      order_status: orderStatus,
      order_jioCode: rand() > 0.15 ? Number(`4${digits(rand, 8)}`) : null,
      order_seller_style_code: `${style}-${digits(rand, 3)}`,
      order_seller_SKU: `${style}-${pick(rand, ["S", "M", "L", "XL"])}-${digits(rand, 2)}`,
      order_FWD_Shipment_ID: `SH${digits(rand, 9)}`,
      order_Carrier: pick(rand, CARRIERS),
      order_FWD_AWB_no: `14${digits(rand, 11)}`,
      order_Brand: pick(rand, BRANDS),
      order_Seller_Name: pick(rand, SELLERS),
      import_platform: "AJIO",
      ajio_account_email: rand() > 0.3 ? "ajio@urbanthreads.in" : "returns@urbanthreads.in",
      isDeleted: false,
      isFavorite: false,
      is_imported: true,
      return_order_AWB_no: orderStatus ? `RT${digits(rand, 10)}` : "",
      return_order_Carrier: orderStatus ? pick(rand, RETURN_CARRIERS) : "",
      return_order_date: orderStatus ? daysAgo(Math.max(0, orderDay - 4), 11) : "",
      return_order_no: orderStatus ? `RN${digits(rand, 9)}` : "",
      return_order_reason: orderStatus ? pick(rand, REASONS) : "",
      return_order_type: orderStatus ? pick(rand, RETURN_TYPES) : "",
      return_jioCode: orderStatus ? Number(`4${digits(rand, 8)}`) : null,
      return_quantity: orderStatus ? qty : null,
      return_shipment_id: orderStatus ? `RS${digits(rand, 9)}` : "",
      tpl_delivery_status: isReturnDelivered ? "Delivered to seller" : orderStatus === "Return Not Delivered" ? "Lost in transit" : orderStatus ? "In transit" : "",
      return_fwd_carrier_name: orderStatus ? pick(rand, RETURN_CARRIERS) : "",
      return_brand: orderStatus ? pick(rand, BRANDS) : "",
      return_delivered_date: isReturnDelivered ? daysAgo(Math.max(0, orderDay - 9), 15) : "",
      fwd_seller_order_no: `SO-${digits(rand, 7)}`,
      order_quantity: qty,
      orderCondition: condition,
      is_m_not_delivered: orderStatus === "Return Not Delivered" ? true : orderStatus ? false : null,
      good_quantity: good,
      bad_quantity: good === null ? null : qty - good,
      status: claimStatus,
      ticketNumber: claimStatus && claimStatus !== "Pending" ? `AJ-TKT-${digits(rand, 6)}` : "",
      rejectReason: claimStatus === "Rejected" ? pick(rand, REJECT_REASONS) : "",
      POB_ID: rand() > 0.4 ? `POB${digits(rand, 7)}` : "",
      forward_video_link: rand() > 0.5 ? SAMPLE_VIDEO_URL : "",
      return_video_link: condition ? SAMPLE_VIDEO_URL : "",
      history: hexId("mh", i + 1),
      createdAt: daysAgo(orderDay, 8),
      updatedAt: daysAgo(Math.max(0, orderDay - 5), 8),
      __v: 0,
    };
  });
}

function buildD2cRows(count: number): MasterOrder[] {
  const rand = seeded(9917);
  return Array.from({ length: count }, (_, i) => {
    const r = rand();
    const sent: boolean | undefined = r > 0.45 ? true : r > 0.15 ? false : undefined;
    const day = Math.floor(rand() * 20);
    return {
      _id: hexId("md", i + 1),
      order_no: `UT${digits(rand, 6)}`,
      companyId: MASTER_COMPANY_ID,
      fileKey: "master/d2c/whatsapp-numbers.xlsx",
      userId: USER_ID,
      order_date: daysAgo(day, 12),
      order_status: "",
      order_jioCode: null,
      order_seller_style_code: "",
      order_seller_SKU: "",
      order_FWD_Shipment_ID: "",
      order_Carrier: "",
      order_FWD_AWB_no: `${pick(rand, ["14", "79", "35"])}${digits(rand, 11)}`,
      order_Brand: "",
      order_Seller_Name: "",
      import_platform: "D2C",
      ajio_account_email: "",
      isDeleted: false,
      isFavorite: false,
      is_imported: true,
      return_order_AWB_no: "",
      return_order_Carrier: "",
      return_order_date: "",
      return_order_no: "",
      return_order_reason: "",
      return_order_type: "",
      return_jioCode: null,
      return_quantity: null,
      return_shipment_id: "",
      tpl_delivery_status: "",
      return_fwd_carrier_name: "",
      return_brand: "",
      return_delivered_date: "",
      fwd_seller_order_no: "",
      order_quantity: null,
      orderCondition: null,
      is_m_not_delivered: null,
      good_quantity: null,
      bad_quantity: null,
      status: "",
      ticketNumber: "",
      rejectReason: "",
      POB_ID: "",
      forward_video_link: "",
      return_video_link: "",
      history: hexId("mh", 500 + i),
      messageSent: sent,
      cust_whatsapp_number: `+91 9${digits(rand, 9)}`,
      cust_name: pick(rand, NAMES),
      createdAt: daysAgo(day, 12),
      updatedAt: daysAgo(day, 13),
      __v: 0,
    };
  });
}

function buildMeeshoRows(count: number): MeeshoOrder[] {
  const rand = seeded(733);
  return Array.from({ length: count }, (_, i) => {
    const day = 2 + Math.floor(rand() * 40);
    const sku = `${pick(rand, SKU_STYLES)}-${pick(rand, ["S", "M", "L"])}`;
    return {
      _id: hexId("me", i + 1),
      companyId: MASTER_COMPANY_ID,
      subOrderNo: `${digits(rand, 15)}_1`,
      orderDate: daysAgo(day, 10),
      skuForward: sku,
      quantityForward: 1 + Math.floor(rand() * 2),
      packetId: `PKT${digits(rand, 8)}`,
      skuReturn: sku,
      orderNumber: `${digits(rand, 12)}`,
      qtyReturn: 1,
      returnCreatedDate: daysAgo(Math.max(0, day - 5), 14),
      typeOfReturn: pick(rand, ["Customer Return", "Courier Return (RTO)", "Wrong / Defective"]),
      returnAwbNo: `VL${digits(rand, 11)}`,
      supplierEmailId: pick(rand, ["meesho@urbanthreads.in", "ops@urbanthreads.in"]),
      import_platform: "MEESHO",
      forwardFileKey: "master/meesho/order.xlsx",
      returnFileKey: "master/meesho/rtv.xlsx",
      is_imported: true,
      createdAt: daysAgo(Math.max(0, day - 5), 15),
      updatedAt: daysAgo(Math.max(0, day - 6), 15),
    };
  });
}

function buildSnapdealRows(count: number): SnapdealOrder[] {
  const rand = seeded(5511);
  return Array.from({ length: count }, (_, i) => {
    const day = 2 + Math.floor(rand() * 40);
    const status = pick(rand, ["RETURN_INITIATED", "RETURN_IN_TRANSIT", "RETURN_DELIVERED", "RETURN_DELIVERED", "RTO_DELIVERED"]);
    return {
      _id: hexId("sd", i + 1),
      companyId: MASTER_COMPANY_ID,
      subOrderNo: `${digits(rand, 11)}`,
      orderCode: `SD${digits(rand, 9)}`,
      orderCreatedDate: daysAgo(day, 9),
      skuCode: `SDL${pick(rand, SKU_STYLES)}${digits(rand, 3)}`,
      packageId: `PKG${digits(rand, 8)}`,
      referenceCode: `REF${digits(rand, 7)}`,
      forwardAwbNo: `SF${digits(rand, 10)}`,
      returnAwbNo: `SR${digits(rand, 10)}`,
      returnInitiatedOn: daysAgo(Math.max(0, day - 4), 12),
      returnDeliveredOn: status.endsWith("DELIVERED") ? daysAgo(Math.max(0, day - 8), 16) : null,
      reverseCourierCode: pick(rand, ["DEL", "XB", "ECOM"]),
      shippingProvider: pick(rand, ["Delhivery", "Xpressbees", "Ecom Express"]),
      status,
      snapdeal_account_username: pick(rand, ["urbanthreads_sd", "ut_outlet"]),
      fileKey: "master/snapdeal/rtv.xlsx",
      import_platform: "SNAPDEAL",
      is_imported: true,
      createdAt: daysAgo(Math.max(0, day - 4), 13),
      updatedAt: daysAgo(Math.max(0, day - 5), 13),
    };
  });
}

function buildMyntraRows(count: number): MyntraOrder[] {
  const rand = seeded(8123);
  return Array.from({ length: count }, (_, i) => {
    const day = 2 + Math.floor(rand() * 40);
    return {
      _id: hexId("my", i + 1),
      companyId: MASTER_COMPANY_ID,
      returnTrackingNumber: `MYR${digits(rand, 10)}`,
      forwardTrackingNumber: `MYF${digits(rand, 10)}`,
      orderDeliveredDate: daysAgo(day, 11),
      returnCreatedDate: rand() > 0.1 ? daysAgo(Math.max(0, day - 3), 13) : null,
      status: pick(rand, ["RETURN_CREATED", "RETURN_IN_TRANSIT", "RETURN_RECEIVED", "RTO_RECEIVED"]),
      skuId: `${digits(rand, 8)}`,
      model: pick(rand, ["PPMP", "SJIT", "OR"]),
      myntra_account_username: pick(rand, ["urbanthreads_myn", "ut_ppmp"]),
      fileKey: "master/myntra/returns.csv",
      import_platform: "MYNTRA",
      is_imported: true,
      createdAt: daysAgo(Math.max(0, day - 3), 14),
      updatedAt: daysAgo(Math.max(0, day - 3), 14),
    };
  });
}

export const masterOrdersSeed: MasterOrder[] = [...buildAjioRows(148), ...buildD2cRows(46)];
export const meeshoOrdersSeed: MeeshoOrder[] = buildMeeshoRows(64);
export const snapdealOrdersSeed: SnapdealOrder[] = buildSnapdealRows(52);
export const myntraOrdersSeed: MyntraOrder[] = buildMyntraRows(58);

/** Timeline for the "Order History" dialog of a master row. */
export function buildMasterHistory(order: MasterOrder): MasterHistoryEvent[] {
  const events: MasterHistoryEvent[] = [
    { _id: `${order._id}-1`, date: order.createdAt, description: `Order imported from ${order.import_platform} Dropship Order Report`, action_type: "IMPORT", by: "Admin" },
  ];
  if (order.return_order_date) {
    events.push({ _id: `${order._id}-2`, date: order.return_order_date, description: `Return ${order.return_order_no} created (${order.return_order_reason || "no reason"})`, action_type: "IMPORT", by: "Admin" });
  }
  if (order.orderCondition) {
    events.push({
      _id: `${order._id}-3`,
      date: order.return_delivered_date || order.updatedAt,
      description: `Return parcel scanned as ${order.orderCondition === 1 ? "GOOD" : "BAD"}`,
      action_type: "SCAN",
      by: "Return Desk",
    });
  }
  if (order.ticketNumber) {
    events.push({ _id: `${order._id}-4`, date: order.updatedAt, description: `Ticket ${order.ticketNumber} linked`, action_type: "TICKET", by: "Admin" });
  }
  if (order.status && order.status !== "Pending") {
    events.push({
      _id: `${order._id}-5`,
      date: order.updatedAt,
      description: order.status === "Rejected" ? `Claim rejected: ${order.rejectReason}` : `Claim status changed to ${order.status}`,
      action_type: "STATUS",
      by: "Admin",
    });
  }
  return events.sort((a, b) => a.date.localeCompare(b.date));
}
