// @ts-nocheck
import { formatCurrency } from "@/lib/format";

export const payoutBatchStatusOptions = [
  "Draft",
  "Ready for processing",
  "Processing",
  "On hold",
  "Paid",
  "Failed",
  "Cancelled",
];

export const payoutNumberFormatter = new Intl.NumberFormat("en-US");

export function formatPayoutMoney(e) {
  return formatCurrency(e, 2);
}

export function formatPayoutDate(e) {
  return e
    ? new Intl.DateTimeFormat("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      }).format(new Date(String(e)))
    : "—";
}

export function getPayoutVendorInitials(e) {
  return String(e?.name || "V")
    .split(/\s+/)
    .slice(0, 2)
    .map((e) => e[0])
    .join("")
    .toUpperCase();
}

export function readPayoutBatchForm(e) {
  const t = new FormData(e);
  return {
    vendorId: String(t.get("vendorId") || ""),
    reference: String(t.get("reference") || "").trim(),
    periodStart: String(t.get("periodStart") || ""),
    periodEnd: String(t.get("periodEnd") || ""),
    currency: String(t.get("currency") || "USD"),
    method: String(t.get("method") || "Bank transfer"),
    destination: String(t.get("destination") || "").trim(),
    schedule: String(t.get("schedule") || "Weekly"),
    expectedAt: String(t.get("expectedAt") || ""),
    reserveHeld: Number(t.get("reserveHeld") || 0),
    adjustment: Number(t.get("adjustment") || 0),
    status: String(t.get("status") || "Draft"),
    holdReason: String(t.get("holdReason") || "").trim(),
    notes: String(t.get("notes") || "").trim(),
  };
}
