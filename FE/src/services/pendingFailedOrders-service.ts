import { clone, delay } from "@/mocks/delay";
import { pendingFailedCompany } from "@/mocks/pending-failed-orders";
import type {
  GetPendingAndFailedOrdersPayload,
  PendingFailedOrdersResponse,
  PendingFailedRequestConfig,
} from "@/types/pending-failed-orders";

/**
 * Mock of TrackVid-FE `api/pendingFailedOrders-service.ts` (company-scoped `POST /order/pending-and-failed-orders`).
 * Like the real endpoint, `page` / `limit` / `search` paginate and filter COMPANIES, and an admin only ever
 * sees their own company — so every feed of that company comes back in one response.
 */
const getPendingAndFailedOrders = async (
  payload: GetPendingAndFailedOrdersPayload,
  config: PendingFailedRequestConfig = {},
): Promise<PendingFailedOrdersResponse> => {
  await delay(500);
  if (config.signal?.aborted) throw new DOMException("The request was aborted.", "AbortError");
  const term = payload.search.trim().toLowerCase();
  const companies = !term || pendingFailedCompany.companyName.toLowerCase().includes(term) ? [pendingFailedCompany] : [];
  const limit = Math.max(1, payload.limit);
  const page = Math.max(1, payload.page);
  const pageRows = companies.slice((page - 1) * limit, page * limit);
  return {
    CompanyWiseData: clone(pageRows),
    metadata: {
      total: companies.length,
      totalPage: Math.max(1, Math.ceil(companies.length / limit)),
      page,
      limit,
      platformLookupTruncated: false,
    },
    totalPendingOrders: companies.reduce((s, c) => s + c.totalPendingOrders, 0),
    totalFailedOrders: companies.reduce((s, c) => s + c.totalFailedOrders, 0),
  };
};

export const PendingFailedOrdersService = {
  getPendingAndFailedOrders,
};
