/** Types for the Master Dashboard (TrackVid-FE `api/dashboard-service.ts`, `pages/DashboardMaster.tsx`, `components/Dashboard/*`). */

/** Date filter the dashboard endpoints take (`from` / `to` as `yyyy-MM-dd`). */
export interface DashboardDateFilter {
  startDate?: Date | string;
  endDate?: Date | string;
  key?: string;
}

/** TrackVid `IDashboard` (legacy `/dashboard` payload, kept in `dashboardSlice`). */
export interface IDashboard {
  totalReturn: number;
  totalDispatch: number;
  totalOrders: number;
  lineChartData: {
    _id?: string;
    data: {
      feedName?: string;
      data?: number[];
    }[];
  }[];
}

/** One row of `/dashboard/getOrderStatusCount` → `lineChartData[0].statusCounts`. */
export interface StatusCountRecord {
  order_status: string;
  totalCount: number;
  good?: number;
  bad?: number;
  approved?: number;
  rejected?: number;
}

export interface MasterOrderStatusCountResponse {
  lineChartData: { statusCounts: StatusCountRecord[] }[];
}

/** `/dashboard/masterImportCarrierReport` → `orders[]`. */
export interface CarrierOrderMetrics {
  _id: string;
  avgTotalTimeDifference?: number;
  countGood?: number;
  countBad?: number;
}

export interface MasterCarrierStatusCountResponse {
  orders: CarrierOrderMetrics[];
}

/** `/dashboard/cms-platform-summary` → `data.platforms[]`. */
export interface PlatformSummaryRow {
  name: string;
  total: number;
  pending: number;
  remaining: number;
  success: number;
  inReview: number;
  approved: number;
  rejected: number;
  automated: number;
  manual: number;
}

export interface CmsPlatformSummaryResponse {
  platforms: PlatformSummaryRow[];
}

/** `/dashboard/video-recordings-by-platform` → `data.platforms[]`. */
export interface VideoRecordingsRow {
  name: string;
  forward: number;
  return: number;
  total: number;
}

export interface VideoRecordingsResponse {
  platforms: VideoRecordingsRow[];
}

/** `/dashboard/cms-data` (not read by the current dashboard; kept for parity). */
export interface CmsDataResponse {
  totalClaims: number;
  platforms: { name: string; total: number; approved: number; rejected: number }[];
}

/** `/dashboard/getCmsStatusCount` (pie chart data; not read by the current dashboard). */
export interface CmsPieChartRow {
  status: string;
  count: number;
}

/** Merged per-platform row (`PlatformInsightsTable`). */
export interface PlatformInsightsRow {
  name: string;
  total: number;
  pending: number;
  remaining: number;
  success: number;
  automated: number;
  manual: number;
  forwardRecordings: number;
  returnRecordings: number;
  totalRecordings: number;
}

/** Per-marketplace CMS status row (`CmsStatusInsights`). */
export interface CmsStatusRow {
  name: string;
  total: number;
  pending: number;
  inReview: number;
  approved: number;
  rejected: number;
}

/** Email automation counters for the hero card + auto-reply ratio. */
export interface EmailMetricSummary {
  totalSent: number;
  replied: number;
  failed: number;
  manual: number;
}

export type DateRangePresetKey = "last7" | "lastWeek" | "currentMonth" | "lastMonth" | "allTime" | "custom";

export interface DateRangeValue {
  startDate: Date;
  endDate: Date;
  preset: DateRangePresetKey;
}
