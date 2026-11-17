import { clone, delay, paginate } from "@/mocks/delay";
import { vmsOrdersSeed } from "@/mocks/vms";
import { toCsv } from "@/lib/download";
import { FileService } from "@/services/file-service";
import type { OrderType } from "@/types/accounts";
import type { VmsExportPayload, VmsListPayload, VmsListResponse, VmsMessage, VmsOrder, VmsOrderResult } from "@/types/vms";

/**
 * Mock of TrackVid-FE `api/order-service.ts` for the VMS and Favorite screens (same function names as `OrderService`).
 * It keeps its own, richer video set (multi-select filters, screenshots, cloud-processing states, parcel condition)
 * because the shared Accounts mock in `order-service.ts` is single-filter and has none of those fields.
 * Module-level state so edits persist for the page session.
 */

let orders: VmsOrder[] = clone(vmsOrdersSeed);

/** When a "processing" video started (ms). Processing finishes ~20s after it is first seen (or retried). */
const processingSince = new Map<string, number>();
const PROCESSING_MS = 20000;

const localDay = (iso: string): string => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** Advance simulated cloud processing (the BE flips processing → completed / failed on its own). */
function settleProcessing(): void {
  const now = Date.now();
  orders = orders.map((o) => {
    if (o.cloudStatus !== "processing") return o;
    const since = processingSince.get(o._id);
    if (since === undefined) {
      processingSince.set(o._id, now);
      return o;
    }
    if (now - since < PROCESSING_MS) return o;
    processingSince.delete(o._id);
    // A retried video that already used 2 retries fails once more so the "(max)" state can be seen.
    const failsAgain = (o.cloudRetryCount ?? 0) >= 2 && o.trackingId.charCodeAt(o.trackingId.length - 1) % 2 === 0;
    return failsAgain
      ? { ...o, cloudStatus: "failed", updatedAt: new Date().toISOString() }
      : { ...o, cloudStatus: "completed", key: o.key.replace(/^raw\//, "orders/"), updatedAt: new Date().toISOString() };
  });
}

function filterOrders(payload: Omit<VmsListPayload, "page" | "limit">): VmsOrder[] {
  const q = payload.search.trim().toLowerCase();
  return orders
    .filter((o) => !o.isDeleted)
    .filter((o) => !payload.isFavorite || o.isFavorite)
    .filter((o) => !payload.orderType.length || payload.orderType.includes(o.orderType))
    .filter((o) => !payload.feedId.length || payload.feedId.includes(o.feedId))
    .filter((o) => !payload.eCommercePlatform?.length || payload.eCommercePlatform.includes(o.eCommercePlatform ?? ""))
    .filter((o) => {
      const day = localDay(o.createdAt);
      return (!payload.startDate || day >= payload.startDate) && (!payload.endDate || day <= payload.endDate);
    })
    .filter((o) => !q || [o.trackingId, o.orderNo, o.awbNo, o.comment].some((v) => (v ?? "").toLowerCase().includes(q)))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function findOrder(id: string): VmsOrder {
  const order = orders.find((o) => o._id === id);
  if (!order) throw new Error("Order not found");
  return order;
}

function patch(ids: readonly string[], change: Partial<VmsOrder>): number {
  let n = 0;
  orders = orders.map((o) => {
    if (!ids.includes(o._id)) return o;
    n += 1;
    return { ...o, ...change, updatedAt: new Date().toISOString() };
  });
  return n;
}

const getOrderList = async (payload: VmsListPayload): Promise<VmsListResponse> => {
  await delay(420);
  settleProcessing();
  const result = paginate(filterOrders(payload), payload.page, payload.limit);
  return clone({
    order: result.data,
    metadata: { total: result.total, totalPage: Math.max(1, Math.ceil(result.total / payload.limit)), page: payload.page, limit: payload.limit },
  });
};

const addToFavorite = async (payload: { id: string[] }): Promise<VmsMessage> => {
  await delay(300);
  if (!payload.id.length) throw new Error("Please select at least one order");
  patch(payload.id, { isFavorite: true });
  return { displayMessage: "Order added to favorite successfully" };
};

const removeFavorite = async (payload: { id: string[] }): Promise<VmsMessage> => {
  await delay(300);
  if (!payload.id.length) throw new Error("Please select at least one order");
  patch(payload.id, { isFavorite: false });
  return { displayMessage: "Order removed from favorite successfully" };
};

/** Excel export in TrackVid; the mock builds a CSV with the same columns. */
const downloadExcelSheet = async (payload: VmsExportPayload): Promise<Blob> => {
  await delay(550);
  let rows = filterOrders(payload);
  if (payload.selectedOrders.length) rows = orders.filter((o) => payload.selectedOrders.includes(o._id));
  else rows = paginate(rows, payload.page, payload.limit).data;
  if (!rows.length) throw new Error("No orders to export");
  const csv = toCsv([
    ["Scanned Number", "Cust. Order No", "Forward AWB No", "Order Type", "Platform", "Feed", "Start Date-Time", "Video Length (s)", "File Size (MB)", "Screenshots", "Parcel Condition", "Comment"],
    ...rows.map((o) => [
      o.trackingId,
      o.orderNo || "",
      o.awbNo || "",
      o.orderType,
      o.eCommercePlatform ?? "",
      o.feedName ?? "",
      new Date(o.start_time).toLocaleString("en-IN"),
      o.videoLength ?? 0,
      ((o.size ?? 0) / 1024).toFixed(2),
      o.screenshots.length,
      o.orderType === "Return" && o.orderCondition ? (o.orderCondition === 1 ? "GOOD" : "BAD") : "",
      o.comment ?? "",
    ]),
  ]);
  return new Blob([`﻿${csv}`], { type: "text/csv;charset=utf-8" });
};

const updateOrderType = async (payload: { orderId: string; status: OrderType }): Promise<VmsOrderResult> => {
  await delay(300);
  findOrder(payload.orderId);
  patch([payload.orderId], { orderType: payload.status });
  return { displayMessage: "Order type updated successfully", data: clone(findOrder(payload.orderId)) };
};

const updatePlatformType = async (payload: { orderId: string; eCommercePlatform: string }): Promise<VmsOrderResult> => {
  await delay(300);
  findOrder(payload.orderId);
  patch([payload.orderId], { eCommercePlatform: payload.eCommercePlatform });
  return { displayMessage: "Order platform updated successfully", data: clone(findOrder(payload.orderId)) };
};

const addComment = async (payload: { _id: string; comment: string }): Promise<VmsMessage & { comment: string }> => {
  await delay(350);
  findOrder(payload._id);
  patch([payload._id], { comment: payload.comment });
  return { displayMessage: "Comment added successfully", comment: payload.comment };
};

/** Permanently deletes the video file and its screenshots; the order row stays. */
const deleteVideo = async (payload: { orderId: string }): Promise<VmsOrderResult> => {
  await delay(500);
  const order = findOrder(payload.orderId);
  if (!order.key || !order.fileId) throw new Error("This order has no video to delete");
  patch([payload.orderId], { key: "", fileId: "", screenshots: [], size: 0, videoLength: 0 });
  return { displayMessage: "Video deleted successfully", data: clone(findOrder(payload.orderId)) };
};

const updateTrackingId = async (payload: { orderId: string; trackingId: string }): Promise<VmsOrderResult> => {
  await delay(400);
  const trackingId = payload.trackingId.trim();
  if (!trackingId) throw new Error("Tracking ID is required");
  if (trackingId.length > 100) throw new Error("Tracking ID is too long");
  findOrder(payload.orderId);
  if (orders.some((o) => o._id !== payload.orderId && !o.isDeleted && o.trackingId === trackingId)) {
    throw new Error("Another order already uses this tracking ID");
  }
  patch([payload.orderId], { trackingId });
  return { displayMessage: "Tracking ID updated successfully", data: clone(findOrder(payload.orderId)) };
};

/**
 * `FileService.retryCloudProcessing(rawVideoKey)` plus the BE side effect: the video goes back to "processing"
 * and one of the 3 retries is used.
 */
const retryCloudProcessing = async (rawVideoKey: string): Promise<VmsMessage> => {
  const order = orders.find((o) => o.key === rawVideoKey);
  if (!order) throw new Error("Video not found");
  if ((order.cloudRetryCount ?? 0) >= 3) throw new Error("Maximum retries reached for this video");
  const res = await FileService.retryCloudProcessing(rawVideoKey);
  orders = orders.map((o) => (o._id === order._id ? { ...o, cloudStatus: "processing", cloudRetryCount: (o.cloudRetryCount ?? 0) + 1, updatedAt: new Date().toISOString() } : o));
  processingSince.set(order._id, Date.now());
  return { displayMessage: res.message };
};

export const VmsService = {
  getOrderList,
  addToFavorite,
  removeFavorite,
  downloadExcelSheet,
  updateOrderType,
  updatePlatformType,
  addComment,
  deleteVideo,
  updateTrackingId,
  retryCloudProcessing,
};
