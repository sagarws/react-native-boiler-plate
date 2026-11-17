// @ts-nocheck
import { findRecord } from "@/lib/store/core";

const orderOpsDialogDateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

export function formatOrderOpsDialogDate(e) {
  if (!e) return "—";
  const t = new Date(`${String(e).slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(t.getTime())
    ? String(e)
    : orderOpsDialogDateFormatter.format(t);
}

export function getTodayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

export function getOrderOpsDialogCustomer(e) {
  return e ? findRecord("customers", e.customerId) : void 0;
}
