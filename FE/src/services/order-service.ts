import { accountsDb, localDay } from "@/mocks/accounts";
import { clone, delay, paginate } from "@/mocks/delay";
import { toCsv } from "@/lib/download";
import { AccountService } from "@/services/account-service";
import type { IOrder, IOrderExportPayload, IOrderListPayload, IOrderListResponse, OrderType, OrderUsage } from "@/types/accounts";
import type { MessageResponse } from "@/types/common";

/**
 * Mock of TrackVid-FE `api/order-service.ts` (VMS videos). Owned by the Accounts route because
 * the usage history comes from here; VMS / Favorite screens call the same functions.
 */

function filterOrders(payload: Omit<IOrderListPayload, "page" | "limit">): IOrder[] {
  const q = (payload.search ?? "").trim().toLowerCase();
  return accountsDb.orders
    .filter((o) => (payload.isDeleted ? o.isDeleted : !o.isDeleted))
    .filter((o) => !payload.isFavorite || o.isFavorite)
    .filter((o) => !payload.orderType || o.orderType === payload.orderType)
    .filter((o) => !payload.feedId || o.feedId === payload.feedId)
    .filter((o) => !payload.eCommercePlatform || o.eCommercePlatform === payload.eCommercePlatform)
    .filter((o) => {
      const day = localDay(o.createdAt);
      return (!payload.startDate || day >= payload.startDate) && (!payload.endDate || day <= payload.endDate);
    })
    .filter((o) => !q || o.trackingId.toLowerCase().includes(q))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

const getOrderList = async (payload: IOrderListPayload): Promise<IOrderListResponse> => {
  await delay(450);
  const result = paginate(filterOrders(payload), payload.page, payload.limit);
  return clone({
    order: result.data,
    metadata: { total: result.total, totalPage: Math.max(1, Math.ceil(result.total / payload.limit)), page: payload.page, limit: payload.limit },
  });
};

function setFlag(ids: readonly string[], patch: Partial<IOrder>): number {
  let n = 0;
  accountsDb.orders = accountsDb.orders.map((o) => {
    if (!ids.includes(o._id)) return o;
    n += 1;
    return { ...o, ...patch, updatedAt: new Date().toISOString() };
  });
  return n;
}

const addToFavorite = async (payload: { id: string[] }): Promise<MessageResponse> => {
  await delay(300);
  const n = setFlag(payload.id, { isFavorite: true });
  return { message: `${n} video(s) added to favorites.` };
};

const removeFavorite = async (payload: { id: string[] }): Promise<MessageResponse> => {
  await delay(300);
  const n = setFlag(payload.id, { isFavorite: false });
  return { message: `${n} video(s) removed from favorites.` };
};

const deleteOrder = async (payload: { id: string[] }): Promise<MessageResponse> => {
  await delay(400);
  const deleteOn = new Date(Date.now() + 30 * 86400000).toISOString();
  const n = setFlag(payload.id, { isDeleted: true, deleteOn });
  return { message: `${n} video(s) moved to trash.` };
};

const recoverDeletedOrder = async (payload: { id: string[] }): Promise<MessageResponse> => {
  await delay(400);
  const n = setFlag(payload.id, { isDeleted: false, deleteOn: null });
  return { message: `${n} video(s) recovered.` };
};

/** Excel export in TrackVid; the mock returns CSV. */
const downloadExcelSheet = async (payload: IOrderExportPayload): Promise<Blob> => {
  await delay(500);
  let rows = filterOrders(payload);
  if (payload.selectedOrders.length) rows = rows.filter((o) => payload.selectedOrders.includes(o._id));
  else rows = paginate(rows, payload.page, payload.limit).data;
  const csv = toCsv([
    ["Tracking ID", "Order Type", "Platform", "Feed", "Recorded At", "Length (s)", "Favorite", "Comment"],
    ...rows.map((o) => [o.trackingId, o.orderType, o.eCommercePlatform, o.feedName, new Date(o.createdAt).toLocaleString("en-IN"), o.videoLength, o.isFavorite ? "Yes" : "No", o.comment]),
  ]);
  return new Blob([csv], { type: "text/csv;charset=utf-8" });
};

const getOrderUsageHistory = async (): Promise<OrderUsage[]> => AccountService.getUsageHistory();

function findOrder(id: string): IOrder {
  const order = accountsDb.orders.find((o) => o._id === id);
  if (!order) throw new Error("Order not found.");
  return order;
}

const updateOrderType = async (payload: { orderId: string; status: OrderType }): Promise<IOrder> => {
  await delay(300);
  findOrder(payload.orderId);
  setFlag([payload.orderId], { orderType: payload.status });
  return clone(findOrder(payload.orderId));
};

const updatePlatformType = async (payload: { orderId: string; eCommercePlatform: string }): Promise<IOrder> => {
  await delay(300);
  findOrder(payload.orderId);
  setFlag([payload.orderId], { eCommercePlatform: payload.eCommercePlatform });
  return clone(findOrder(payload.orderId));
};

const syncOrder = async (): Promise<MessageResponse> => {
  await delay(900);
  return { message: "Orders are in sync." };
};

const addComment = async (payload: { _id: string; comment: string }): Promise<{ message: string; comment: string }> => {
  await delay(300);
  findOrder(payload._id);
  const comment = payload.comment.trim();
  setFlag([payload._id], { comment });
  return { message: "Comment saved.", comment };
};

const deleteVideo = async (payload: { orderId: string }): Promise<IOrder> => {
  await delay(500);
  findOrder(payload.orderId);
  setFlag([payload.orderId], { key: "", videoLength: 0, size: 0 });
  return clone(findOrder(payload.orderId));
};

const updateTrackingId = async (payload: { orderId: string; trackingId: string }): Promise<IOrder> => {
  await delay(400);
  const trackingId = payload.trackingId.trim();
  if (!trackingId) throw new Error("Tracking ID is required.");
  if (accountsDb.orders.some((o) => o._id !== payload.orderId && o.trackingId === trackingId)) {
    throw new Error("Another video already uses this tracking ID.");
  }
  findOrder(payload.orderId);
  setFlag([payload.orderId], { trackingId });
  return clone(findOrder(payload.orderId));
};

export const OrderService = {
  getOrderList,
  addToFavorite,
  removeFavorite,
  deleteOrder,
  recoverDeletedOrder,
  downloadExcelSheet,
  getOrderUsageHistory,
  updateOrderType,
  updatePlatformType,
  syncOrder,
  addComment,
  deleteVideo,
  updateTrackingId,
};
