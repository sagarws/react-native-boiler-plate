import { CMS_PLATFORMS, dashboardDb, dayKey } from "@/mocks/dashboard";
import { delay } from "@/mocks/delay";
import type {
  CarrierOrderMetrics,
  CmsDataResponse,
  CmsPieChartRow,
  CmsPlatformSummaryResponse,
  DashboardDateFilter,
  IDashboard,
  MasterCarrierStatusCountResponse,
  MasterOrderStatusCountResponse,
  PlatformSummaryRow,
  StatusCountRecord,
  VideoRecordingsResponse,
} from "@/types/dashboard";

/**
 * Mock of TrackVid-FE `api/dashboard-service.ts` (`/dashboard/*`). Same function names; each resolves
 * with the payload the screen reads (TrackVid's `response.data.data` / `response.data`). Numbers are
 * summed from the day-by-day sample data in `@/mocks/dashboard` for the `from`–`to` window.
 */

const toKey = (value: Date | string | undefined): string | undefined => {
  if (!value) return undefined;
  if (value instanceof Date) return dayKey(value);
  return value.slice(0, 10);
};

/** `from` / `to` as `yyyy-MM-dd` (inclusive). No filter (TrackVid "All Time" without dates) = whole dataset. */
function windowOf(filter: DashboardDateFilter | null | undefined): { from?: string; to?: string } {
  if (!filter) return {};
  return { from: toKey(filter.startDate), to: toKey(filter.endDate) };
}

function inWindow(day: string, w: { from?: string; to?: string }): boolean {
  if (w.from && day < w.from) return false;
  if (w.to && day > w.to) return false;
  return true;
}

/** `feeds` narrows nothing in the mock (all sample data belongs to one feed set); kept for the same signature. */
const getDashboardInfo = async (dateFilter: DashboardDateFilter, feeds: string[]): Promise<IDashboard> => {
  void feeds;
  await delay(300);
  const w = windowOf(dateFilter);
  const days = dashboardDb.orders.filter((d) => inWindow(d.day, w));
  return {
    totalOrders: days.reduce((s, d) => s + d.shipped, 0),
    totalDispatch: days.reduce((s, d) => s + d.delivered, 0),
    totalReturn: days.reduce((s, d) => s + d.returnCreated, 0),
    lineChartData: [
      {
        _id: "orders",
        data: [
          { feedName: "Shipped", data: days.map((d) => d.shipped) },
          { feedName: "Return Created", data: days.map((d) => d.returnCreated) },
        ],
      },
    ],
  };
};

function platformTotals(dateFilter: DashboardDateFilter | null | undefined) {
  const w = windowOf(dateFilter);
  const byName = new Map<string, PlatformSummaryRow & { forward: number; returned: number }>();
  for (const d of dashboardDb.platforms) {
    if (!inWindow(d.day, w)) continue;
    const row = byName.get(d.name) ?? {
      name: d.name,
      total: 0,
      pending: 0,
      remaining: 0,
      success: 0,
      inReview: 0,
      approved: 0,
      rejected: 0,
      automated: 0,
      manual: 0,
      forward: 0,
      returned: 0,
    };
    const claims = d.pending + d.inReview + d.approved + d.rejected + d.other;
    row.total += claims;
    row.pending += d.pending;
    row.inReview += d.inReview;
    row.approved += d.approved;
    row.rejected += d.rejected;
    row.success += d.approved;
    row.remaining += claims - d.approved - d.rejected;
    row.automated += d.automated;
    row.manual += d.approved - d.automated;
    row.forward += d.forward;
    row.returned += d.returned;
    byName.set(d.name, row);
  }
  return [...byName.values()];
}

const getCmsData = async (dateFilter: DashboardDateFilter, feeds: string[]): Promise<CmsDataResponse> => {
  void feeds;
  await delay(300);
  const rows = platformTotals(dateFilter).filter((r) => CMS_PLATFORMS.some((p) => p.name === r.name));
  return {
    totalClaims: rows.reduce((s, r) => s + r.total, 0),
    platforms: rows.map((r) => ({ name: r.name, total: r.total, approved: r.approved, rejected: r.rejected })),
  };
};

const getCmsPieChartData = async (dateFilter: DashboardDateFilter, feeds: string[]): Promise<CmsPieChartRow[]> => {
  void feeds;
  await delay(300);
  const rows = platformTotals(dateFilter);
  const sum = (k: "pending" | "inReview" | "approved" | "rejected") => rows.reduce((s, r) => s + r[k], 0);
  return [
    { status: "Pending", count: sum("pending") },
    { status: "In Review", count: sum("inReview") },
    { status: "Approved", count: sum("approved") },
    { status: "Rejected", count: sum("rejected") },
  ];
};

const getCmsPlatformSummary = async (
  dateFilter: DashboardDateFilter | null | undefined,
  feeds: string[],
): Promise<CmsPlatformSummaryResponse> => {
  void feeds;
  await delay(450);
  const platforms = platformTotals(dateFilter)
    .filter((r) => CMS_PLATFORMS.some((p) => p.name === r.name))
    .map(({ forward: _forward, returned: _returned, ...row }) => {
      void _forward;
      void _returned;
      return row;
    });
  return { platforms };
};

const getMasterOrderStatusCount = async (dateFilter: DashboardDateFilter): Promise<MasterOrderStatusCountResponse> => {
  await delay(350);
  const w = windowOf(dateFilter);
  const days = dashboardDb.orders.filter((d) => inWindow(d.day, w));
  const sum = (k: "shipped" | "returnCreated" | "good" | "bad" | "approved" | "rejected" | "delivered") =>
    days.reduce((s, d) => s + d[k], 0);
  const good = sum("good");
  const bad = sum("bad");
  const approved = sum("approved");
  const rejected = sum("rejected");
  const statusCounts: StatusCountRecord[] = [
    { order_status: "Shipped", totalCount: sum("shipped") },
    { order_status: "Delivered", totalCount: sum("delivered") },
    { order_status: "Return Created", totalCount: sum("returnCreated") },
    { order_status: "Physically Return Received", totalCount: good + bad, good, bad },
    { order_status: "Return Dispute", totalCount: approved + rejected, approved, rejected },
  ];
  return { lineChartData: [{ statusCounts }] };
};

const getMasterCarrierStatusCount = async (dateFilter: DashboardDateFilter): Promise<MasterCarrierStatusCountResponse> => {
  await delay(400);
  const w = windowOf(dateFilter);
  const acc = new Map<string, { deliveries: number; totalDays: number; good: number; bad: number }>();
  for (const d of dashboardDb.carriers) {
    if (!inWindow(d.day, w)) continue;
    const row = acc.get(d.carrier) ?? { deliveries: 0, totalDays: 0, good: 0, bad: 0 };
    row.deliveries += d.deliveries;
    row.totalDays += d.totalDays;
    row.good += d.good;
    row.bad += d.bad;
    acc.set(d.carrier, row);
  }
  const orders: CarrierOrderMetrics[] = [...acc.entries()]
    .filter(([, r]) => r.deliveries > 0)
    .map(([carrier, r]) => ({
      _id: carrier,
      avgTotalTimeDifference: Number((r.totalDays / r.deliveries).toFixed(1)),
      countGood: r.good,
      countBad: r.bad,
    }));
  return { orders };
};

const getVideoRecordingsByPlatform = async (dateFilter: DashboardDateFilter): Promise<VideoRecordingsResponse> => {
  await delay(400);
  const platforms = platformTotals(dateFilter)
    .filter((r) => r.forward + r.returned > 0)
    .map((r) => ({ name: r.name, forward: r.forward, return: r.returned, total: r.forward + r.returned }));
  return { platforms };
};

export const DashboardService = {
  getDashboardInfo,
  getCmsData,
  getCmsPieChartData,
  getCmsPlatformSummary,
  getMasterOrderStatusCount,
  getMasterCarrierStatusCount,
  getVideoRecordingsByPlatform,
};
