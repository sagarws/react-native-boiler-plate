/** Types from TrackVid-FE `api/pendingFailedOrders-service.ts` (`POST /order/pending-and-failed-orders`). */

export type PendingFailedOrder = {
  _id: string;
  AWBNumber: string;
  orderType: string;
  eCommercePlatform: string | null;
};

export type PendingFailedFeed = {
  feedId: string;
  feedName: string;
  pending_orders: PendingFailedOrder[];
  failed_orders: PendingFailedOrder[];
  totalPendingOrders: number;
  totalFailedOrders: number;
};

export type PendingFailedCompany = {
  companyId: string;
  companyName: string;
  feeds: PendingFailedFeed[];
  totalPendingOrders: number;
  totalFailedOrders: number;
};

export type PendingFailedOrdersResponse = {
  CompanyWiseData: PendingFailedCompany[];
  metadata: {
    total: number;
    totalPage: number;
    page: number;
    limit: number;
    platformLookupTruncated: boolean;
  };
  /** Totals across every company the caller may see (an admin: their own company only). */
  totalPendingOrders: number;
  totalFailedOrders: number;
};

export type GetPendingAndFailedOrdersPayload = {
  page: number;
  limit: number;
  search: string;
};

/** Subset of the axios request config the screen passes (abort on unmount). */
export type PendingFailedRequestConfig = {
  signal?: AbortSignal;
};
