import { accountsDb, localDay, recordPurchaseCredits } from "@/mocks/accounts";
import { clone, delay, newId, paginate } from "@/mocks/delay";
import { sampleUser } from "@/mocks/user";
import { toCsv } from "@/lib/download";
import { GST_RATE } from "@/services/account-service";
import { UserService } from "@/services/user-service";
import type {
  ICreateManualPayment,
  IPaymentProof,
  IPaymentRequestsResponse,
  IPurchaseHistoryExportPayload,
  IPurchaseHistoryItem,
  IPurchaseHistoryPayload,
  IPurchaseHistoryResponse,
  IUpdatePaymentStatusResponse,
  PaymentRequests,
  PaymentStatus,
} from "@/types/accounts";
import type { MessageResponse } from "@/types/common";

/**
 * Mock of TrackVid-FE `api/manualPayment-service.ts`, plus the purchase-history endpoint TrackVid
 * calls inline (`/razorpay/payment-history`), proof preview and invoice download.
 */

const MAX_PROOF_BYTES = 10 * 1024 * 1024;

const createPayment = async (payload: ICreateManualPayment): Promise<MessageResponse> => {
  await delay(800);
  if (!payload.file) throw new Error("Please upload a screenshot of your payment.");
  if (payload.file.size > MAX_PROOF_BYTES) throw new Error("Payment proof must be 10 MB or smaller.");
  if (!payload.reference_id.trim()) throw new Error("Please enter your reference number.");
  const plan = (await UserService.getPlans()).find((p) => p._id === payload.plan_id);
  if (!plan) throw new Error("Invalid Plan");
  const billing = (await UserService.getBillingProfiles()).find((b) => b._id === payload.billing_profile_id);
  if (!billing) throw new Error("Please select a billing profile");
  if (accountsDb.payments.some((p) => p.reference_id === payload.reference_id.trim() && p.payment_status !== "revoked")) {
    throw new Error("A payment with this reference number was already submitted.");
  }
  const payment: PaymentRequests = {
    _id: newId(),
    user_id: { _id: sampleUser._id, email: sampleUser.email },
    user_email: sampleUser.email,
    reference_id: payload.reference_id.trim(),
    payment_proof: `payment-proof/${payload.file.name}`,
    payment_status: "pending",
    payment_date: new Date().toISOString(),
    payment_mode: payload.payment_mode,
    billing_profile_id: billing,
    plan_id: plan,
  };
  accountsDb.payments = [payment, ...accountsDb.payments];
  accountsDb.proofFiles.set(payment._id, payload.file);
  return { message: "Your payment has been submitted successfully" };
};

const getAllPaymentRequests = async (payload: { limit: number; page: number }): Promise<IPaymentRequestsResponse> => {
  await delay(450);
  const rows = accountsDb.payments
    .filter((p) => p.payment_mode !== "online")
    .sort((a, b) => b.payment_date.localeCompare(a.payment_date));
  const result = paginate(rows, payload.page, payload.limit);
  const counts: Record<PaymentStatus, number> = { pending: 0, approved: 0, revoked: 0, failed: 0 };
  for (const r of rows) counts[r.payment_status] += 1;
  return clone({
    metadata: {
      current_page: payload.page,
      per_page: payload.limit,
      total: result.total,
      totalPage: Math.max(1, Math.ceil(result.total / payload.limit)),
    },
    payments: result.data,
    counts,
  });
};

const updatePaymentStatus = async (payload: { paymentId: string; actionType: "approve" | "revoke" }): Promise<IUpdatePaymentStatusResponse> => {
  await delay(700);
  const payment = accountsDb.payments.find((p) => p._id === payload.paymentId);
  if (!payment) throw new Error("Payment request not found.");
  if (payment.payment_status !== "pending") throw new Error(`This payment is already ${payment.payment_status}.`);
  payment.payment_status = payload.actionType === "approve" ? "approved" : "revoked";
  let creditAdded = 0;
  // Only the signed-in company has a wallet in this mock; other companies' approvals only change status.
  if (payload.actionType === "approve" && payment.user_id._id === sampleUser._id) creditAdded = recordPurchaseCredits(payment);
  return {
    message: payload.actionType === "approve" ? "Payment approved and credits added." : "Payment revoked successfully.",
    payment: clone(payment),
    creditAdded,
  };
};

function historyRows(payload: Pick<IPurchaseHistoryPayload, "startDate" | "endDate">): IPurchaseHistoryItem[] {
  return accountsDb.payments
    .filter((p) => p.user_id._id === sampleUser._id)
    .filter((p) => {
      const day = localDay(p.payment_date);
      return (!payload.startDate || day >= payload.startDate) && (!payload.endDate || day <= payload.endDate);
    })
    .sort((a, b) => b.payment_date.localeCompare(a.payment_date))
    .map((p) => ({
      _id: p._id,
      payment_date: p.payment_date,
      payment_status: p.payment_status,
      payment_mode: p.payment_mode,
      reference_id: p.reference_id,
      plan: p.plan_id,
    }));
}

/** TrackVid `post("/razorpay/payment-history")`. */
const getPaymentHistory = async (payload: IPurchaseHistoryPayload): Promise<IPurchaseHistoryResponse> => {
  await delay(400);
  const rows = historyRows(payload);
  const result = paginate(rows, payload.page, payload.limit);
  return clone({
    order: result.data,
    metadata: { total: result.total, totalPage: Math.max(1, Math.ceil(result.total / payload.limit)), page: payload.page, limit: payload.limit },
  });
};

const MODE_LABEL: Record<string, string> = { upi: "UPI", bank: "Bank transfer", online: "Online" };

/** Purchase history export (TrackVid returns .xlsx; the mock returns CSV). */
const downloadPurchaseHistory = async (payload: IPurchaseHistoryExportPayload): Promise<Blob> => {
  await delay(500);
  let rows = historyRows(payload);
  if (payload.selectedOrders.length) rows = rows.filter((r) => payload.selectedOrders.includes(r._id));
  else if (payload.exportLimit !== "all") rows = paginate(rows, payload.page, payload.exportLimit).data;
  const csv = toCsv([
    ["Plan", "Amount (INR)", "GST (INR)", "Purchase Date", "Credit", "Bonus", "Status", "Mode", "Reference"],
    ...rows.map((r) => [
      r.plan.name,
      r.plan.price.toFixed(2),
      ((r.plan.price * GST_RATE) / 100).toFixed(2),
      new Date(r.payment_date).toLocaleString("en-IN"),
      r.payment_status === "revoked" ? -(r.plan.credit ?? 0) : (r.plan.credit ?? 0),
      r.plan.bonus ?? 0,
      r.payment_status,
      MODE_LABEL[r.payment_mode] ?? r.payment_mode,
      r.reference_id,
    ]),
  ]);
  return new Blob([csv], { type: "text/csv;charset=utf-8" });
};

const getPaymentProof = async (paymentId: string): Promise<IPaymentProof> => {
  await delay(250);
  const payment = accountsDb.payments.find((p) => p._id === paymentId);
  if (!payment || !payment.payment_proof) throw new Error("No payment proof for this request.");
  return { name: payment.payment_proof.split("/").pop() ?? payment.payment_proof, file: accountsDb.proofFiles.get(paymentId) ?? null };
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);
}

/** Invoice for an approved payment (TrackVid `/manual-payment/invoice` returns a PDF URL; the mock returns HTML). */
const getInvoice = async (paymentId: string): Promise<{ fileName: string; html: string }> => {
  await delay(500);
  const p = accountsDb.payments.find((x) => x._id === paymentId);
  if (!p) throw new Error("Failed to generate the invoice.");
  if (p.payment_status !== "approved") throw new Error("Invoices are only available for approved payments.");
  const gst = (p.plan_id.price * GST_RATE) / 100;
  const b = p.billing_profile_id;
  const rupee = (n: number) => `INR ${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const e = escapeHtml;
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Invoice ${e(p.reference_id)}</title>
<style>body{font-family:system-ui,sans-serif;color:#25251f;max-width:720px;margin:40px auto;padding:0 16px}h1{font-size:22px}table{width:100%;border-collapse:collapse;margin-top:16px}td,th{border-bottom:1px solid #e4dece;padding:8px;text-align:left}td:last-child,th:last-child{text-align:right}.muted{color:#696b61}</style></head>
<body><h1>Tax invoice</h1><p class="muted">WHITESTONE INFOTECH LLP · GSTIN 24AAEFW5097R1ZA · Katargam, Surat</p>
<p><strong>Bill to:</strong> ${e(b?.billing_name ?? p.user_email)}<br>${e(b?.address_line_1 ?? "")} ${e(b?.address_line_2 ?? "")}<br>${e(b ? `${b.city}, ${b.state} ${b.pincode}` : "")}<br>GSTIN ${e(b?.gst_number ?? "—")}</p>
<p class="muted">Payment ${e(p._id)} · Reference ${e(p.reference_id)} · ${e(new Date(p.payment_date).toLocaleString("en-IN"))}</p>
<table><tr><th>Item</th><th>Amount</th></tr><tr><td>${e(p.plan_id.name)} credit plan (${p.plan_id.credit ?? 0} + ${p.plan_id.bonus ?? 0} bonus credits)</td><td>${rupee(p.plan_id.price)}</td></tr>
<tr><td>GST (${GST_RATE}%)</td><td>${rupee(gst)}</td></tr><tr><th>Total</th><th>${rupee(p.plan_id.price + gst)}</th></tr></table></body></html>`;
  return { fileName: `invoice-${paymentId}.html`, html };
};

export const ManualPaymentService = {
  createPayment,
  getAllPaymentRequests,
  updatePaymentStatus,
  downloadPurchaseHistory,
  getPaymentHistory,
  getPaymentProof,
  getInvoice,
};
