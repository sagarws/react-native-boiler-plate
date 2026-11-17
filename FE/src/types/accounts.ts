/**
 * Accounts / payments / orders types. Field names follow TrackVid-FE (`helper/types/types.ts`,
 * `slices/accountSlice.ts`, `slices/paymentSlice.ts`, `slices/tdsSlice.ts`, `slices/orderSlice.ts`).
 */
import type { IPlan } from "@/types/common";

/** TrackVid `IMetadata` (list paging info). */
export interface IMetadata {
  total: number;
  totalPage: number;
  page: number;
  limit: number;
}

/* ---------- account usage (accountSlice) ---------- */

export interface StorageInfo {
  used: number;
  total: number;
  remaining: number;
}

export interface CreditInfo {
  used: number;
  total: number;
  remaining: number;
}

export interface IUsage {
  storage: StorageInfo;
  credit: CreditInfo;
}

export interface IInvoice {
  _id: string;
  invoiceNumber: string;
  paymentId: string;
  planName: string;
  amount: number;
  gstAmount: number;
  totalAmount: number;
  createdAt: string;
}

export interface ITransaction {
  _id: string;
  type: "credit" | "debit";
  description: string;
  credit: number;
  createdAt: string;
}

/* ---------- usage history (OrderService.getOrderUsageHistory) ---------- */

interface UsageCounters {
  cms_orders: number;
  cms_orders_credits: number;
  /** AJIO NDR/DDR claims accepted. Counts only. */
  ndr_ddr_claims?: number;
  /** Myntra tickets re-opened and accepted. Counts only. */
  reopen_claims?: number;
  forward_orders: number;
  forward_orders_credits: number;
  return_orders: number;
  return_orders_credits: number;
  total_effective_amount: number;
  total_orders: number;
  total_orders_credits: number;
}

export interface DailyData extends UsageCounters {
  /** ISO date (yyyy-MM-dd). */
  date: string;
  effective_var: number;
  old_effective_var: number;
}

export interface MonthlyData extends UsageCounters {
  month: number;
  monthName: string;
  daily: DailyData[];
}

export interface OrderUsage extends UsageCounters {
  year: number;
  monthly: MonthlyData[];
}

/* ---------- credit history ---------- */

export interface HistoryItem {
  _id: string;
  feedId: string | null;
  actionType: number;
  companyId: string;
  credit: number;
  orderId: string | null;
  cmsId: string | null;
  paymentId: string | null;
  createdAt: string;
  companyData: { name: string };
  paymentData?: { user_email: string; payment_status: string };
  feedData?: { feedName: string };
  cmsData?: { AWBNumber: string };
  orderData?: { orderType: string; trackingId: string };
}

export interface ICreditHistoryPayload {
  startDate: string;
  endDate?: string;
  page?: number;
  limit?: number;
  search?: string;
  /** Comma separated action type numbers. */
  actionType?: string;
}

export interface ICreditHistoryResponse {
  history: HistoryItem[];
  metadata: IMetadata;
}

/* ---------- manual payments (paymentSlice) ---------- */

export interface BillingProfile {
  _id: string;
  billing_name: string;
  billing_email: string;
  billing_phone: string;
  gst_number: string;
  city: string;
  state: string;
  country: string;
  pincode: string;
  address_line_1: string;
  address_line_2?: string;
  user_id: string;
  is_disabled: boolean;
  is_deleted: boolean;
}

export type PaymentStatus = "pending" | "approved" | "revoked" | "failed";
export type PaymentMode = "upi" | "bank" | "online";

export interface PaymentRequests {
  _id: string;
  user_id: { _id: string; email: string };
  user_email: string;
  reference_id: string;
  /** File key of the uploaded proof (empty for online payments). */
  payment_proof: string;
  payment_status: PaymentStatus;
  payment_date: string;
  payment_mode: PaymentMode;
  billing_profile_id: BillingProfile | null;
  plan_id: IPlan;
}

export interface IPaymentRequestsResponse {
  metadata: { current_page: number; per_page: number; total: number; totalPage: number };
  payments: PaymentRequests[];
  /** Counts over every request (for the summary tiles). */
  counts: Record<PaymentStatus, number>;
}

export interface ICreateManualPayment {
  reference_id: string;
  file: File;
  billing_profile_id: string;
  plan_id: string;
  payment_mode: PaymentMode;
}

export interface IUpdatePaymentStatusResponse {
  message: string;
  payment: PaymentRequests;
  /** Credits added to the buyer's wallet (approve only). */
  creditAdded: number;
}

export interface IPaymentProof {
  name: string;
  /** Uploaded in this session; otherwise the screen renders a generated receipt. */
  file: File | null;
}

/** Row of TrackVid `/razorpay/payment-history` (Purchase history tab). */
export interface IPurchaseHistoryItem {
  _id: string;
  payment_date: string;
  payment_status: PaymentStatus;
  payment_mode: PaymentMode;
  reference_id: string;
  plan: IPlan;
}

export interface IPurchaseHistoryPayload {
  page: number;
  limit: number;
  startDate: string;
  endDate: string;
}

export interface IPurchaseHistoryResponse {
  order: IPurchaseHistoryItem[];
  metadata: IMetadata;
}

export interface IPurchaseHistoryExportPayload extends IPurchaseHistoryPayload {
  selectedOrders: string[];
  /** `"all"` exports every row in the date range. */
  exportLimit: number | "all";
}

/** Simulated Razorpay checkout (Razorpay is not available in this UI). */
export interface IPurchasePlanPayload {
  plan_id: string;
  billing_profile_id: string;
  simulateFailure: boolean;
}

export interface IPurchasePlanResponse {
  message: string;
  payment: PaymentRequests;
  creditAdded: number;
}

/* ---------- storage upgrade ---------- */

export interface IUpgradeStorageResponse {
  message: string;
  plan: IPlan;
  creditDeducted: number;
}

/* ---------- TDS reimbursement (tdsSlice) ---------- */

/** "1" = In process, "2" = Closed (TrackVid tab values). */
export type TdsStatus = "1" | "2";

export interface ITdsDuration {
  quarter: number;
  year: number;
}

export interface ITds {
  _id: string;
  companyName: string;
  tanNumber: string;
  panNumber: string;
  duration: ITdsDuration;
  tdsAmount: number;
  accountNumber: string;
  accountHolderName: string;
  ifsc: string;
  status: TdsStatus;
  /** Name of the TDS certificate the user uploaded. */
  certificateName: string;
  tdsRefundedAmount?: number;
  /** Refund proof added by the TrackVid team when the request is closed. */
  attachment?: string;
  createdAt: string;
  closedAt?: string;
}

export interface ICreateTds {
  file: File;
  companyName: string;
  /** JSON string `{ quarter, year }` (same as TrackVid). */
  duration: string;
  tanNumber: string;
  panNumber: string;
  accountNumber: string;
  ifsc: string;
  accountHolderName: string;
  tdsAmount: number;
}

export interface ITdsListPayload {
  page: number;
  limit: number;
  status: TdsStatus;
}

export interface ITdsListResponse {
  tds: ITds[];
  metadata: IMetadata;
}

/* ---------- orders (orderSlice) ---------- */

export type OrderType = "Forward" | "Return";

export interface IOrderScreenshot {
  _id: string;
  url: string;
  createdAt: string;
}

export interface IOrder {
  _id: string;
  fileId: string;
  orderType: OrderType;
  trackingId: string;
  feedId: string;
  companyId: string;
  userId: string;
  isDeleted: boolean;
  deleteOn: string | null;
  isFavorite: boolean;
  createdAt: string;
  updatedAt: string;
  start_time: string;
  videoLength?: number;
  mimetype?: string;
  size?: number;
  feedName?: string;
  cameraType?: string;
  key: string;
  eCommercePlatform?: string;
  cloudStatus?: "processing" | "completed" | "failed";
  cloudRetryCount?: number;
  rtspURL?: string | null;
  comment?: string;
  screenshots: IOrderScreenshot[];
  ajioReplied?: boolean;
  ajioRepliedAt?: string;
  isMultiStep?: boolean;
  isMerged?: boolean;
  totalSteps?: number;
  uploadedSteps?: number[];
  children?: IOrder[];
  mergedFrom?: string[];
  mergedStatus?: "pending" | "merged" | "failed" | null;
}

export interface IOrderListPayload {
  page: number;
  limit: number;
  search?: string;
  startDate?: string;
  endDate?: string;
  orderType?: string;
  feedId?: string;
  eCommercePlatform?: string;
  isFavorite?: boolean;
  isDeleted?: boolean;
}

export interface IOrderListResponse {
  order: IOrder[];
  metadata: IMetadata;
}

export interface IOrderExportPayload extends Omit<IOrderListPayload, "limit"> {
  selectedOrders: string[];
  limit: number;
}

/** TrackVid `videoSizeRates` (used by `creditFinder`). */
export interface VideoSizeRate {
  videoSize: number;
  credits: number;
}
