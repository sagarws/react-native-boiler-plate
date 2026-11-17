import { accountsDb, localDay } from "@/mocks/accounts";
import { clone, delay, paginate } from "@/mocks/delay";
import type { ICreditHistoryPayload, ICreditHistoryResponse } from "@/types/accounts";

/** Mock of TrackVid-FE `api/creditHistory-service.ts` (server paging + filters). */

const getCreditHistory = async (payload: ICreditHistoryPayload): Promise<ICreditHistoryResponse> => {
  await delay(400);
  const page = payload.page ?? 1;
  const limit = payload.limit ?? 10;
  const q = (payload.search ?? "").trim().toLowerCase();
  const types = (payload.actionType ?? "")
    .split(",")
    .filter(Boolean)
    .map(Number);
  const rows = accountsDb.creditHistory.filter((h) => {
    const day = localDay(h.createdAt);
    if (payload.startDate && day < payload.startDate) return false;
    if (payload.endDate && day > payload.endDate) return false;
    if (types.length && !types.includes(h.actionType)) return false;
    if (q) {
      const awb = (h.cmsData?.AWBNumber ?? h.orderData?.trackingId ?? "").toLowerCase();
      if (!awb.includes(q)) return false;
    }
    return true;
  });
  const result = paginate(rows, page, limit);
  return clone({
    history: result.data,
    metadata: { total: result.total, totalPage: Math.max(1, Math.ceil(result.total / limit)), page, limit },
  });
};

export const creditHistoryService = { getCreditHistory };
