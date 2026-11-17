// @ts-nocheck
import { formatCurrency } from "@/lib/format";

export const disputeStatusOptions = [
  "Open",
  "Evidence required",
  "Under review",
  "Resolved",
  "Closed",
];

export const disputeNumberFormatter = new Intl.NumberFormat("en-US");

export function formatDisputeMoney(e) {
  return formatCurrency(e, 2);
}

export function formatDisputeDate(e) {
  return e
    ? new Intl.DateTimeFormat("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      }).format(new Date(String(e)))
    : "—";
}

export function readDisputeForm(e) {
  const t = new FormData(e);
  return {
    orderId: String(t.get("orderId") || ""),
    vendorId: String(t.get("vendorId") || ""),
    type: String(t.get("type") || "Buyer vs vendor"),
    reason: String(t.get("reason") || "").trim(),
    amount: Number(t.get("amount") || 0),
    currency: String(t.get("currency") || "USD"),
    priority: String(t.get("priority") || "Normal"),
    evidence: String(t.get("evidence") || "Missing"),
    liability: String(t.get("liability") || "Undecided"),
    payoutImpact: String(t.get("payoutImpact") || "No hold"),
    owner: String(t.get("owner") || "").trim(),
    openedAt: String(t.get("openedAt") || ""),
    deadline: String(t.get("deadline") || ""),
    status: String(t.get("status") || "Open"),
    notes: String(t.get("notes") || "").trim(),
  };
}
