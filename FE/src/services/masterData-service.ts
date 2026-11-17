import { clone, delay, newId } from "@/mocks/delay";
import { mockImportSummary, mockParseSheet, scannedParcelFallback, scannedParcelSeed } from "@/mocks/imports";
import {
  MASTER_COMPANY_ID,
  SAMPLE_VIDEO_URL,
  buildMasterHistory,
  masterOrdersSeed,
  meeshoOrdersSeed,
  myntraOrdersSeed,
  snapdealOrdersSeed,
} from "@/mocks/master-data";
import type { MessageResponse } from "@/types/common";
import type { ImportJobSummary } from "@/types/imports";
import type {
  BulkStatusUpdateResult,
  DisplayMessageResponse,
  IFilter,
  MasterExportPayload,
  MasterExportResponse,
  MasterHistory,
  MasterHistoryEvent,
  MasterImportResponse,
  MasterOrder,
  MasterOrderReportPayload,
  MasterStatusPayload,
  MasterTicketPayload,
  MeeshoListPayload,
  MeeshoListResponse,
  MeeshoOrder,
  MyntraListPayload,
  MyntraListResponse,
  MyntraOrder,
  ScanParcelNotificationPayload,
  ScanReturnParcelPayload,
  ScanReturnParcelResponse,
  ScannedParcelOrders,
  SnapdealListPayload,
  SnapdealListResponse,
  SnapdealOrder,
  TriggerClaimResponse,
} from "@/types/master-data";

/**
 * Mock of TrackVid-FE `api/masterData-service.ts` (+ the Meesho / Snapdeal / Myntra master list services from
 * `container/*MasterData/*-service.ts`). Module-level state so imports, status changes and scans persist for the session.
 */

let masterOrders: MasterOrder[] = clone(masterOrdersSeed);
let meeshoOrders: MeeshoOrder[] = clone(meeshoOrdersSeed);
let snapdealOrders: SnapdealOrder[] = clone(snapdealOrdersSeed);
let myntraOrders: MyntraOrder[] = clone(myntraOrdersSeed);
const scannedParcels: Record<string, ScannedParcelOrders> = clone(scannedParcelSeed);
const extraHistory: Record<string, MasterHistoryEvent[]> = {};
/** D2C rows re-queued by "Retry All Failed": id → time queued. Resolved on the next list call after ~2s. */
const pendingRetries = new Map<string, number>();

/** Hard cap the BE applies to "all rows" requests (mirrors D2C_EXPORT_MAX_ROWS on the FE). */
const MAX_REPORT_ROWS = 20000;

// ---------- helpers ----------

const NULL_FILTER = "Null";

function matchesFilter(value: string | number | null | undefined, filter: string | number | undefined): boolean {
  if (filter === undefined || filter === "" || filter === "all") return true;
  if (filter === NULL_FILTER) return value === null || value === undefined || value === "";
  return String(value ?? "") === String(filter);
}

function inRange(iso: string | null | undefined, start?: string | Date, end?: string | Date): boolean {
  if (!start && !end) return true;
  if (!iso) return false;
  const t = new Date(iso).getTime();
  if (start) {
    const s = new Date(start);
    s.setHours(0, 0, 0, 0);
    if (t < s.getTime()) return false;
  }
  if (end) {
    const e = new Date(end);
    e.setHours(23, 59, 59, 999);
    if (t > e.getTime()) return false;
  }
  return true;
}

function textMatch(q: string, values: readonly (string | number | null | undefined)[]): boolean {
  if (!q) return true;
  const needle = q.toLowerCase();
  return values.some((v) => v !== null && v !== undefined && String(v).toLowerCase().includes(needle));
}

function distinct(values: readonly (string | number | null | undefined)[]): string[] {
  const set = new Set<string>();
  for (const v of values) set.add(v === null || v === undefined ? "" : String(v));
  return [...set].sort((a, b) => a.localeCompare(b));
}

function sortRows<T>(rows: T[], field?: string, order?: "asc" | "desc"): T[] {
  if (!field) return rows;
  const dir = order === "desc" ? -1 : 1;
  return [...rows].sort((a, b) => {
    const va = (a as Record<string, unknown>)[field];
    const vb = (b as Record<string, unknown>)[field];
    const na = va === null || va === undefined ? "" : typeof va === "number" ? va : String(va).toLowerCase();
    const nb = vb === null || vb === undefined ? "" : typeof vb === "number" ? vb : String(vb).toLowerCase();
    return na < nb ? -dir : na > nb ? dir : 0;
  });
}

function page<T>(rows: T[], pageNo: number, limit: number): { order: T[]; metadata: MasterImportResponse["metadata"] } {
  const capped = limit <= 0 || limit > MAX_REPORT_ROWS;
  const size = capped ? MAX_REPORT_ROWS : limit;
  const start = Math.max(0, (pageNo - 1) * size);
  return {
    order: rows.slice(start, start + size),
    metadata: {
      limit: size,
      page: pageNo,
      total: rows.length,
      totalPage: Math.max(1, Math.ceil(rows.length / size)),
      limitCapped: capped && rows.length > MAX_REPORT_ROWS,
    },
  };
}

function resolvePendingRetries(): void {
  const now = Date.now();
  if (!pendingRetries.size) return;
  masterOrders = masterOrders.map((o) => {
    const at = pendingRetries.get(o._id);
    if (at === undefined || now - at < 2000) return o;
    pendingRetries.delete(o._id);
    // Most retries go through; a few numbers are still invalid on WhatsApp.
    const ok = (o.cust_whatsapp_number ?? "").replace(/\D/g, "").slice(-1) !== "7";
    return { ...o, messageSent: ok, updatedAt: new Date().toISOString() };
  });
}

function addHistory(id: string, description: string, action: MasterHistoryEvent["action_type"]): void {
  const row = masterOrders.find((o) => o._id === id);
  if (!row) return;
  const list = extraHistory[row.history] ?? [];
  list.push({ _id: newId(), date: new Date().toISOString(), description, action_type: action, by: "Admin" });
  extraHistory[row.history] = list;
}

function filterMaster(payload: MasterOrderReportPayload): MasterOrder[] {
  const q = payload.searchInput.trim();
  const isD2c = payload.import_platform === "D2C";
  return masterOrders.filter((o) => {
    if (o.isDeleted) return false;
    if (!matchesFilter(o.import_platform, payload.import_platform)) return false;
    // TrackVid hides the date picker on D2C; the BE ignores the range there.
    if (!isD2c && !q && !inRange(o.order_date, payload.startDate, payload.endDate)) return false;
    if (!matchesFilter(o.order_status, payload.order_status)) return false;
    if (!matchesFilter(o.orderCondition, payload.orderCondition)) return false;
    if (!matchesFilter(o.order_Carrier, payload.order_Carrier)) return false;
    if (!matchesFilter(o.return_order_Carrier, payload.return_order_Carrier)) return false;
    if (!matchesFilter(o.return_order_type, payload.return_order_type)) return false;
    if (!matchesFilter(o.order_Brand, payload.order_Brand)) return false;
    if (!matchesFilter(o.order_Seller_Name, payload.order_Seller_Name)) return false;
    if (!matchesFilter(o.status, payload.status)) return false;
    return textMatch(q, [
      o.order_no,
      o.order_FWD_AWB_no,
      o.return_order_AWB_no,
      o.return_order_no,
      o.order_seller_SKU,
      o.ticketNumber,
      o.cust_name,
      o.cust_whatsapp_number,
      o.POB_ID,
    ]);
  });
}

function buildFilters(rows: MasterOrder[]): IFilter {
  return {
    orderStatus: distinct(rows.map((r) => r.order_status)),
    return_order_Carrier: distinct(rows.map((r) => r.return_order_Carrier)),
    claimStatus: distinct(rows.map((r) => r.status)),
    importPlatForm: distinct(rows.map((r) => r.import_platform)),
    returnOrderType: distinct(rows.map((r) => r.return_order_type)),
    brand: distinct(rows.map((r) => r.order_Brand)),
    carrier: distinct(rows.map((r) => r.order_Carrier)),
    sellerName: distinct(rows.map((r) => r.order_Seller_Name)),
    parcelCondition: distinct(rows.map((r) => r.orderCondition)),
  };
}

function digits(n: number): string {
  return Array.from({ length: n }, () => Math.floor(Math.random() * 10)).join("");
}

/** New AJIO-shaped rows for a finished master import (so the table visibly changes). */
function newMasterRows(count: number, platform: string, email: string): MasterOrder[] {
  const now = new Date().toISOString();
  return Array.from({ length: count }, () => {
    const base = masterOrdersSeed[Math.floor(Math.random() * 100)];
    return {
      ...clone(base),
      _id: newId(),
      order_no: `FN${digits(10)}`,
      order_FWD_AWB_no: `14${digits(11)}`,
      return_order_AWB_no: `RT${digits(10)}`,
      return_order_no: `RN${digits(9)}`,
      order_status: "Return Created",
      orderCondition: null,
      status: "",
      ticketNumber: "",
      rejectReason: "",
      good_quantity: null,
      bad_quantity: null,
      import_platform: platform,
      ajio_account_email: email,
      order_date: now,
      return_order_date: now,
      return_delivered_date: "",
      history: newId(),
      createdAt: now,
      updatedAt: now,
    };
  });
}

// ---------- TrackVid `MasterData` functions ----------

const uploadMasterFile = async (payload: FormData): Promise<ImportJobSummary> => {
  await delay(700);
  const platform = String(payload.get("importPlatform") ?? "");
  if (!platform) throw new Error("Please select an e-commerce platform.");
  const files = ["DropshipOrderFile", "DropshipRtvFile", "DropshipFile"].map((k) => payload.get(k)).filter((f) => f instanceof File);
  if (!files.length) throw new Error("Please select at least one file to upload.");
  const sheets = await Promise.all(files.map((f) => mockParseSheet(f)));
  const total = sheets.reduce((sum, s) => sum + s.rowCount, 0);
  const inserted = Math.min(6, Math.max(1, Math.round(total * 0.4)));
  masterOrders = [...newMasterRows(inserted, platform === "OTHER" ? "OTHER" : platform, String(payload.get("email") ?? "")), ...masterOrders];
  return mockImportSummary(
    { fileName: sheets.map((s) => s.fileName).join(", "), rowCount: total, header: [], rows: [] },
    Math.round(total * 0.4),
    "Master data",
  );
};

const uploadMeeshoMasterFile = async (payload: FormData): Promise<ImportJobSummary> => {
  await delay(650);
  const sheet = await mockParseSheet(payload.get("file"), String(payload.get("reportType") ?? "Meesho report"));
  const email = String(payload.get("email") ?? "");
  if (!email.trim()) throw new Error("Meesho account email is required.");
  const now = new Date().toISOString();
  const add = Math.min(5, Math.max(1, Math.round(sheet.rowCount * 0.3)));
  const fresh = Array.from({ length: add }, (): MeeshoOrder => {
    const base = meeshoOrdersSeed[Math.floor(Math.random() * meeshoOrdersSeed.length)];
    return { ...clone(base), _id: newId(), subOrderNo: `${digits(15)}_1`, orderNumber: digits(12), returnAwbNo: `VL${digits(11)}`, supplierEmailId: email, orderDate: now, returnCreatedDate: now, createdAt: now, updatedAt: now };
  });
  meeshoOrders = [...fresh, ...meeshoOrders];
  return mockImportSummary(sheet, Math.round(sheet.rowCount * 0.3), "Meesho master data");
};

const uploadSnapdealMasterFile = async (payload: FormData): Promise<ImportJobSummary> => {
  await delay(650);
  const sheet = await mockParseSheet(payload.get("file"), "Dropship RTV Report");
  const username = String(payload.get("username") ?? "").trim();
  if (!username) throw new Error("Snapdeal account username is required.");
  const now = new Date().toISOString();
  const add = Math.min(5, Math.max(1, Math.round(sheet.rowCount * 0.3)));
  const fresh = Array.from({ length: add }, (): SnapdealOrder => {
    const base = snapdealOrdersSeed[Math.floor(Math.random() * snapdealOrdersSeed.length)];
    return { ...clone(base), _id: newId(), subOrderNo: digits(11), orderCode: `SD${digits(9)}`, returnAwbNo: `SR${digits(10)}`, snapdeal_account_username: username, orderCreatedDate: now, returnInitiatedOn: now, status: "RETURN_INITIATED", returnDeliveredOn: null, createdAt: now, updatedAt: now };
  });
  snapdealOrders = [...fresh, ...snapdealOrders];
  return mockImportSummary(sheet, Math.round(sheet.rowCount * 0.3), "Snapdeal master data");
};

const uploadMyntraMasterFile = async (payload: FormData): Promise<ImportJobSummary> => {
  await delay(650);
  const sheet = await mockParseSheet(payload.get("file"), "Myntra Returns Report");
  const username = String(payload.get("username") ?? "").trim();
  if (!username) throw new Error("Myntra account username is required.");
  const now = new Date().toISOString();
  const add = Math.min(5, Math.max(1, Math.round(sheet.rowCount * 0.3)));
  const fresh = Array.from({ length: add }, (): MyntraOrder => {
    const base = myntraOrdersSeed[Math.floor(Math.random() * myntraOrdersSeed.length)];
    return { ...clone(base), _id: newId(), returnTrackingNumber: `MYR${digits(10)}`, forwardTrackingNumber: `MYF${digits(10)}`, myntra_account_username: username, orderDeliveredDate: now, returnCreatedDate: now, status: "RETURN_CREATED", createdAt: now, updatedAt: now };
  });
  myntraOrders = [...fresh, ...myntraOrders];
  return mockImportSummary(sheet, Math.round(sheet.rowCount * 0.3), "Myntra master data");
};

const uploadMyntraScanVideoFile = async (payload: FormData): Promise<ImportJobSummary> => {
  await delay(600);
  const sheet = await mockParseSheet(payload.get("file"), "Scan Video CSV");
  if (sheet.header.length && !sheet.header.some((h) => /tracking/i.test(h))) {
    throw new Error("Scan Video CSV must have the columns Scan Video, Scan Type, Tracking Id.");
  }
  return mockImportSummary(sheet, 0, "Myntra scan videos");
};

const getMasterOrderReport = async (payload: MasterOrderReportPayload): Promise<MasterImportResponse> => {
  await delay(420);
  resolvePendingRetries();
  const filtered = sortRows(filterMaster(payload), payload.sortField ?? "order_date", payload.sortField ? payload.sortOrder : "desc");
  // Filter options come from the platform + date scope (not narrowed by the column filters themselves).
  const scope = filterMaster({ ...payload, order_status: "", orderCondition: "", order_Carrier: "", return_order_Carrier: "", return_order_type: "", order_Brand: "", order_Seller_Name: "", status: "" });
  const { order, metadata } = page(filtered, payload.page, payload.limit);
  return clone({ order, metadata, filters: buildFilters(scope) });
};

const uploadStatusFile = async (payload: FormData): Promise<ImportJobSummary> => {
  await delay(650);
  const platform = String(payload.get("importPlatform") ?? "");
  if (!platform) throw new Error("Please complete all fields and select the file to upload");
  const sheet = await mockParseSheet(payload.get("UpdateRtv"));
  let changed = 0;
  const limit = Math.min(sheet.rowCount, 8);
  masterOrders = masterOrders.map((o) => {
    if (changed >= limit || o.order_status !== "Return Created" || o.import_platform.toLowerCase() !== platform.toLowerCase()) return o;
    changed += 1;
    return { ...o, order_status: "Return Delivered", return_delivered_date: new Date().toISOString(), updatedAt: new Date().toISOString() };
  });
  return mockImportSummary(sheet, 0, "Status update");
};

const updateMasterStatus = async (payload: MasterStatusPayload): Promise<DisplayMessageResponse> => {
  await delay(400);
  const row = masterOrders.find((o) => o._id === payload._id);
  if (!row) throw new Error("Order not found.");
  if (payload.status === "Rejected" && !payload.reason?.trim()) throw new Error("Reason is required.");
  masterOrders = masterOrders.map((o) =>
    o._id === payload._id ? { ...o, status: payload.status, rejectReason: payload.status === "Rejected" ? (payload.reason ?? "") : o.rejectReason, updatedAt: new Date().toISOString() } : o,
  );
  addHistory(payload._id, payload.status === "Rejected" ? `Claim rejected: ${payload.reason ?? ""}` : `Claim status changed to ${payload.status}`, "STATUS");
  return { displayMessage: `Status updated to ${payload.status}.` };
};

const editMasterTicket = async (payload: MasterTicketPayload): Promise<DisplayMessageResponse> => {
  await delay(400);
  if (!masterOrders.some((o) => o._id === payload._id)) throw new Error("Order not found.");
  const ticket = payload.ticket.trim();
  masterOrders = masterOrders.map((o) => (o._id === payload._id ? { ...o, ticketNumber: ticket, updatedAt: new Date().toISOString() } : o));
  addHistory(payload._id, ticket ? `Ticket ${ticket} linked` : "Ticket removed", "TICKET");
  return { displayMessage: "Ticket updated successfully." };
};

const EXPORT_COLUMNS: readonly [keyof MasterOrder, string][] = [
  ["order_no", "Cust. Order No"],
  ["return_order_no", "Return Order No"],
  ["order_date", "Order Date"],
  ["return_order_date", "Return Order Date"],
  ["order_status", "Order Status"],
  ["order_seller_SKU", "Seller SKU"],
  ["order_FWD_AWB_no", "Forward AWB No"],
  ["return_order_AWB_no", "Return Order AWB No"],
  ["orderCondition", "Parcel Condition"],
  ["status", "Claim Status"],
  ["ticketNumber", "Ticket"],
  ["order_Carrier", "Carrier"],
  ["return_order_Carrier", "Return Order Carrier"],
  ["order_Brand", "Brand"],
  ["import_platform", "Import Platform"],
];

const csvCell = (v: unknown): string => {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const downloadExternalOrder = async (payload: MasterExportPayload): Promise<MasterExportResponse> => {
  await delay(700);
  let rows: MasterOrder[];
  if (payload.selectedOrders.length) {
    rows = masterOrders.filter((o) => payload.selectedOrders.includes(o._id));
  } else {
    const all = sortRows(
      filterMaster({ searchInput: payload.searchInput, startDate: payload.startDate, endDate: payload.endDate, import_platform: payload.import_platform, order_status: payload.order_status, status: payload.status, page: 1, limit: 0 }),
      "order_date",
      "desc",
    );
    rows = payload.limit === 0 ? all : all.slice((payload.page - 1) * payload.limit, payload.page * payload.limit);
  }
  if (!rows.length) throw new Error("No records to export.");
  const lines = [
    EXPORT_COLUMNS.map(([, h]) => h).join(","),
    ...rows.map((r) => EXPORT_COLUMNS.map(([k]) => (k === "orderCondition" ? (r.orderCondition === 1 ? "GOOD" : r.orderCondition === 2 ? "BAD" : "") : csvCell(r[k]))).join(",")),
  ];
  return { fileUrl: null, fileName: "Master_Data.csv", csv: `﻿${lines.join("\n")}`, count: rows.length };
};

const scanReturnParcel = async (payload: ScanReturnParcelPayload): Promise<ScanReturnParcelResponse> => {
  await delay(300);
  const awb = payload.awbNumber.trim();
  if (!awb) return { isSuccess: false, message: "Please enter a value", data: null };
  const row = masterOrders.find((o) => o.return_order_AWB_no.toLowerCase() === awb.toLowerCase() || o.order_FWD_AWB_no.toLowerCase() === awb.toLowerCase());
  if (row) {
    const condition = payload.parcelCondition;
    masterOrders = masterOrders.map((o) =>
      o._id === row._id
        ? {
            ...o,
            orderCondition: condition,
            order_status: o.order_status === "Return Created" ? "Return Delivered" : o.order_status,
            status: condition === 2 && !o.status ? "Pending" : o.status,
            return_delivered_date: o.return_delivered_date || new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          }
        : o,
    );
    addHistory(row._id, `Return parcel scanned as ${condition === 1 ? "GOOD" : "BAD"}`, "SCAN");
    return { isSuccess: true, message: "Parcel scanned successfully", data: { matched: true } };
  }
  if (/^[A-Za-z0-9-]{8,}$/.test(awb)) {
    return { isSuccess: true, message: "Scan recorded", data: { staged: true } };
  }
  return { isSuccess: false, message: `No order found for parcel ${awb}`, data: null };
};

const scanReturnParcelNotification = async (payload: ScanParcelNotificationPayload): Promise<MessageResponse & { notificationId: string }> => {
  await delay(300);
  const id = newId();
  scannedParcels[id] = {
    notificationId: id,
    parcelCondition: payload.parcelCondition,
    failedOrders: [...payload.failedParcels],
    successfulOrders: [...payload.successParcels],
    createdAt: new Date().toISOString(),
  };
  return { message: "Scan summary saved to notifications.", notificationId: id };
};

const scanReturnParcelOrders = async (payload: { notificationId: string }): Promise<ScannedParcelOrders> => {
  await delay(450);
  if (!payload.notificationId) throw new Error("Failed to fetch scanned parcel");
  return clone(scannedParcels[payload.notificationId] ?? scannedParcelFallback(payload.notificationId));
};

const triggerReturnNotDeliveredClaim = async (payload: { ids?: string[]; marketplace?: string }): Promise<TriggerClaimResponse> => {
  await delay(500);
  const candidates = masterOrders.filter((o) => (o.order_status === "Return Not Delivered" || o.order_status === "Marketplace Delivered") && (!payload.ids?.length || payload.ids.includes(o._id)));
  if (!candidates.length) throw new Error("No Return Not Delivered or Marketplace Delivered orders to claim.");
  return { message: "Claim script triggered", displayMessage: `${candidates.length} claim(s) queued for Return Not Delivered orders.`, data: { queued: candidates.length } };
};

// RMS Return Dispute (In Review) bulk status update — same Excel/CSV as the CMS
// bulk update; matches masterdata records by ticket number for the marketplace.
const bulkStatusUpdateReturnDispute = async (file: File, marketplace: string): Promise<BulkStatusUpdateResult> => {
  await delay(800);
  const sheet = await mockParseSheet(file);
  const tickets = sheet.rows.map((r) => r[0]).filter(Boolean);
  let updated = 0;
  const notFound: string[] = [];
  for (const t of tickets) {
    const row = masterOrders.find((o) => o.ticketNumber === t && o.import_platform.toLowerCase() === marketplace.toLowerCase());
    if (!row) {
      notFound.push(t);
      continue;
    }
    updated += 1;
    masterOrders = masterOrders.map((o) => (o._id === row._id ? { ...o, status: "Approved", updatedAt: new Date().toISOString() } : o));
  }
  return { total: sheet.rowCount, updated, notFound, skipped: Math.max(0, sheet.rowCount - updated - notFound.length) };
};

export const MasterData = {
  uploadMasterFile,
  uploadMeeshoMasterFile,
  uploadSnapdealMasterFile,
  uploadMyntraMasterFile,
  uploadMyntraScanVideoFile,
  getMasterOrderReport,
  updateMasterStatus,
  editMasterTicket,
  uploadStatusFile,
  downloadExternalOrder,
  scanReturnParcel,
  scanReturnParcelNotification,
  scanReturnParcelOrders,
  triggerReturnNotDeliveredClaim,
  bulkStatusUpdateReturnDispute,
};

// ---------- container/*MasterData services ----------

function platformRange<T>(rows: T[], payload: { searchInput: string; startDate?: string; endDate?: string }, dateOf: (r: T) => string | null, text: (r: T) => (string | null)[]): T[] {
  const q = payload.searchInput.trim();
  return rows.filter((r) => (q ? textMatch(q, text(r)) : inRange(dateOf(r), payload.startDate, payload.endDate)));
}

export const getMeeshoMasterList = async (payload: MeeshoListPayload): Promise<MeeshoListResponse> => {
  await delay(380);
  // Date filter is bypassed when searching, per API spec
  const scoped = platformRange(meeshoOrders, payload, (r) => r.returnCreatedDate, (r) => [r.subOrderNo, r.orderNumber, r.returnAwbNo, r.skuForward, r.packetId]);
  const rows = scoped.filter((r) => matchesFilter(r.typeOfReturn, payload.typeOfReturn) && matchesFilter(r.supplierEmailId, payload.supplierEmailId));
  const { order, metadata } = page(sortRows(rows, "createdAt", "desc"), payload.page, payload.limit);
  return clone({ order, metadata, filters: { typeOfReturn: distinct(scoped.map((r) => r.typeOfReturn)), supplierEmailId: distinct(scoped.map((r) => r.supplierEmailId)) } });
};

export const getSnapdealMasterList = async (payload: SnapdealListPayload): Promise<SnapdealListResponse> => {
  await delay(380);
  const scoped = platformRange(snapdealOrders, payload, (r) => r.returnInitiatedOn, (r) => [r.subOrderNo, r.orderCode, r.forwardAwbNo, r.returnAwbNo, r.skuCode]);
  const rows = scoped.filter((r) => matchesFilter(r.status, payload.status) && matchesFilter(r.snapdeal_account_username, payload.snapdeal_account_username));
  const { order, metadata } = page(sortRows(rows, "createdAt", "desc"), payload.page, payload.limit);
  return clone({ order, metadata, filters: { status: distinct(scoped.map((r) => r.status)), snapdeal_account_username: distinct(scoped.map((r) => r.snapdeal_account_username)) } });
};

export const getMyntraMasterList = async (payload: MyntraListPayload): Promise<MyntraListResponse> => {
  await delay(380);
  const scoped = platformRange(myntraOrders, payload, (r) => r.returnCreatedDate ?? r.createdAt, (r) => [r.returnTrackingNumber, r.forwardTrackingNumber, r.skuId]);
  const rows = scoped.filter((r) => matchesFilter(r.status, payload.status) && matchesFilter(r.myntra_account_username, payload.myntra_account_username));
  const { order, metadata } = page(sortRows(rows, "createdAt", "desc"), payload.page, payload.limit);
  return clone({ order, metadata, filters: { status: distinct(scoped.map((r) => r.status)), myntra_account_username: distinct(scoped.map((r) => r.myntra_account_username)) } });
};

/** Mock of `getClaimHistoryById(historyId)` for `HISTORY_TYPE_ENUM.MASTER_ORDER` rows. */
export const getMasterOrderHistory = async (historyId: string): Promise<MasterHistory> => {
  await delay(450);
  const row = masterOrders.find((o) => o.history === historyId);
  if (!row) throw new Error("History not found for this order.");
  const events = [...buildMasterHistory(row), ...(extraHistory[historyId] ?? [])].sort((a, b) => a.date.localeCompare(b.date));
  return clone({ _id: historyId, claimId: row._id, history: events, createdAt: row.createdAt, updatedAt: row.updatedAt });
};

/** Used by the WhatsApp "Retry All Failed" mock (whatsappNumber-service). */
export function queueD2cRetries(batch: number): { queued: number; remainingAfterBatch: number } {
  resolvePendingRetries();
  const failed = masterOrders.filter((o) => o.import_platform === "D2C" && o.messageSent === false && !pendingRetries.has(o._id));
  const take = failed.slice(0, batch);
  const now = Date.now();
  const ids = new Set(take.map((o) => o._id));
  for (const id of ids) pendingRetries.set(id, now);
  masterOrders = masterOrders.map((o) => (ids.has(o._id) ? { ...o, messageSent: undefined } : o));
  return { queued: take.length, remainingAfterBatch: failed.length - take.length };
}

/** Used by the WhatsApp number import: adds D2C rows for the uploaded numbers. */
export function addD2cRows(rows: { orderId: string; awb: string; phone: string; name: string }[]): void {
  const now = new Date().toISOString();
  const template = masterOrdersSeed.find((o) => o.import_platform === "D2C");
  if (!template) return;
  const fresh = rows.map(
    (r): MasterOrder => ({
      ...clone(template),
      _id: newId(),
      companyId: MASTER_COMPANY_ID,
      order_no: r.orderId,
      order_FWD_AWB_no: r.awb,
      cust_whatsapp_number: r.phone,
      cust_name: r.name,
      messageSent: undefined,
      history: newId(),
      forward_video_link: SAMPLE_VIDEO_URL,
      order_date: now,
      createdAt: now,
      updatedAt: now,
    }),
  );
  masterOrders = [...fresh, ...masterOrders];
}

